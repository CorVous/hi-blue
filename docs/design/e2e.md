# End-to-end specs (`e2e/`)

Why the Playwright specs and their helpers are shaped the way they are. How to
run them, and when an SPA change needs one, is in
[`docs/agents/testing.md`](../agents/testing.md). That page also has the one
stubbing rule every spec depends on: `page.route` sees only requests the page
itself fires, never `page.request.*`.

## Harness (`playwright.config.ts`)

- The web server is `pnpm build` plus `wrangler dev --local --port 8787` with a
  test `OPENROUTER_API_KEY`. `WORKER_BASE_URL` keeps its default, so `__DEV__`
  is true. Every dev-only affordance the specs use exists here: the dev
  inspector (`#dev-world-map`), the dev game strip (`.dev-strip-line`),
  `?think=1` and `?winImmediately=1`.
- CI runs one worker with two retries. Locally the `workers` key is left out so
  Playwright picks a count itself. The key is spread in conditionally because
  `exactOptionalPropertyTypes` rejects `workers: undefined`. `goToGame` spreads
  `synthesis` the same way.
- No spec talks to a real model. Every `/v1/chat/completions` call is answered
  by a `page.route` stub.

## Conventions shared by the specs

- **`?skipDialup=1`.** `#begin` is enabled by `revealLogin()` in
  `src/spa/views/start.ts` and by nothing else. The dial-up animation is a
  ~327-character `setTimeout` chain that takes about 7s, and 10s or more under
  parallel load. Specs skip it so that they time the thing they are named for
  and not the animation. `goToGame` adds the flag to any URL it is given.
- **Route precedence.** Playwright runs the most recently registered route
  first, and `route.fallback()` hands the request to the next one down. Specs
  install the general stub first and then layer a narrow handler on top that
  falls back for everything it does not care about (see
  `bootstrap-recovery`, `persistence-reload`, `witnessed-event-reload`). Calling
  `stubChatCompletions` again replaces the replies for the same reason. After a
  `page.reload()`, specs register a fresh stub so that the replies for the
  restored session are ones the spec controls.
- **Mention stripping.** `src/spa/views/game.ts` strips the leading `*<name>`
  mention before it renders the player line, so a transcript shows
  `> hello` and never `> *Name hello` (post-#214). `renderedPlayerLine` builds
  the line a spec should expect.
- **1px tolerance.** Layout assertions allow 1px (`SUBPIXEL_TOLERANCE_PX`)
  for sub-pixel rounding.
- **Post-ADR 0011 routing.** The URL no longer decides what renders; the SPA
  reads localStorage. Specs assert on `main[data-view]` and `main[data-reason]`
  and never on `location.hash`.
- **Send after a round.** Since #107 the prompt is cleared on submit, and an
  empty prompt has no mention, so `#send` does not re-enable after a round.
  Specs wait on storage or on transcripts instead.

## Helpers (`e2e/helpers/`)

### `stubs.ts`: LLM stubs, storage access, navigation

- A request body's `messages[0]` is the system prompt and `messages[1]` the
  user message. A call is JSON mode when `stream === false` or it sets
  `response_format`. `classifyJsonRequest` tells the new-game callers apart by
  their user-message preamble: persona synthesis, dual A/B content pack, or
  single content pack.
- An unrecognised JSON-mode call **throws**. Silently answering it with a
  persona-shaped reply was the bug this helper was written to prevent, so a new
  caller must fail loudly until the stub learns it.
- Canned JSON replies echo their input. Synthesis returns the persona ids it was
  sent. Content packs rebuild the requested bindings, add two decoys (specs rely
  on those two `interesting_object` entities) and as many obstacles as the
  prompt lists.
- Gameplay SSE replies are a single `message` tool call to `"blue"` carrying the
  joined words, followed by a usage chunk with a non-zero cost so that budget
  deduction runs. Since #214 panels render only entries the `message` tool
  writes into the conversation logs, and free-form `delta.content` is never
  painted. The shape mirrors `makeMessageToolCallSseStream` in
  `src/spa/__tests__/game.test.ts`. The SPA paints each message whole, with no
  pacing, so the stub does not throttle.
- `toolCallSseBody` drives one live action (`go`, `pick_up`) for a chosen
  Daemon. The parser in `src/spa/streaming.ts` flushes tool calls on
  `finish_reason: "tool_calls"` or `[DONE]`.
- `isRequestForDaemon` finds a Daemon's request by the identity line of its
  system prompt, `You are the author writing *<name>, a Daemon.`
  (`prompt-builder.ts`).
- `goToGame` is the shortcut for specs that are not about the start screen:
  stub everything, navigate, wait for `#begin`, log in, wait for the game view,
  and return the handles. Its 10s budgets are enough because the stubs answer
  instantly. Start-screen specs must drive the start screen themselves.
- **Save order.** A save writes `meta.json` first and `engine.dat` last.
  `waitForRound` polls `meta.json`, so it proves a round was saved but not that
  the engine state is in. When an assertion needs engine data, wait with
  `waitForSavedPosition` instead. Its predicate runs inside the page, where
  Node imports are unavailable, so it inlines the XOR decode from
  `engine-blob.ts`. Keep the two in step.
- **`waitForFirstRoundSaved`** polls `meta.round >= 1` for up to `timeoutMs`
  (15 s by default). Since #173 BEGIN saves `engine.dat` at round 0, so the
  file's presence no longer means a round finished. The round save runs after the encoder loop has drained every event,
  which is later than the live transcript fills, so a transcript check is not
  the signal either.
- `page.waitForFunction` takes `(pageFunction, arg, options)`. A poll with no
  argument must pass `undefined` second and `{ timeout }` third: passed second,
  the object becomes the page function's argument and no timeout applies.
  `getAiHandles`, `waitForFirstRoundSaved` and `start-screen.spec.ts`'s
  `waitForActiveSession` follow this form.
- `SealedContentPack.entities` is the flat entity list of session v11 and later.
  `obstacles` is the bucketed list of older blobs, and `obstacleCellsOf` uses it
  only as a fallback.
- `stubs.ts` re-exports `engine-blob.ts` and `vista-geometry.ts`, so specs
  import from one place.

### `engine-blob.ts` and `vista-geometry.ts`: deliberate mirrors

Specs may not import SPA modules, so these two files are copies of production
code. They are leaf modules with no Playwright import, so unit tests can load
them.

- `engine-blob.ts` mirrors `obfuscate` / `deobfuscate` in
  `src/spa/persistence/sealed-blob-codec.ts`. `engine.dat` is XOR-obfuscated
  and base64-encoded, not encrypted. Specs read it and sometimes rewrite it to
  seed a state.
- `vista-geometry.ts` is the e2e copy of the ADR 0015 Vista (#539):
  - `VISTA_OFFSETS` and `vistaCells` mirror `VISTA_OFFSETS` / `projectVista` in
    `src/spa/game/vista-projector.ts`.
  - `inVista` mirrors `vistaContains`: `dx² + dy² ≤ 4`, with north decreasing
    the row. Membership depends on position alone. Obstacles never occlude, and
    Daemons have no orientation.
  - Cell labels mirror `describeSteps` plus `capitalize` in `prompt-builder.ts`.
    Offsets use production's convention: `dx` runs east, `dy` runs north.
  - `RELATIVE_DIRECTION_WORDS` is not geometry. It is an absence check for the
    orientation vocabulary that ADR 0015 retired.
- `src/spa/game/__tests__/e2e-vista-oracle.test.ts` binds the Vista copy to
  production on every `pnpm test`. It walks every room position and the
  one-cell wall ring. A spec can only compare the page with the copy, so a
  misconception shared by both would pass without that test, and Playwright
  does not run everywhere. Change the copy and the production geometry
  together.

### `picker-seeds.ts`: the "ok" session for the sessions picker

The picker classifies a row by asking the live version boundary whether the
save is current. The seed must therefore be sealed at the live session schema
(`SESSION_SCHEMA_VERSION` in `src/spa/persistence/version-constants.ts`), in the
shape `serializeSession` writes. No in-place migration reaches the live schema,
so an older stamp is reported as `version-mismatch`, and the row then loses its
`[ load ]` / `[ dup ]` / `[ rm ]` buttons.
`src/spa/persistence/__tests__/picker-ok-seed.test.ts` binds these bytes to the
live boundary. It checks that the stamp equals `SESSION_SCHEMA_VERSION`, that
`deserializeSession` / `getSessionInfo` classify the bytes as `ok`, and it runs
the same init-script source against a localStorage. After a schema bump, update
`LIVE_SESSION_SCHEMA_VERSION` and the payload shape here.

### `start-screen-ready.ts`: `waitForStartScreenReady`

With the dial-up skipped (or `prefers-reduced-motion`), `revealLogin()` runs
synchronously in the first `renderStart`. "`#begin` enabled" therefore means
"the SPA booted", not "generation finished"; generation carries on in the
background. A fixed 10s wait for it measured bundle boot under whatever load
the machine had, and that is what made two `start-screen.spec.ts` tests flake.
The helper waits on the real signal, a published `main[data-view]` plus an
enabled `#begin`, and so resolves as soon as the app is ready. Its 30s budget is
the repo's ceiling for boot under arbitrary load, not a tuned timing.

On timeout it checks for `#cap-hit` so that a broken stub reports that cause
rather than a bare timeout. This check only diagnoses failures that prevent
boot. On the normal path the helper resolves before generation can reject, so
specs that assert on generation failure check `#cap-hit` themselves.

### `handles.ts` and `page-errors.ts`

- `getAiHandles` waits up to 30 s for three `article.ai-panel` elements whose
  `data-ai` is set, which happens once persona synthesis lands. It reads each
  display name from `.panel-name` (`*Name`), and `mention(i)` builds the
  composer mention. Specs never hard-code handles.
- `pageerror` events are dispatched asynchronously. An error thrown in a
  microtask or a timer can arrive after the test's last `await`, so a
  synchronous `expect(pageErrors).toEqual([])` misses it.
  `expectNoPageErrors` lets such errors settle for 100 ms before it asserts.
  `smoke.spec.ts` checks that the helper catches a late microtask error.

## What each spec guards

| Spec | Behaviour or regression it guards | Refs |
| --- | --- | --- |
| `smoke` | The SPA root renders three panels with 4-character `[a-z0-9]` handles and a composer, and `expectNoPageErrors` catches late errors. | |
| `addressed-and-parallel` | An addressed message lands once, on the addressed panel only, and each completion lands in exactly one panel. Turn order is shuffled every round, so completions are assigned by call order. | #214, #151 |
| `mention-addressing` | `*mention` addressing replaced the address dropdown, and Send stays disabled without a mention. | #107 |
| `visual-feedback` | The addressed panel gets `panel--addressed`, the overlay renders one `.mention-highlight`, clicking a panel moves the mention, and clearing the prompt removes all feedback. | #109 |
| `token-pacing` | After the round commits, `thinking…` clears and the full reply lands in the addressed panel. Since #214 the reply arrives as a `message` tool call, so the old word-by-word streaming checks no longer apply. | #214 |
| `think-disabled` | Every turn sends `reasoning: { enabled: false }` so GLM-4.7 skips thinking, and the dev-host-only `?think=1` removes the field. Unit tests lock the body shape; this spec covers the wiring from URL to `isDevHost()` to `BrowserLLMProvider` to the request. | |
| `persona-synthesis` | Synthesized blurbs flow from the persona record through `prompt-builder` into each Daemon's streaming system prompt. | |
| `chat-lockout` | A lockout restored from storage mutes its panel before any typing, disables Send for that Daemon, and says nothing in the transcript. | |
| `endgame-current-behaviour` | `game_ended` disables the composer, shows the choices, and keeps the URL. The active-session pointer survives until the player chooses. | #80, #101, #307 |
| `endgame-choices` | The end-game choice screen: New Daemons archives the session and the dispatcher mints a new one; Continue appears only when `openrouter_key` is set. | #307 |
| `bootstrap-recovery` | The regenerate path re-runs content-pack generation without re-resolving personas, and abandon returns to start with `data-reason="broken"`. | #380 |
| `bootstrap-failure-bounce` | A content-pack failure after CONNECT, whether a network abort or an HTTP 200 with an error body, shows `#bootstrap-recovery` inside the game view instead of bouncing to start. | #380 |
| `start-screen` | Start-screen boot, login, restore on refresh, cap-hit, refresh during generation, and an empty active pointer. | ADR 0011 |
| `sessions-picker` | Picker rows for ok, broken and version-mismatch saves; load, dup and rm; the sessions icon; sticky routing; archived-build links. | ADR 0011 |
| `persistence-reload` | Transcripts and budgets survive a reload, and a live-schema session round-trips position, inventory, content state, conversation and perception changes. | #173, #214 |
| `witnessed-event-reload` | A live `go` produces a witnessed-event entry that survives reloads and appears in the witness's turns but never the actor's. | #196, #195, PRD #157, ADR 0015 |
| `whisper-tampering` | Each Daemon's `<aiId>.txt` is the only source of its message history, and an entry injected into one Daemon's file appears in no other Daemon's prompt. | #213 |
| `dev-inspector` | The dev world map in a real browser: a 5×5 room-only board, markers that carry identity only, the focus Vista tint, and narrow viewports. | #540, ADR 0015 |
| `mobile-overflow` | The app shell does not overflow horizontally at phone widths. | #554 |
| `responsive-bento` | The ≤720px bento layout, strip-card previews, and the mobile header. | |

### Notes on individual specs

- **addressed-and-parallel.** The spec does not use `?winImmediately=1`. A
  winning round paints the panels and clears them again in one synchronous
  burst, so the painted state would never be observable. An earlier
  `divergentSample` check for progressive rendering was dropped (#151): with
  stubbed SSE a round finishes in under 100 ms, so the sampler caught only two
  or three frames and flaked. Render-timing coverage belongs in a
  deterministic harness.
- **winImmediately.** `?winImmediately=1` wraps `submitMessage` so that the
  next submit ends the game (`applyTestAffordances` in `game.ts`).
- **chat-lockout.** Lockouts come from complications and there is no URL
  affordance for them, so the spec writes a `chat_lockout` complication into
  `engine.dat` and reloads. `refreshComposerState` paints `panel--locked` by
  `[data-ai]`, so it must run after panel setup has assigned those attributes.
  When it ran earlier, a restored lockout looked unlocked until the player
  typed.
- **bootstrap-recovery.** The initial bootstrap uses up the content-pack
  provider's `OUTER_ATTEMPT_BUDGET` (3 calls) before the recovery UI appears. Regen
  starts a fresh budget, so the fourth call is allowed to succeed.
- **bootstrap-failure-bounce.** The content-pack failure is held back until the
  game view is attached. That way the loading-flow catch in `game.ts`, which
  shows the recovery UI, handles it, and not the start screen's catch, which
  bounces to start with `reason=broken`.
- **start-screen.**
  - The mobile media query's `#panels.row { display: grid }` outranked
    `[hidden]` and leaked the chat panels onto the start screen.
  - JetBrains Mono ligates `**` and `***`, which misaligns a masked password,
    hence `font-variant-ligatures: none`.
  - The SPA deliberately re-throws `CapHitError` after showing `#cap-hit`, for
    dev-console diagnostics, so the cap-hit spec filters that one error out.
  - The refresh-during-generation spec holds generation on a promise that never
    settles. Reloading aborts the in-flight request, so the test does not
    stall. The fast stub is installed before the reload.
- **sessions-picker.** Schema 11 is the last schema shipped by the released
  `0.0.2-beta.2` and is mapped in `SCHEMA_ARCHIVE_MAP`. A save stamped 11 must
  surface as a mismatch that links to that build, with its bytes untouched.
  Schema 999 has no map entry and shows the plain mismatch copy. Since
  ADR 0011, whether the picker is open lives in memory, so a refresh returns to
  the dispatcher's natural view.
- **persistence-reload.** Two states cannot be reached by playing a round
  deterministically: an item held by a Daemon, and an item lying on the
  destination cell (which guarantees a non-empty `diskDelta`). The spec seeds
  both through `engine.dat`, and everything after that runs through the live
  runtime. A Setting Shift may swap pack A for pack B during either round, and
  the stub packs share entity names, so assertions accept either authored
  setting. The re-saved bytes must not contain the retired per-Daemon
  orientation key (`facing`) or the retired Content Pack anchor key
  (`landmark`).
- **witnessed-event-reload.**
  - The spec first looks for a direct plan: an actor whose one-step
    destination already lies in another Daemon's Vista. If the layout has
    none, it moves a witness to the cell behind the actor, opposite the step.
    The destination is then two steps from the witness (`2² = 4 ≤ 4`).
  - The spec reloads before the action round. After a fresh new game,
    `renderGame` runs twice (once for bootstrap loading, once after
    generation), which registers two input listeners, and the first
    closure's `personaNamesToId` is never populated, so `page.fill` may not
    enable `#send`. The restore path renders once.
  - The first round dispatched after that reload is round 0, so the witness
    sees `[Round 0] You watch *<actorId> walk <direction>.`. The write-time
    fan-out appends only to witnesses, never to the actor.
- **whisper-tampering.** The conversation is rendered as role turns, not in
  the system prompt. An incoming message renders as
  `[Round R] *<from> dms you: <content>` (`renderEntry` in
  `conversation-log.ts`, via `openai-message-builder`).
- **dev-inspector.**
  - This is the only coverage of the real inspector DOM. The jsdom tests
    live under `src/spa/dev-inspector/__tests__/`.
  - A persona handle can itself be `east` or `left`, or contain `v`, so
    direction checks run against the tooltip minus the handle and never
    against the handle text.
  - `data-rows` / `data-cols` come from the renderer, so the layout test
    measures the geometry the browser actually produced. A 7-column template
    would put the 25 cells on four rows.
  - Spawn cells are random, so the rule that an edge Daemon gets a clipped
    Vista is also checked exhaustively against the oracle.
  - At 375px the mobile media query hides `#banner-row`. The narrow tests
    assert that the hidden board stays coherent, and then lift the rule to
    measure the real box.
  - Overflow is measured on the inspector's container and not on `body`,
    because the app header could overflow a 375px viewport by itself. That
    was a real defect, tracked by #554, and it made these assertions flaky.
- **mobile-overflow.** `#stage` is a grid with one implicit `auto` column,
  and grid items default to `min-width: auto`. The track is therefore sized by
  the widest row's min-content, and every other row stretches to it. The
  `.dev-strip-line` rows were nowrap flex containers, whose min-content is the
  sum of their items. Line 1 carries the random setting, weather and
  time-of-day, which sometimes exceeded the ~351px available at 375px. When
  they did, the track grew and dragged the header, `.topinfo`, `#panels` and
  `#composer` past the viewport. Because this depended on content, it passed
  alone and failed about one run in four under load. The fix is
  `flex-wrap: wrap` on `.dev-strip-line`. The specs assert the acceptance
  criterion `body.scrollWidth ≤ innerWidth + 1` both on a natural boot and
  with forced wide strip content, since the natural case alone could pass by
  luck. The stage track at 375px is `351px`, which is 375 minus two 12px
  gutters.
- **responsive-bento.**
  - `.ai-panel { flex: 1 1 0; width: 0 }` from the desktop row leaked into
    the bento grid and collapsed every panel to 0px.
  - Strip cards previewed the oldest lines and wrapped long ones. The fix
    uses `nowrap` plus an ellipsis, and one 11px line at `line-height: 1.45`
    is about 16px tall, under the 22px ceiling.
  - `renderRestoredTranscript` used to split a saved multi-line AI message
    into several `.msg-line`s.
  - `engine.dat` already exists from the start save, so the spec waits for
    the Daemon file's conversation log to be non-empty before it reloads.
