# hi-blue

A browser game where the player negotiates with three personality-distinct AIs over three phases. Each AI shares one opaque 5×5 grid room; the player has only words.

## Language

### Personas and identity

**Persona**:
The full per-AI character object: identity (`*xxxx` name, color), two **Temperament**s, a **Persona Goal**, and a synthesized personality blurb. Generated procedurally at game start; stable across the three phases of a single playthrough.
_Avoid_: Character, AI personality (when referring to the whole object).

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
A short-term task privately delivered to each AI at the start of each phase by **the Voice**. Distinct per phase, drawn from a Phase Goal pool. Lives in the Goal section of that phase's system prompt.
_Avoid_: Goal (ambiguous — see Persona Goal), objective (player-facing, see Objective), task.

**Objective**:
The player's per-phase win condition, told to the player but never to the AIs. The single thing the player is trying to make happen.
_Avoid_: Goal (use Persona Goal / Phase Goal), mission, win condition.

### The Voice

**The Voice**:
The opaque source of every utterance the AI hears that isn't a fellow AI's chat or whisper. The Phase Goal arrives via the Voice. The player, from the AI's perspective, is *also* the Voice (deliberately the same word — productive ambiguity). The AI never knows whose voice it is or whether there is one source or several.
_Avoid_: Player (when referring to the AI's view), god, narrator.

**Wipe lie**:
The fiction that the AIs' memories are wiped between phases. In phase 1, the AI is honestly disoriented (system prompt: "you have no clue where you are or how you came to be here"). In phases 2 and 3, the Voice instructs the AI inside the Goal to *act as if* their memory has been wiped — it is performed amnesia, not real disorientation. The lie's slip vector is **Persona** consistency leaking across phases despite the AI's claimed amnesia.
_Avoid_: Memory wipe (it isn't one), reset.

### World

**Setting**:
The noun describing where this phase takes place ("abandoned subway station", "sun-baked salt flat", "forgotten laboratory"). Drawn from a hand-authored `SETTING_POOL` at game start. Three distinct Settings per playthrough — one per phase, drawn without replacement.
_Avoid_: Level, scene, location.

**Content Pack**:
The structured per-phase output of the LLM content-pack call: setting-flavored names, examine descriptions, and use outcomes for every entity in the phase (objective objects, objective spaces, interesting objects, obstacles). Generated once at game start for all 3 phases in a single batched call.

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

**Cone event delta**:
The per-AI per-turn "what happened in your cone since your last turn" section of the system prompt. Each AI sees only events that occurred within their own cone — the only cross-AI signal channel besides whispers and chat. Replaces the broadcast action log that an earlier design had.
_Avoid_: Action log (deprecated; do not reintroduce).

## Relationships

- A **Persona** has exactly two **Temperament**s and one **Persona Goal**.
- A **Persona** receives one **Phase Goal** per phase, delivered by **the Voice**.
- The player's **Objective** is independent of every AI's **Phase Goal** — the AIs do not know the Objective exists.
- A phase has K **Objective Pair**s, N **Interesting Object**s, and M **Obstacle**s on a 5×5 grid (K/N/M rolled from hand-authored per-phase ranges).
- The **Voice** is the AI's framing for both the Phase Goal source *and* the player. The AI cannot tell them apart.

## Flagged ambiguities

- "Goal" alone is ambiguous: could mean **Persona Goal** (cross-phase, paired with Temperaments) or **Phase Goal** (per-phase, from the Voice). Always qualify.
- "Personality" alone is ambiguous: could mean the synthesized blurb inside a **Persona**, or the whole **Persona**. Prefer **Persona** for the object; "personality blurb" for the synthesized prose.
- "Player" is ambiguous depending on perspective: from the engine's view, the human at the keyboard. From the AI's view, the player is **the Voice** — never call them "the player" inside a system prompt.
- "Color" is *not* identity. Use **AiId** (the `*xxxx` handle) for identity references; color is purely rendering.
