# Procedural personas replace hand-authored

Each playthrough now generates its three **Persona**s procedurally at game start: two **Temperament**s and one **Persona Goal** are drawn from hand-authored pools per AI, and a single LLM synthesis call produces three personality blurbs in one structured response. The hand-authored Ember/Sage/Frost trio (`src/content/personas.ts`) is retired in favor of replayability and reduced authoring scope; **AiId** decouples from color in the same change (identity becomes a generated `*xxxx` handle, color becomes a separately-drawn palette field).

## Status

Accepted. Supersedes the "stable hand-authored personalities across all three phases" decision in [PRD 0001 §107](../prd/0001-game-concept.md) — that PRD's "highest-value writing investment" framing now applies to the **temperament pool, persona-goal pool, and synthesis prompt**, not to three fixed characters.

## Considered Options

- **(a) Replace hand-authored entirely** — chosen.
- **(b) Replace prose, keep three fixed slots** (still Ember/Sage/Frost, just regenerate their blurbs each game). Rejected: half-measure that retains the "red/green/blue" type-level coupling we were trying to break.
- **(c) Layer procedural mode on top of hand-authored** — two modes. Rejected: doubles the surface area for marginal benefit.

## Consequences

- Stability of the wipe lie now leans entirely on **persona consistency within a single playthrough** (still stable across all three phases of one game) rather than across all playthroughs forever.
- `AiId = "red" | "green" | "blue"` discriminated union becomes `AiId = string` (the `*xxxx` handle); `Persona.color` is added as a separate field. Touches `src/content/personas.ts`, `src/spa/game/types.ts`, the dispatcher's `give` enum, save serialization, and most fixtures.
- Hand-authored content shifts from three personas to a Temperament pool, a Persona Goal pool, and the synthesis prompt — smaller writing surface, more replayable output.
