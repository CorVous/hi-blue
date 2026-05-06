# hi-blue

A browser game where the player negotiates with three personality-distinct AIs over three phases. Each AI shares one opaque room; the player has only words.

## Language

**Persona**:
The full per-AI character object: identity (color, name), two **Temperament**s, a **Persona Goal**, and a synthesized personality blurb. Generated procedurally at game start; stable across the three phases of a single playthrough.
_Avoid_: Character, AI personality (when referring to the whole object).

**Temperament**:
A single trait drawn from a curated pool (e.g. "shy", "hot-headed", "insightful"). Each Persona has two. Together with the Persona Goal, they are the *input* to personality synthesis.
_Avoid_: Trait, mood, attribute.

**Persona Goal**:
The cross-phase motivation paired with a Persona's two Temperaments at game start (e.g. "wants the player to be rude to the others"). Stable for the whole playthrough. Synthesized into the personality blurb alongside the Temperaments.
_Avoid_: Goal (ambiguous — see Phase Goal), drive, motivation.

**Phase Goal**:
A short-term task privately handed to each AI at the start of each phase by "an unseen voice." Distinct per phase, drawn from a separate pool. Lives in the system prompt of that phase only.
_Avoid_: Goal (ambiguous — see Persona Goal), objective (player-facing, see Objective), task.

**Objective**:
The player's per-phase goal, told to the player but never to the AIs. The single thing the player is trying to make happen.
_Avoid_: Goal (use Persona Goal / Phase Goal), mission, win condition.

## Relationships

- A **Persona** has exactly two **Temperament**s and one **Persona Goal**.
- A **Persona** receives one **Phase Goal** per phase (three total over a playthrough).
- The player's **Objective** is independent of every AI's **Phase Goal** — the AIs do not know it.

## Flagged ambiguities

- "Goal" alone is ambiguous: could mean **Persona Goal** (cross-phase, paired with Temperaments) or **Phase Goal** (per-phase, from the unseen voice). Always qualify.
- "Personality" alone is ambiguous: could mean the synthesized blurb inside a **Persona**, or the whole **Persona**. Prefer **Persona** for the object; "personality blurb" for the synthesized prose.
