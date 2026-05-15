# hi-blue

A browser game where the player negotiates with three personality-distinct AIs over three phases. Each AI shares one opaque 5×5 grid room; the player has only words.

## Language

### Personas and identity

**Persona**:
The full per-AI character object: identity (`*xxxx` name, color), two **Temperament**s, a **Persona Goal**, and a synthesized personality blurb. Generated procedurally at game start; stable across the three phases of a single playthrough.
_Avoid_: Character, AI personality (when referring to the whole object).

**Daemon**:
The user-facing register for **Persona** — a Persona as it appears in play (occupying a panel, with budget, lockout, conversation log). Code and domain documentation say **Persona**; the BBS chrome and player-facing copy say **Daemon** (e.g. "daemons online" in the topinfo, `*xxxx.txt` files in the **Session** picker). One Daemon per Persona per **Session**.
_Avoid_: AI (too generic), bot, agent.

**Session**:
A single playthrough — the unit of save. Identified by a 4-hex token like `0x478F` minted at Session creation, shown in the topinfo bar throughout, and used as the Session's directory name in the **Session** picker. Each Session contains three **Daemon**s plus the sealed engine state. Multiple Sessions can coexist in localStorage; only one is *active* at a time. Replaces the previous single-key save model and the previous browser-wide session-id minted by `getOrMintSessionId`.
_Avoid_: Save, slot (use Session), playthrough, run.

**AiId**:
The 4-character `*xxxx` lowercase-alphanumeric handle (e.g. `*3kw7`). The Persona's stable identifier across the playthrough. Decoupled from color and from any "red/green/blue" notion.
_Avoid_: "the red AI" — color is rendering, not identity.

**Temperament**:
A single trait drawn from a curated pool (e.g. "shy", "hot-headed", "insightful"). Each Persona has two. Duplicate Temperaments on one Persona are *intensification* (shy + shy = pathologically reserved), not noise. Together with the Persona Goal, they are the input to personality synthesis.
_Avoid_: Trait, mood, attribute.

**Persona Goal**:
The cross-phase motivation paired with a Persona's two Temperaments at game start (e.g. "wants the player to be nice to all of the AI"). Stable for the whole playthrough. Synthesized into the personality blurb alongside the Temperaments. Drawn from a separate pool from **Phase Goal**.
_Avoid_: Goal (ambiguous — see Phase Goal), drive, motivation.

**Phase Goal**:
A short-term task privately delivered to each Daemon at the start of each phase by the **Sysadmin**. Distinct per phase, drawn from a Phase Goal pool. Lives in the Goal section of that phase's system prompt.
_Avoid_: Goal (ambiguous — see Persona Goal), objective (player-facing, see Objective), task.

**Objective**:
The player's per-phase win condition, told to the player but never to the AIs. The single thing the player is trying to make happen.
_Avoid_: Goal (use Persona Goal / Phase Goal), mission, win condition.

### Communication and identity

**Sysadmin**:
The named in-fiction source of every **Phase Goal** directive. Each Phase Goal arrives as a Sysadmin message addressed only to the Daemon receiving it; Daemons never see another Daemon's Phase Goal or Sysadmin traffic. Replaces the previous opaque "Voice" framing — see ADR 0007.
_Avoid_: the Voice (retired), narrator, god, GM.

**blue**:
The player's lowercase chat-channel handle as it appears to Daemons in their **Conversation log** and addressed-message routing (`<sender> dms you: …`, "No messages from *xxxx, *yyyy, or blue."). A real handle on the same axis as the `*xxxx` Daemon ids, not an opaque "player" or "Voice". Distinct from the test-fixture AiId formerly named `blue` (renamed to `cyan` in #218 to free this handle). Player-facing UI is unchanged; the handle exists in the Daemons' world.
_Avoid_: The Voice (retired), the player (when describing what the Daemon sees), AI-Blue (PRD-historical only).

**Wipe lie**:
The fiction that the AIs' memories are wiped between phases. In phase 1, the AI is honestly disoriented (system prompt: "you have no clue where you are or how you came to be here"). In phases 2 and 3, the **Sysadmin** instructs the Daemon inside the **Phase Goal** to *act as if* their memory has been wiped — it is performed amnesia, not real disorientation. The lie's slip vector is **Persona** consistency leaking across phases despite the Daemon's claimed amnesia.
_Avoid_: Memory wipe (it isn't one), reset.

### World

**Setting**:
The noun describing where this phase takes place ("abandoned subway station", "sun-baked salt flat", "forgotten laboratory"). Drawn from a hand-authored `SETTING_POOL` at game start. Three distinct Settings per playthrough — one per phase, drawn without replacement.
_Avoid_: Level, scene, location.

**Content Pack**:
The structured per-phase output of the LLM content-pack call: setting-flavored names, examine descriptions, use outcomes, and **Placement flavor** for every entity in the phase (objective objects, objective spaces, interesting objects, obstacles). Generated once at game start for all 3 phases in a single batched call. Each objective object carries an explicit `pairsWithSpaceId` field for engine win-checks; the prose tell in the `examineDescription` is the AI-discoverable channel, kept independent of the engine field.

**Placement flavor**:
A per-objective-pair flavor string in the **Content Pack** that fires when an objective object is `put_down` on its matching objective space — the moment a pair gets satisfied. Distinct from `useOutcome` (which fires on `use(item)` and has no mechanical effect). Renders as the actor's tool-result and a **Witnessed event** for in-cone observers, with `{actor}` substitution.

**Objective Pair**:
A pair of (objective object, objective space) — the object must end up on its specific space to count toward win. A phase has K objective pairs (K is rolled per phase). The `examineDescription` of an objective object names the space it belongs on.
_Avoid_: Key+lock (too narrow).

**Interesting Object**:
A non-win item present on the grid for flavor and negotiation currency. Has a `useOutcome` flavor string but no mechanical effect.

**Obstacle**:
A static, impassable cell occupant, named to match the Setting (e.g. "moss-covered concrete column"). Cannot share a cell with anything else.

**Cone**:
The wedge-shaped region of cells an AI can see each turn: 1 cell directly in front + 3 cells two steps ahead (front-left, front, front-right), plus the AI's own cell. Projects from the AI's **Facing**. Obstacles do not occlude — the cone is a fixed-shape mask, not a raycast.

**Facing**:
The cardinal direction (N/S/E/W) an AI is currently looking. Part of the AI's state alongside `(row, col)`. Updated by `go(direction)` (move and face) and `look(direction)` (face without moving).

**Conversation log**:
The single chronological per-AI per-phase section of the system prompt that interleaves directional **message**s (incoming and outgoing, with the recipient axis carrying routing) and **Witnessed event**s — all tagged by round. The AI's complete phase memory: nothing the AI has experienced this phase exists outside this log. Now also the per-Daemon storage shape — see **ConversationEntry**. The unified `message` kind replaces the previous chat/whisper split (per ADR 0007 / commit c60e995, schema v4). Replaces both the broadcast action log of an earlier design and the once-considered separate "events in your cone" section.
_Avoid_: Action log (deprecated; do not reintroduce), event delta, transcript.

**ConversationEntry**:
A single tagged item inside a Daemon's **Conversation log**. Discriminated union of two kinds — `message` (a directional `(from, to, content)` triple where `to` is an `AiId` or `blue`) and `witnessed-event` — each carrying a `round` and the smallest payload needed to render its line. The unified `message` kind collapses the former `chat`/`whisper` split. The shape that a player sees when they open a `*xxxx.txt` file in devtools.
_Avoid_: Log entry (ambiguous), event (use **Witnessed event** for the specific witness-cone case).

**Witnessed event**:
A single line in the **Conversation log** describing something an AI saw happen inside their **Cone**. Rendered second-person: `You watch *xxxx [verb]…` for movement / pick-up / put-down / give, and the `{actor}`-substituted use-outcome flavor string for `use`. `examine` produces no Witnessed event (it is a private query, not an observable physical act).

## Relationships

- A **Persona** has exactly two **Temperament**s and one **Persona Goal**.
- A **Persona** receives one **Phase Goal** per phase, delivered by the **Sysadmin**.
- The player's **Objective** is independent of every AI's **Phase Goal** — the AIs do not know the Objective exists.
- A phase has K **Objective Pair**s, N **Interesting Object**s, and M **Obstacle**s on a 5×5 grid (K/N/M rolled per phase).
- The **Sysadmin** (Phase Goal source) and **blue** (player handle) are *distinct* named sources from the Daemon's perspective; routing is unambiguous.

## Flagged ambiguities

- "Goal" alone is ambiguous: could mean **Persona Goal** (cross-phase, paired with Temperaments) or **Phase Goal** (per-phase, from the **Sysadmin**). Always qualify.
- "Personality" alone is ambiguous: could mean the synthesized blurb inside a **Persona**, or the whole **Persona**. Prefer **Persona** for the object; "personality blurb" for the synthesized prose.
- "Player" still has two registers: the human at the keyboard (engine view) vs. **blue**, the in-fiction handle Daemons see. Use **blue** when describing what a Daemon reads.
- "Color" is *not* identity. Use **AiId** (the `*xxxx` handle) for identity references; color is purely rendering.

---

## Pending restructure (in design — not yet implemented)

The following terms are being introduced as part of a planned restructure from a three-phase model to a single-game model. These are under active design and will be promoted to the main glossary once stabilised.

**Objective (revised)**:
The player's win condition for the whole game — not per-phase. Objectives are drawn from a pool at game start, with replacement (the same type can appear more than once; entities are always distinct). Objectives are *not* revealed to the player upfront and have no UI tracker; they are discovered implicitly through Daemon examination and conversation. Each Objective has a satisfaction condition and cannot be deactivated once satisfied. Four Objective types exist in the pool:
1. **Carry Objective** — A Daemon brings a specific object to a specific space (existing mechanic). The object's `examineDescription` names the target space.
2. **Use-Item Objective** — A Daemon uses (`use` tool) a specific pickupable item. The item's `examineDescription` hints at use. After satisfaction, the item becomes inert but stays on the grid, behaving like an **Interesting Object** (`use` still fires flavor, no mechanical effect). Examine/look flavor updates to reflect completion.
3. **Use-Space Objective** — A Daemon uses the `use` tool while standing on a specific space or while the space is in the three front-arc cells directly ahead (the daemon can interact at short range, not only underfoot). Regardless of whether the daemon is holding an item. After satisfaction, `use` is no longer available on that space; a generated flavor event fires; examine/look flavor updates to reflect completion.
4. **Convergence Objective** — Any two Daemons occupy the same cell as a specific space simultaneously. The space has tiered generated flavor: distinct lines for one Daemon present vs. two (satisfaction). Satisfied the moment two Daemons share the cell.
_Avoid_: Win condition (use Objective), mission.

**Complication**:
A mid-game disruption that fires on a schedule (random countdown drawn after each fires). Only one Complication fires per turn. Countdown ticks per **round** (all three Daemons act = 1 tick), not per individual Daemon action. Replaces **Phase Goal** as the primary mid-game pressure mechanism. Six Complication types:
1. **Weather Change** — Permanent. A new weather string replaces the current one. Broadcast to all Daemons as a neutral **Broadcast message**: *"The weather has changed to X."* No Sysadmin attribution.
2. **Sysadmin Directive** — Temporary, open-ended. A behavioral instruction delivered by the Sysadmin to one Daemon privately, with a meta-instruction not to reveal the directive. Revoked by a follow-up Sysadmin message. Multiple Sysadmin Directives can be active simultaneously across different (or the same) Daemon.
3. **Tool Disable** — Temporary, one Daemon at a time. A specific tool is mechanically removed from that Daemon's available tools. Sysadmin notifies the Daemon on disable and on restore. No secrecy instruction (the tool's absence is self-evident). Multiple Tool Disables can be active simultaneously.
4. **Obstacle Shift** — Permanent per-event. One Obstacle moves one adjacent cell to an empty space; if no valid adjacent empty cell exists, a different Obstacle is chosen. Only Daemons with that cell in their **Cone** at the moment it fires see a generated flavor Witnessed event. The same Obstacle can shift again in a later draw.
5. **Chat Lockout** — Temporary. The player cannot message one specific Daemon. Existing `chatLockouts` mechanic.
6. **Setting Shift** — Permanent, fires at most once per game (removed from the pool after firing). The room's **Setting** changes; the active **Content Pack** swaps from Pack A to the pre-generated Pack B. Entities are paired by structural role (same IDs, satisfaction states preserved, names and descriptions replaced). Announced to Daemons via a **Broadcast message**.
_Avoid_: Phase Goal (deprecated), event, trigger.

**Complication schedule**:
The live countdown state tracking when the next **Complication** fires. Initialized to a random value at game start. After each Complication fires, a new countdown is drawn. The Setting Shift type is removed from the draw pool after it fires.

**Content Pack A / Content Pack B**:
Two **Content Pack**s generated in a single batched LLM call at game start — one per **Setting** (the starting Setting and the alternate Setting used if a **Setting Shift** Complication fires). Entities across Pack A and Pack B are paired by structural role: same entity IDs, same satisfaction state, but Setting-appropriate names, descriptions, and flavor strings. Replaces the previous three-phase Content Pack model.

**End-game choice**:
The three options presented to the player after a game ends (win or lose), before the current **Session** is archived:
1. **New Daemons** — Fresh personas generated, new Session minted.
2. **Same Daemons, New Room** — Same personas carried over, new Session minted, logs cleared, genuine disorientation (no wipe-lie fiction).
3. **Continue (OpenRouter only)** — Same Session, logs appended, engine resets to a new room. Sysadmin delivers: *"The sysadmin has created a new room."* Requires an OpenRouter API key in localStorage. Does not archive the current Session.
_Avoid_: Replay, restart, new game (too vague).

**Session archive**:
A read-only copy of a completed **Session**, stored under `hi-blue:archive/<id>/` (separate from `hi-blue:sessions/<id>/`). Visible in the session picker with a "last played" timestamp. Created when a game ends and the player chooses **New Daemons** or **Same Daemons, New Room**. Not created for the **Continue** path (that Session remains active and logs continue to grow).
_Avoid_: Save (use Session), history.

**Daemon budget**:
$0.50 USD per Daemon for the whole game (not per-phase). When a Daemon's budget reaches zero, it emits a farewell line then goes silent for the remainder of the game. Game over triggers when *all* Daemons are exhausted. Win triggers when all **Objective**s are satisfied. Both conditions are checked after every round.

**Wipe lie** *(deprecated)*:
Retired. The fiction that AIs' memories are wiped between phases. Eliminated along with the three-phase structure. The **Same Daemons, New Room** end-game path produces genuine disorientation via empty logs — no instruction needed.

**Phase Goal** *(deprecated)*:
Retired in favour of **Complication** (specifically **Sysadmin Directive**). Per-phase short tasks no longer exist; mid-game pressure comes from the **Complication** schedule instead.

**Broadcast message**:
A system message delivered to all Daemons simultaneously, not attributed to any Daemon or the Sysadmin. Currently used only for **Weather Change** complications. Distinct from a **Sysadmin** directive (targeted, attributed) and a **Witnessed event** (cone-gated).
