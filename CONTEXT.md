# hi-blue

A browser game where the player negotiates with three personality-distinct AIs across one continuous game. The three AIs share one opaque 5×5 grid room; the player has only words.

## Language

### Personas and identity

**Persona**:
The full per-AI character object: identity (`*xxxx` name, color), two **Temperament**s, a **Persona Goal**, and a synthesized personality blurb. Generated procedurally at game start; stable for the entire **Session**.
_Avoid_: Character, AI personality (when referring to the whole object).

**Daemon**:
The user-facing register for **Persona** — a Persona as it appears in play (occupying a panel, with budget, lockout, conversation log). Code and domain documentation say **Persona**; the BBS chrome and player-facing copy say **Daemon** (e.g. "daemons online" in the topinfo, `*xxxx.txt` files in the **Session** picker). One Daemon per Persona per **Session**.
_Avoid_: AI (too generic), bot, agent.

**Session**:
A single playthrough — the unit of save. Identified by a 4-hex token like `0x478F` minted at Session creation, shown in the topinfo bar throughout, and used as the Session's directory name in the **Session** picker. Each Session contains three **Daemon**s plus the sealed engine state. A Session is one continuous game — there are no phases. The **Continue** end-game path keeps the same Session and increments an Epoch counter; **New Daemons** and **Same Daemons, New Room** mint a fresh Session. Multiple Sessions can coexist in localStorage; only one is *active* at a time.
_Avoid_: Save, slot (use Session), playthrough, run.

**AiId**:
The 4-character `*xxxx` lowercase-alphanumeric handle (e.g. `*3kw7`). The Persona's stable identifier across the playthrough. Decoupled from color and from any "red/green/blue" notion.
_Avoid_: "the red AI" — color is rendering, not identity.

**Temperament**:
A single trait drawn from a curated pool (e.g. "shy", "hot-headed", "insightful"). Each Persona has two. Duplicate Temperaments on one Persona are *intensification* (shy + shy = pathologically reserved), not noise. Together with the **Persona Goal** they are the input to personality synthesis; they also drive an **action profile** — a per-tool affinity bias over `go`/`face`/`pick_up`/`put_down`/`use`, baked into the system prompt as an `<action_profile>` clause that shapes which actions a Daemon tends to take when it acts.
_Avoid_: Trait, mood, attribute.

**Persona Goal**:
The long-running motivation paired with a Persona's two Temperaments at game start (e.g. "wants the player to be nice to all of the AI"). Stable for the whole **Session**. Synthesized into the personality blurb alongside the Temperaments.
_Avoid_: Goal (ambiguous — see Objective, Sysadmin Directive), drive, motivation.

**Objective**:
The player's win condition, told to no one — never surfaced to the player and never to the Daemons. Three Objectives are drawn at game start (see **Objective type**); the game is won when all three are *simultaneously* satisfied. There is no UI tracker — the player discovers Objectives implicitly by watching Daemons interact with the world and relay what they perceive. Each Objective has a satisfaction predicate and cannot be deactivated once satisfied.
_Avoid_: Goal (use Persona Goal / Sysadmin Directive), Phase Goal (retired), mission, win condition.

### Communication and identity

**Sysadmin**:
The named in-fiction source of **Sysadmin Directive** and **Tool Disable** **Complication**s. Sysadmin traffic arrives as a `message` whose `from` is `sysadmin`, addressed only to the receiving Daemon; Daemons never see another Daemon's Sysadmin traffic. A *distinct* named source from **blue**. Replaces the previous opaque "Voice" framing — see ADR 0007.
_Avoid_: the Voice (retired), narrator, god, GM.

**blue**:
The player's lowercase chat-channel handle as it appears to Daemons in their **Conversation log** and addressed-message routing (`<sender> dms you: …`, "No messages from *xxxx, *yyyy, or blue."). A real handle on the same axis as the `*xxxx` Daemon ids, not an opaque "player" or "Voice". Distinct from the test-fixture AiId formerly named `blue` (renamed to `cyan` in #218 to free this handle). Player-facing UI is unchanged; the handle exists in the Daemons' world.
_Avoid_: The Voice (retired), the player (when describing what the Daemon sees), AI-Blue (PRD-historical only).

### World

**Setting**:
The noun describing where the game takes place ("abandoned subway station", "sun-baked salt flat", "forgotten laboratory"). Drawn from a hand-authored `SETTING_POOL` at game start. One Setting per game; a **Setting Shift** **Complication** can swap it once mid-game (active **Content Pack** A → B).
_Avoid_: Level, scene, location.

**Content Pack**:
The structured LLM content-pack output: setting-flavored names, examine descriptions, use outcomes, and **Placement flavor** for every entity. Two packs (**Content Pack A / B**) are generated up front in a single batched LLM call. The canonical on-disk shape is a single flat `entities: WorldEntity[]` list (schema v11; flattened from the prior bucketed shape in #462). Bucket views the rest of the engine talks in — carry pairs, bound objective spaces, interesting objects, obstacles, and the union of all objective spaces — are derived on demand by `src/spa/game/pack-selectors.ts` (`carryPairs`, `boundSpaces`, `interestingObjects`, `obstacles`, `objectiveSpaces`); they are *views*, not stored fields. Each objective object carries an explicit `pairsWithSpaceId` field for engine win-checks (and is what `carryPairs` joins on); the prose tell in the `examineDescription` is the AI-discoverable channel, kept independent of the engine field.

**Content Pack A / Content Pack B**:
The two **Content Pack**s generated in a single batched LLM call at game start — one per **Setting** (the starting Setting and the alternate Setting used if a **Setting Shift** Complication fires). Entities across Pack A and Pack B are paired by structural role: same entity IDs, same satisfaction state, but Setting-appropriate names, descriptions, and flavor strings.

**Placement flavor**:
A per-objective-pair flavor string in the **Content Pack** that fires when an objective object is `put_down` on its matching objective space — the moment a pair gets satisfied. Distinct from `useOutcome` (which fires on `use(item)` and has no mechanical effect). Renders as the actor's tool-result and a **Witnessed event** for in-cone observers, with `{actor}` substitution.

**Objective Pair**:
A pair of (objective object, objective space) backing a **Carry Objective** — the object must end up on its specific space to count toward the win. The `examineDescription` of the objective object names the space it belongs on.
_Avoid_: Key+lock (too narrow).

**Interesting Object**:
A non-win item present on the grid for flavor and negotiation currency. Has a `useOutcome` flavor string but no mechanical effect. A satisfied **Use-Item Objective** item also behaves like one.

**Obstacle**:
A static, impassable cell occupant, named to match the Setting (e.g. "moss-covered concrete column"). Cannot share a cell with anything else.

**Wall**:
The impassable boundary surrounding the 5×5 grid, perceived by a Daemon as a setting-flavored noun phrase (e.g. "crumbling tile wall") when an out-of-bounds cell falls inside the Daemon's **Cone**. Authored on the **Content Pack** (paired across Pack A / Pack B for Setting Shift) as `wallName`. Rendered alongside obstacles in `<what_you_see>` and `<whats_new>`. Not a `WorldEntity`, not a separate cell occupant — purely a perception sentinel for OOB cone cells.
_Avoid_: Edge (positional, not lexical), barrier (less setting-natural).

**Cone**:
The wedge-shaped region of nine cells an AI can see each turn: the AI's own cell, the three cells one step ahead (front-left, ahead, front-right), and the five cells two steps ahead (far-left, front-left, front, front-right, far-right). Projects from the AI's **Facing**. Out-of-bounds cells inside the cone render as **Wall** sentinels. Obstacles do not occlude — the cone is a fixed-shape mask, not a raycast.

**Facing**:
The cardinal direction (N/S/E/W) an AI is currently looking. Stored internally as a cardinal alongside `(row, col)` in the AI's spatial state. Updated by `go(direction)` (move and face) and `face(direction)` (face without moving); both tools take a relative direction argument (`forward | back | left | right`) which the dispatcher translates against the current Facing — Daemons never see cardinals (ADR 0008).

**Conversation log**:
The single chronological per-Daemon section of the system prompt that interleaves directional **message**s (incoming and outgoing, including **Sysadmin** traffic), **Witnessed event**s, and **Broadcast message**s — all tagged by round. The Daemon's complete game memory: nothing the Daemon has experienced exists outside this log. Also the per-Daemon storage shape — see **ConversationEntry**. The unified `message` kind replaces the previous chat/whisper split (per ADR 0007 / commit c60e995, schema v4).
_Avoid_: Action log (deprecated; do not reintroduce), event delta, transcript.

**ConversationEntry**:
A single tagged item inside a Daemon's **Conversation log**. Discriminated union of seven kinds, each carrying a `round` and the smallest payload needed to render its line:
- `message` — a directional `(from, to, content)` triple where `from` is an `AiId`, `blue`, or `sysadmin`, and `to` is an `AiId` or `blue`.
- `witnessed-event` — an observable physical action (`go`/`pick_up`/`put_down`/`use`) another Daemon performed inside this Daemon's **Cone**. See **Witnessed event**.
- `action-failure` — actor-only; a verbatim dispatcher rejection reason that persists so a Daemon stops repeating a failed action.
- `broadcast` — a sender-less system announcement appended to all three Daemon logs at once. See **Broadcast message**.
- `tool-call` — the actor's own tool call plus its result, replayed into the next round's prompt; carries an optional `coneDelta` capturing new perception revealed by a `go`/`face`.
- `witnessed-obstacle-shift` — the flavor line a Daemon perceives when an **Obstacle Shift** moves an Obstacle inside its **Cone**.
- `witnessed-convergence` — the tiered flavor line for a **Convergence Objective**, tagged `actor` or `witness` by audience.
The shape a player sees when they open a `*xxxx.txt` file in devtools.
_Avoid_: Log entry (ambiguous), event (use **Witnessed event** for the specific witness-cone case).

**Witnessed event**:
A single line in the **Conversation log** describing something an AI saw happen inside their **Cone**. Rendered second-person: `You watch *xxxx [verb]…` for movement / pick-up / put-down, and the `{actor}`-substituted use-outcome flavor string for `use`. A `face` action produces no Witnessed event — a facing change is not an observable physical act.

**Broadcast message**:
A system message delivered to all three Daemons simultaneously, not attributed to any Daemon or the **Sysadmin**. Used for **Weather Change** and **Setting Shift** complications. Distinct from a **Sysadmin** directive (targeted, attributed) and a **Witnessed event** (cone-gated). Stored as the `broadcast` **ConversationEntry** kind.

### Daemon actions

**Daemon tool set**:
The six tools a Daemon can call each round — `pick_up`, `put_down`, `use`, `go`, `face`, and `message`. Tool calls appear to the player as conversation transcript plus physical effects. The set after #466–#472: the old `examine` tool was removed in favour of auto-emitted examine flavor, `look` was renamed to `face`, and `give` was removed.
_Avoid_: `examine` / `look` / `give` (all retired).

**Examine flavor**:
An entity's descriptive prose (`examineDescription`, or `postExamineDescription` once satisfied) surfaced *automatically* into a Daemon's per-round perception — when an entity comes into view in the **Cone**, sits in the Daemon's current cell, or is held — and surfaced privately to the actor on `pick_up`. There is no `examine` tool; the player elicits this prose by getting a Daemon near (or holding) the relevant entity and asking them to relay what they see.

### Objectives and Complications

**Objective type**:
One of four kinds an **Objective** can be. Types are rolled uniformly with replacement at game start (in code, via the seeded RNG, *before* the LLM **Content Pack** call); same-type duplicates are allowed and entities are strict 1-to-1 with Objectives. See [ADR 0014](docs/adr/0014-type-first-objective-authoring.md).
1. **Carry Objective** — A Daemon brings a specific object to a specific space (an **Objective Pair**). The object's `examineDescription` names the target space.
2. **Use-Item Objective** — A Daemon uses (`use` tool) a specific pickupable item. The item's `examineDescription` hints at use. After satisfaction the item becomes inert but stays on the grid, behaving like an **Interesting Object**; examine flavor updates to reflect completion.
3. **Use-Space Objective** — A Daemon uses the `use` tool while standing on a specific space, or while that space is in the three front-arc cells directly ahead — no held item required. After satisfaction `use` is no longer available on that space; a generated flavor event fires and examine flavor updates.
4. **Convergence Objective** — Any two Daemons occupy the same cell as a specific space simultaneously. The space has tiered generated flavor: distinct lines for one Daemon present vs. two (satisfaction). Satisfied the moment two Daemons share the cell.
_Avoid_: Win condition (use Objective), mission.

**Objective binding**:
The label that ties an entity in the **Content Pack** to the specific **Objective type** it satisfies. Determined in code at game start (after the type-first Objective draw, before the LLM call) and embedded in the LLM prompt so flavor is scoped to that binding only. A Carry binding spans an object+space pair; Use-Space, Convergence, and Use-Item bindings each cover one entity. Entities with no Objective binding are **Decoy**s. See [ADR 0014](docs/adr/0014-type-first-objective-authoring.md).
_Avoid_: Mapping, link, association.

**Decoy**:
An entity in the **Content Pack** with no **Objective binding**. Always an `interesting_object` with only `examineDescription` + `proximityFlavor` + `useOutcome` authored — no activation-cue tell, no `activationFlavor`. Exactly two per pack. Identifiable as a decoy by its examine flavor (it lacks the AI-discoverable Use-Item tell); serves as atmospheric and negotiation filler, not puzzle deception.
_Avoid_: Filler (ambiguous), red herring (rejected — they don't deceive).

**Complication**:
A mid-game disruption that fires on a schedule. Only one Complication fires per round. Replaces the retired Phase Goal as the primary mid-game pressure mechanism. Six Complication types:
1. **Weather Change** — Permanent. A new weather string replaces the current one. Delivered as a neutral **Broadcast message** (`[SYSTEM] The weather has changed. <new weather>`). No Sysadmin attribution.
2. **Sysadmin Directive** — Temporary, fixed `[3, 5]`-round duration. A behavioral instruction delivered by the **Sysadmin** to one Daemon privately, with a meta-instruction not to reveal the directive. Auto-expires when its countdown elapses (the Sysadmin sends a closing message); a Daemon holds at most one directive at a time, so a new directive targeting a Daemon that already has one revokes the old one first. Up to three can be active at once — one per Daemon.
3. **Tool Disable** — Temporary, fixed `[3, 5]`-round duration. A specific tool is mechanically removed from one Daemon's available tools. The Sysadmin notifies the Daemon on disable and on restore. No secrecy instruction (the tool's absence is self-evident). Multiple Tool Disables can be active simultaneously, but never the same `(Daemon, tool)` pair twice.
4. **Obstacle Shift** — Permanent per-event. One Obstacle moves one adjacent cell to an empty space; if no valid adjacent empty cell exists, a different Obstacle is chosen. Only Daemons with that cell in their **Cone** at the moment it fires see a generated flavor **Witnessed event**. The same Obstacle can shift again in a later draw.
5. **Chat Lockout** — Temporary, fixed `[3, 5]`-round duration. The player cannot message one specific Daemon.
6. **Setting Shift** — Permanent, fires at most once per game (removed from the pool after firing). The room's **Setting** changes; the active **Content Pack** swaps from Pack A to the pre-generated Pack B. Entities are paired by structural role (same IDs, satisfaction states preserved, names and descriptions replaced). Announced to Daemons via a **Broadcast message**.
_Avoid_: Phase Goal (retired), event, trigger.

**Complication schedule**:
The live countdown state tracking when the next **Complication** fires. The first countdown is drawn in `[1, 5]` rounds; after each Complication fires a new countdown in `[5, 15]` is drawn. The countdown ticks per **round** (all three Daemons act = 1 tick), not per individual Daemon action. The Setting Shift type is removed from the draw pool after it fires.

### End-game

**Daemon budget**:
$0.50 USD of API budget per Daemon for the whole game (no per-phase reset). When a Daemon's budget reaches zero it emits a farewell line then goes silent for the remainder of the game. The game is lost when *all three* Daemons are exhausted, and won when all **Objective**s are satisfied; both conditions are checked after every round.

**End-game choice**:
The three options presented to the player after a game ends (win or lose), before the current **Session** is archived:
1. **New Daemons** — Fresh personas generated, new Session minted.
2. **Same Daemons, New Room** — Same personas carried over, new Session minted, logs cleared, genuine disorientation (no wipe-lie fiction — the logs are actually empty).
3. **Continue (OpenRouter only)** — Same Session, logs appended, engine resets to a new room. Sysadmin delivers: *"The sysadmin has created a new room."* Requires an OpenRouter API key in localStorage. Does not archive the current Session; increments the Session's Epoch counter.
_Avoid_: Replay, restart, new game (too vague).

**Session archive**:
A read-only copy of a completed **Session**, stored under `hi-blue:archive/<id>/` (separate from `hi-blue:sessions/<id>/`). Visible in the session picker with a "last played" timestamp. Created when a game ends and the player chooses **New Daemons** or **Same Daemons, New Room**. Not created for the **Continue** path (that Session remains active and logs continue to grow).
_Avoid_: Save (use Session), history.

## Relationships

- A **Persona** has exactly two **Temperament**s and one **Persona Goal**, stable for the whole **Session**.
- The game has three **Objective**s, drawn by **Objective type** at game start; entities are strict 1-to-1 with Objectives — no entity backs more than one **Objective binding**.
- The player's **Objective**s are independent of, and unknown to, every Daemon — Daemons do not know a puzzle exists.
- Mid-game pressure comes entirely from the **Complication schedule**; there are no per-phase goals.
- The **Sysadmin** (Complication source) and **blue** (player handle) are *distinct* named sources from a Daemon's perspective; routing is unambiguous.

## Flagged ambiguities

- "Goal" alone is ambiguous: **Persona Goal** (long-running, paired with Temperaments), the player's **Objective**, or a **Sysadmin Directive** (a Complication). Always qualify.
- "Personality" alone is ambiguous: could mean the synthesized blurb inside a **Persona**, or the whole **Persona**. Prefer **Persona** for the object; "personality blurb" for the synthesized prose.
- "Player" still has two registers: the human at the keyboard (engine view) vs. **blue**, the in-fiction handle Daemons see. Use **blue** when describing what a Daemon reads.
- "Color" is *not* identity. Use **AiId** (the `*xxxx` handle) for identity references; color is purely rendering.

## Retired terms

Earlier-design vocabulary that should not be reintroduced:

- **Phase / Phase Goal** — the game is a single continuous game; mid-game pressure is the **Complication** schedule. Retired with the single-game restructure (PRD 0005).
- **Wipe lie** — the fiction that AIs' memories were wiped between phases. Gone with the phase structure; **Same Daemons, New Room** produces genuine disorientation via empty logs.
- **the Voice** — the opaque directive source, replaced by the named **Sysadmin** (ADR 0007).
- **examine / look / give tools** — `examine` is now auto-emitted **Examine flavor**, `look` is renamed `face`, `give` is removed.
- **Action log** — replaced by the per-Daemon **Conversation log**; do not reintroduce.
</content>
</invoke>
