# ADR 0004 — Editable vs. Sealed Save Surface

**Status:** Accepted

## Context

The game state contains two categories of data:

1. **Human-editable narrative state** — chat histories, whispered messages, phase goals, persona
   definitions. Allowing a player to edit these with a text editor and reload is a desirable
   affordance: it lets them correct bad AI outputs, adjust persona flavour, or replay a phase from
   an edited starting point without corrupting the engine.

2. **Engine-committed state** — the world (`WorldState.entities`), content packs, AI budgets, lockout
   sets, phase number, completion flag, per-daemon spatial positions. Allowing ad-hoc edits to these
   can brick the simulation (e.g. an entity in an impossible grid position, a budget value out of
   sync with the phase, a non-existent phase number).

The previous design (ADR 0001–0003 era) stored everything under one `hi-blue-game-state` key in
localStorage as a single JSON blob. This made the engine state as easy to corrupt as the narrative
state.

## Decision

Per-Session save data is split across **six localStorage files**:

| File | Path pattern | Editable? |
|------|-------------|-----------|
| `meta.json` | `hi-blue:sessions/<id>/meta.json` | Yes |
| `<aiId>.txt` × 3 | `hi-blue:sessions/<id>/<aiId>.txt` | Yes |
| `whispers.txt` | `hi-blue:sessions/<id>/whispers.txt` | Yes |
| `engine.dat` | `hi-blue:sessions/<id>/engine.dat` | Sealed |

**Editable files contain:**
- Daemon `.txt` files: per-daemon chat history and phase goals for all three phases.
- `whispers.txt`: all whisper messages, keyed by phase.
- `meta.json`: session timestamps, current phase number, current round (devtools-editable).

**`engine.dat` contains (sealed):**
- `WorldState.entities`
- Content packs
- AI budgets
- Lockout state (`lockedOut` + `chatLockouts`)
- `currentPhase`, `isComplete`
- Per-daemon spatial state (`personaSpatial`)

`engine.dat` is written **last** and acts as the **commit signal** for atomicity: a load that finds
the engine file absent (or corrupt) treats the session as broken.

## Considered Options

**All-plaintext** — everything in human-readable JSON files. Rejected because engine state (entity
positions, budgets, lockouts) is very easy to accidentally corrupt, and there is no meaningful
narrative value in hand-editing a grid position.

**All-sealed** — entire save in one opaque blob. Rejected because it eliminates the chat-history
hand-edit affordance that a minority of players actively use.

**Single-key JSON** (the previous design) — simpler but provides no protection for engine state.
Superseded by this ADR.

## Consequences

- Editing a daemon `.txt` or `whispers.txt` and reloading affects the next LLM prompt, allowing
  creative manipulation of the narrative.
- A missing or corrupt `engine.dat` is the definitive **broken** signal; the load path clears the
  session and starts a new game.
- The write order (meta → daemons → whispers → engine) means an interrupted write always leaves
  engine.dat absent, which is safe.
