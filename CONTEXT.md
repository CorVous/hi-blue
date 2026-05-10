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
A pair of (objective object, objective space) — the object must end up on its specific space to count toward win. A phase has K objective pairs (K is rolled from a hand-authored range per phase). The `examineDescription` of an objective object names the space it belongs on.
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
- A phase has K **Objective Pair**s, N **Interesting Object**s, and M **Obstacle**s on a 5×5 grid (K/N/M rolled from hand-authored per-phase ranges).
- The **Sysadmin** (Phase Goal source) and **blue** (player handle) are *distinct* named sources from the Daemon's perspective; routing is unambiguous.

## Flagged ambiguities

- "Goal" alone is ambiguous: could mean **Persona Goal** (cross-phase, paired with Temperaments) or **Phase Goal** (per-phase, from the **Sysadmin**). Always qualify.
- "Personality" alone is ambiguous: could mean the synthesized blurb inside a **Persona**, or the whole **Persona**. Prefer **Persona** for the object; "personality blurb" for the synthesized prose.
- "Player" still has two registers: the human at the keyboard (engine view) vs. **blue**, the in-fiction handle Daemons see. Use **blue** when describing what a Daemon reads.
- "Color" is *not* identity. Use **AiId** (the `*xxxx` handle) for identity references; color is purely rendering.
