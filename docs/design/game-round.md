# Game round loop — design notes

Why the round loop in `src/spa/game/` is built the way it is: round coordinator, dispatcher, engine, complication engine, prompt builder, OpenAI message builder, conversation-log rendering, round-result encoder, and the Vista geometry they share. Read it with the code open.

Other sources, used here by reference rather than repeated:

- Vocabulary (Daemon, Vista, Interaction range, Objective kinds, Complication, Conversation log, …): `CONTEXT.md`. The domain types in `types.ts` follow it.
- Movement, sight, the proximity-hint distances and the `<what_you_see>` rules: ADR 0015, whose closing implementation notes record how the Vista landed and keep the three regions (Vista, interaction range, inspector display) apart.
- Prompting the pinned model, DeepSeek V4.1 Flash (thinking mode, XML sections, MUST/NEVER phrasing, persona-drift mitigation, prompt caching): `docs/prompting/deepseek-v4.1-flash-guide.md`. Why the model changed: ADR 0017. The earlier GLM-4.7 guide, `docs/prompting/glm-4.7-guide.md`, explains the parts of the prompt that were written for GLM.
- Drift-to-silence retry: ADR 0016.

## Round coordinator (`round-coordinator.ts`)

**Order of a round.** The player's message goes into the addressed Daemon's log only; other Daemons never see it. Then each Daemon acts in initiative order. An exhausted Daemon (its budget spent, so it is in `exhausted`) gets the "is unresponsive…" line, with no LLM call and no budget charge. Every other Daemon gets a prompt, one streamed turn (plus the ADR 0016 retry) and a dispatch. After all three: `advanceRound`, the complication tick, expiry of tool disables, chat lockouts and directives, convergence evaluation, then the two endings: win (`checkWinCondition`) or budget exhausted (`checkBudgetExhausted`, every Daemon in `exhausted`). A win takes priority, so a round that satisfies the last Objective while spending the last budget is a win. Expiry checks compare against the advanced round, so they run after `advanceRound`.

**`initiative`** must be a permutation of the persona ids; anything else throws. It defaults to `Object.keys(game.personas)`.

**Cross-round state lives with the caller.** `runRound` returns `toolRoundtrip`, `diskSnapshots` and `diskEntities`. `GameSession` persists them and passes them back next round as `priorToolRoundtrip`, `priorDiskSnapshots` and `priorDiskEntities`. The snapshots are captured when that Daemon's prompt is built, so the next `<whats_new>` diffs against what the Daemon actually saw.

**`onAiTurnComplete`** fires exactly once per Daemon, in initiative order, exhausted Daemons included. It fires after any retry and after dispatch. The SPA strips each panel's spinner on it. That is correct because the coordinator runs Daemons serially.

**Tool calls in one response** (ADR 0018). The first `message` call and the first action call are accepted. Any later `message` is a `tool_failure` ("only one message tool call per turn"), and so is any later action ("only one action tool call per turn"). A call that fails `parseToolCallArguments` is a `tool_failure` too, and this includes retired tool names such as `face`, which the tool enum no longer offers.

**Pairing dispatcher records to tool calls.** The dispatcher emits exactly one record for the accepted message, then one record for the accepted action. The exception is pick_up auto-examine, which reports through `actorPrivateToolResult` instead of a public record. The coordinator pairs records back to calls by index, so this ordering is a contract with `dispatchAiTurn`.

**What goes into the tool roundtrip.** Every call a Daemon emits must replay exactly once in later requests, so the model sees its own rejections without a tool call id appearing twice. Parse failures, rejected calls (a second message or a second action) and the accepted action are written to the Daemon's log as `tool-call` entries, and the message builder replays them from there. A delivered message replays from its `message` entry (ADR 0007). The only calls with no log entry are messages the dispatcher refused (an unknown or invalid recipient), so the roundtrip holds those alone and is replayed next round as assistant `tool_calls` plus `FAILED:` tool results. When no message failed, no roundtrip is stored. This also keeps the #213 fix: a message-only turn must not produce a double assistant turn. Before this rule the roundtrip also carried the rejected and accepted calls that were already logged, so the next request sent each of those ids twice, the second copy after the new player message. Consecutive assistant turns (a logged message, then a logged action call) are still allowed by the OpenAI protocol, which only requires tool results to follow their `tool_calls`.

**Perception-delta lines** (#469) are appended to the `diskDelta` of the accepted action's tool-call entry only, never to messages or rejected calls. A `pick_up` that auto-examines the item gets them too.

**Farewell line.** When a dispatch exhausts a Daemon's budget, it says goodbye to blue once. Later rounds take the exhausted branch.

**Sysadmin directive issue order** (#298): draw the directive text, revoke any active directive for the same target (a private revocation message), apply the complication, fill in the text, then deliver it privately. `applyComplicationResult` appends the directive with `PENDING_DIRECTIVE_TEXT` because the engine has no content layer. The prompt builder filters that placeholder out as a guard. The sentinel lives in `types.ts` next to `ActiveComplication` rather than in `complication-engine.ts`, so the prompt-rendering layer does not import the complication engine (and through it `engine.ts`) just to read one constant. The rng is consumed in this order, and the tests' seeded draws rely on it.

**Obstacle Shift** (#486): the obstacle moves, and every Daemon whose Vista contains the origin cell gets a `witnessed-obstacle-shift` entry carrying the obstacle's `shiftFlavor`. A missing obstacle id is skipped silently.

**Convergence** (#305, #336) is evaluated at the end of the round. Daemons standing on the space get the first-person actor flavor (`audience: "actor"`). Other Daemons whose Vista contains the space get the third-person witness flavor. No Daemon gets both. Tier 2 satisfies the objective at once, and satisfied objectives are skipped, so convergence never fires twice. Built-in fallback lines cover packs without convergence flavors.

**`isDevHost`** mirrors the dev-host gate in `src/spa/views/game.ts`. Its `typeof` guards keep it safe in tests, where the build-time constant is not defined.

## Dispatcher (`dispatcher.ts`)

**One message, one action** (ADR 0018). The round coordinator keeps the first `message` call and the first action call, and rejects any later call of either kind with a tool failure the Daemon sees ("only one message tool call per turn", "only one action tool call per turn").

**Speak, then act** (#238). `dispatchSpeechBeforeAction` runs before the action, so the records read as one narrative beat ("I'll grab the key" followed by the pick_up). Recipients are validated against the pre-action `personaSpatial`. That is safe because no action tool can change which Daemons exist. A valid recipient is blue or a live peer other than the sender.

**One interaction range.** `withinInteractionRange` (in `available-tools.ts`) decides tool availability, validation, `use` effects, and the prompt's proximity hints. Keep it the single source, so a tool that is offered never fails validation for reach.

**`go`** accepts only cardinal directions. Relative words (`forward`, `left`, …) are rejected even when a raw tool call bypasses the enum. A step writes the new position and nothing else. Its `diskDelta` (#376) is the `renderWhatsNew` diff of the pre- and post-move snapshots, set only when they differ.

**`use` on an objective space** satisfies a pending Use-Space objective and sets `useAvailable = false`, even when no objective is pending. The actor's result line is the space's `activationFlavor`. It falls back to `useOutcome` because saves authored before #335 have no `activationFlavor`; keep that branch. Witnesses get `satisfactionFlavor`.

**`use` on an interesting object** (#334) satisfies a pending Use-Item objective. `activationFlavor` is returned only on the call that flips pending to satisfied (found by comparing the world before and after execution). Later uses return `useOutcome`. `activationFlavor` has no `{actor}` token (the validator enforces this), so witnesses get it verbatim.

**Carry placement.** `use` on a held carry object places it on its paired space when that space is within interaction range. `pairPlacementFlavor` is non-null only when a put_down or use actually lands the object on its paired space. Once there, the object is fixed to the space: `pairedSpaceHoldingItem` (`available-tools.ts`) leaves it out of the `pick_up` enum, and `validateToolCall` rejects a `pick_up` of it ("set into the … and will not come loose"). Carry satisfaction is positional (`isCarryObjectiveSatisfied`), so without this a Daemon could lift the object off again and un-satisfy the objective, which CONTEXT.md says never happens to a satisfied Objective. The prompt builder uses the same helper to render the object as set into its space. Witnesses get the raw `placementFlavor` from the content pack (`carryObjectById`), with `{actor}` left unsubstituted so each witness can render it.

**pick_up auto-examine.** The actor privately receives the item's `examineDescription` with the success line, so objective details reach its context. No other Daemon or the action log sees it.

**Witnesses are chosen at write time** (ADR 0006). For go, pick_up, put_down and use, each other Daemon whose Vista contains the actor's post-action cell gets a `witnessed-event`. The actor gets nothing, because its tool result is its channel.

**Action failures** (#287) go to the actor's log only and persist across rounds, so a Daemon stops repeating the same rejected action (walking into a wall, for example).

`DROP_CELL_WITHOUT_SPATIAL_STATE` is a guard for a put_down by a Daemon with no position, which normal play never produces.

## Engine (`engine.ts`)

**Pack selectors are the boundary.** `startGame` builds `world.entities` from the pack selectors (`carryPairs`, `boundSpaces`, `interestingObjects`, `standaloneObjectives`, `obstacles`), and `reprojectEntitiesOnto` also finds pack-B entities through the selectors. The engine therefore depends on the selector contract, not on how a pack is stored (packs became a flat `entities` list in #462). `engine.test.ts` asserts that the world is exactly the union of the selector outputs.

**Defaults.** The budget is $0.50 per Daemon for the whole game. With no `objectiveTypes` there are no objectives, which is a vacuous win, useful in tests. The first complication countdown is drawn from [1, 5]. Start cells come from the pack's `aiStarts`, falling back to a partial Fisher–Yates shuffle of distinct cells.

**Setting Shift** (`shiftToBPack`, #302) runs one way, A → B, once per game (the `settingShiftFired` flag). It does nothing when there is no B pack. Pack B mirrors pack A's ids by construction (`generateDualContentPacks`). Presentation fields (name, descriptions, all flavors) come from pack B, while runtime state (`holder`, `satisfactionState`, `useAvailable`) is kept. Ids missing from pack B pass through unchanged. Cardinal directions do not change (ADR 0015).

**Message fan-out.** One `message` entry is written to both the sender's and the recipient's logs. `blue` and `sysadmin` have no log, so only the Daemon side gets the entry, and a message to oneself is written once. `appendPrivateSystemNotice` reuses the `broadcast` kind for a single recipient (tool disable and restore notices). `setWeather` keeps `GameState.weather` and `contentPack.weather` in step.

## Complication engine (`complication-engine.ts`, #296)

The module is pure and takes an injected rng. `tickComplication` returns `null` while the countdown is above zero, and the caller then decrements. At zero it draws a complication, and the caller applies it with `applyComplicationResult`, which resets the countdown to [5, 15].

**The draw pool has a fixed order**: weather_change, sysadmin_directive, tool_disable, obstacle_shift, chat_lockout, setting_shift. Tests pick kinds with rng fractions over this order (`POOL_PICK` in the test), so reordering the pool changes every seeded draw.

**Exclusions.** setting_shift is excluded once it has fired, and when the game has no B pack (a shift would do nothing but still set the fired flag and broadcast "the setting has shifted"). Test games built with `makeTestGame` carry their pack as pack B so the seeded draws see the full pool. obstacle_shift is available only when some obstacle has an in-bounds cardinal neighbour that is free, meaning no grid-resting entity and no Daemon stands there (`isNeighborCellFree`). tool_disable stays in the pool; if every (Daemon, tool) pair is already disabled, the draw is repeated from the pool without it. The disable pool is the five-tool set, and `face` can never be chosen (ADR 0015).

**Persistent and transient.** Sysadmin directives, tool disables and chat lockouts last 3–5 rounds and are tracked in `activeComplications`. Weather change, obstacle shift and setting shift change the world once and are not tracked. `isPlayerChatLockedOut` reports whether a lockout is present, not whether it has expired; `resolveExpiredChatLockouts` removes expired ones.

## Prompt builder (`prompt-builder.ts`)

**Stable and volatile halves.** The system prompt (`toSystemPrompt`) must be byte-identical across rounds for a persona, because OpenRouter's prefix cache hashes the literal request bytes. Everything that changes per round (`<whats_new>`, `<where_you_are>`, `<what_you_see>`) goes in the trailing user turn (`toCurrentStateUserMessage`). Tests pin both properties. DeepSeek renders the tool schemas into the same cached prefix, right after the system prompt, so the per-round enums from `availableTools()` currently break the cache whenever they change. The DeepSeek guide measures this under "Prompt caching" and lists it as an open question.

**System prompt order.** Front matter (English-only directive and fiction framing) comes first. It was put there for GLM-4.7's beginning-of-prompt bias and Chinese-language leakage, and DeepSeek V4.1 Flash keeps it. Then the identity line, then `<rules>` placed early so the mandatory rules sit in the high-attention prefix, then `<setting>`, `<personality>` (the blurb, plus the blue-curiosity line for a curious persona, see `docs/design/content.md`), `<action_profile>`, `<typing_quirks>` (#167, prevents voice bleed between Daemons), `<voice_examples>`, and `<directives>`. The reasons for each technique are in the GLM guide, and the DeepSeek guide says which of them still matter.

- The identity line frames the model as the *author* writing `*{name}, a Daemon.` The e2e SSE stub routes requests on that exact substring; a unit test pins it.
- The game is one continuous session, so there is no memory-wipe or between-phase fiction (#295).
- `<setting>` is the only place cardinal directions are established. They belong to the room, so a Setting Shift or a new room does not change them (ADR 0015).
- `<action_profile>` is omitted for personas saved before the field existed. The prompt is byte-identical when the field is unset.
- `PARALLEL_FRAMING_C12` and its per-turn reminder come from the #239 framing spike. The measurements behind them are in `docs/playtests/archive/0005-session.md` (Steps 5–7). The reminder goes at the very end of the per-round message, the freshest and least-cached position. It ends with "Keep each `message` to 1–3 sentences." because DeepSeek lets the system-prompt length rule slip on talkative and clipped personas (see the DeepSeek guide, "Measured on the game's own evals"). The reminder also says to message blue only with a reason of the Daemon's own. The per-turn state says nothing else about blue: ADR 0018 and the DeepSeek guide, "Messaging blue", explain why per-turn blue lines were tried and dropped.

**`<whats_new>`** contains only changes: the snapshot diff, perception-delta lines, and the current round's broadcasts as `[announcement]` lines. An unchanged Vista produces no block at all.

**Listing rules** beyond ADR 0015. The own cell belongs to `<where_you_are>`, but a peer sharing it is still perceived and listed first ("in your cell"). Ground items are tagged "(on the ground — not held)" (#503). The exception is a carry object lying on its own paired space, which renders as `<name> (set into the <space name>)` in both `Your cell contains:` and the Vista cell line. With the ground tag, a Daemon that had just placed the object read the next state message as the object having fallen, and picked it back up. That undid the Carry objective, which is checked by position. In the 2026-09-28 drift eval (DeepSeek V4.1 Flash), Ember repeated pick_up → use from round 8 to round 30. With the new tag it seated the flashlight and moved on. The tag describes the world only. It does not say that anything is complete, because Daemons are never told about Objectives. Examine descriptions are emitted automatically for held items (#467) and for entities in the Vista (#466), using `postExamineDescription` once the entity is satisfied. Satisfied spaces and interesting objects add their `postLookFlavor` (#334). Objective spaces are places, not items (#573). A space in a Vista cell is named in that cell's line as `<name> (a place, not an item)`, so the line never says `nothing` above the space's own description. A space in the Daemon's own cell gets a separate `You are standing on:` line in `<where_you_are>`, with its examine description and, once satisfied, its `postLookFlavor`. `Your cell contains:` stays items-only because spaces are places, not things to carry. A carry object set into its space is still listed there, as set into it, because it is still an item in the cell. Without these lines a Daemon standing on a Carry target was never told so, and in playtest `0xE05B` it kept reporting the target one step away.

**Objective hints** emit only `proximityFlavor`, at the ADR 0015 distances. They appear in both the snapshot (so `<whats_new>` tracks them appearing and disappearing) and the listing.

**The disk snapshot** keys cells by direction and distance, not coordinates, so it depends only on the observer's position. It is private to `renderWhatsNew`. The `you:` line carries `holding`, `cell` (items on the ground) and `on` (objective spaces in the own cell). It is diffed field by field, so a change in any of them reads as one line, and stepping onto or off a space reads as `~ self.on: …`.

**Perception delta** (#469) edge cases: an entity that is new *and* satisfied gets only the transition line. Movement inside the Vista produces nothing. A destroyed entity counts as departed. Personas are named without flavor. An item picked up by the actor produces no "Lost from view". The own cell is left out of the entity state, except for objective spaces: they never move, so tracking them there keeps stepping onto a space from reading as `Lost from view` (#573). Items stay excluded, so a `put_down` does not produce `Came into view`. A space in the own cell that becomes satisfied does produce the `is now` transition line, as it would one cell away; for Convergence this is how a Daemon standing on the space learns the objective is done.

`describeRelativePosition` throws `RangeError` for a cell outside the Vista, because describing a cell the Daemon cannot see is a caller bug.

## OpenAI message builder (`openai-message-builder.ts`)

**Order:** system prompt, the conversation log (stable-sorted by round), the prior-round tool roundtrip, the silent-turn anchor, and finally the current-state turn. The log only grows, so the cached prefix grows with it.

- Outgoing messages are prefixed `[Round N] you dm <to>:` so the Daemon can track whom it addressed across the whole game; the roundtrip covers only the next round. The tradeoff is that the model may copy the prefix into later `content`. If that happens, fix it in the `message` tool description.
- An outgoing message that has `toolCallId` and arguments is replayed as an assistant `tool_calls` + `tool` pair. When outgoing messages were replayed as free text, Daemons learned to answer in free text (`tool-call-history.test.ts`). Entries without those fields are older data and render as free text.
- Tool-call entries append a stored `diskDelta` inside `<noticed>`, so perceptions persist into later rounds (#376).
- **Silent-turn anchor.** A Daemon that received no `message` this round gets "You have received no messages." Without it, its last user turn is the previous round's player message, and the model answers it again (`non-addressed-anchor.test.ts`).
- Output is deterministic for a given log. Order within a round relies on insertion order, which is safe while `appendMessage` builds logs deterministically. If logs could ever arrive in varying order, entries would need a sequence number.

## Conversation-log rendering (`conversation-log.ts`)

`renderEntry` does not filter: witnesses were chosen at write time (ADR 0006). A witnessed `go` with no `direction` is an older entry and renders without a direction. An action-failure reason loses its trailing period, so the line does not end in "..". The `tool-call` case exists for completeness; the message builder renders tool-call entries itself.

## Round-result encoder (`round-result-encoder.ts`)

- Panels are driven by `message` entries in the logs, not by raw completions (since #214), so the encoder does not take completions.
- `result.round` is the round *after* `advanceRound`, so entries written during the played round have `round === result.round - 1`.
- Only blue's thread is emitted (the DM-thread filter). Daemon-to-daemon messages stay out of the panels.
- Broadcasts and private system notices are not encoded. They live only in the Daemons' logs as LLM context, and the view has nothing to paint for them. A `system_broadcast` event used to be read from the first Daemon's log, but no view consumed it, it was filtered by the played round although complication broadcasts are stamped with the next one, and it would have shown one Daemon's private notices to everyone, so it was deleted.
- The `lockout` event means budget exhaustion only; chat lockouts have their own events.
- `GameState.exhausted` was called `lockedOut` until #576. It was renamed so it is not confused with the Chat Lockout Complication; `engine.dat` still stores it under `lockedOut` (see `persistence.md`).

## Persisted fields and type invariants (`types.ts`)

- `diskDelta` was renamed from `coneDelta` in #539. The rename breaks the saved format, so the same change raised the session schema to v12 and the USB save to v5: old saves show a version mismatch instead of loading without the field.
- `witnessed-convergence.audience` is optional for saves from before #336; treat a missing value as `"witness"`.
- `AiPersona.actionProfile` is optional for saves from before the field existed.
- `ActionFailureTool` is exactly `ToolName`. The only source of a retired name is a raw model call, and `parseToolCallArguments` rejects it before any `ToolCall` exists.
- Every `objective_space` in a pack is either a carry-paired space (named by some object's `pairsWithSpaceId`) or a bound space (Use-Space or Convergence target), never both. `carryPairs` and `boundSpaces` share that test.
- `shiftFlavor`, the convergence flavors and `activationFlavor` contain no `{actor}`; `useOutcome` and `placementFlavor` do. `activationFlavor` is the actor's line at the moment of satisfaction (#335 for spaces, #334 for items).
- `PhysicalActionRecord` is computed during dispatch to choose witnesses and is not stored.
- `contentPacksA` / `contentPacksB` each hold one pack, and B uses A's entity ids.

## Vista geometry (`vista-projector.ts`, `direction.ts`)

- Offsets use ADR 0015's axes: `dx` is positive to the east, `dy` positive to the north. Row 0 is the north edge, so `stepsNorth = observer.row − cell.row`.
- `VISTA_OFFSETS` is in canonical order (own cell, then the ADR diagram from north to south and west to east) and is frozen at every level, because it is exported and a consumer that mutated `steps` would corrupt it for everyone. Multi-axis steps are ordered by `COMPASS_ORDER`, so a north-east diagonal reads "one step north and one step east".
- `projectVista` rejects an out-of-bounds observer, which keeps "the own cell is never a Wall" unconditional. `vistaContains` accepts any positions, because some callers hold out-of-bounds cells.
- `e2e/helpers/vista-geometry.ts` re-implements this geometry because Playwright specs cannot import SPA modules. `e2e-vista-oracle.test.ts` checks the copy against production on every `pnpm test`; change both together.

## Tools, objectives, win condition

- The tool surface is the five-tool Daemon set (ADR 0015). `tool-registry.ts` names and argument keys mirror `validateToolCall` exactly. `availableTools` leaves out tools that cannot succeed and narrows their enums (legal directions, items in reach, held items, usable spaces); an active `tool_disable` removes a tool.
- `message.to` has a leading `*` stripped, because the log shows ids as `*xxxx` and the model sometimes copies the prefix.
- Objective records use the type-first entity-id convention (`carry-{i}-obj`, `carry-{i}-space`, `useSpace-{i}-space`, `useItem-{i}-item`, `convergence-{i}-space`; ADR 0014) and throw `RangeError` when an entity is missing.
- Win condition (#126): a Carry objective is judged from positions (object and paired space resting on the same cell); the other kinds use their `satisfactionState`. Zero objectives is a vacuous win. Placement flavor needs the structural pair: an object resting on a *different* space's cell does not count. The convergence tier is capped at 2.
