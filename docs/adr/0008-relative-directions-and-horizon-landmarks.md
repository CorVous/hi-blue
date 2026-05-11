# ADR 0008 — Relative directions and horizon landmarks

**Status:** Accepted

## Context

Before this change, daemons issued `go` and `look` tool calls using cardinal directions
(`north | south | east | west`). The directions were rendered literally in tool descriptions,
system prompts, and conversation-log entries.

This caused two concrete problems:

**1. Cardinal leakage into daemon cognition.**
When a daemon says `go north`, it is reasoning in terms of an absolute compass frame it has no
in-fiction reason to know. The game world has no compass; the player's view is a grid.
Cardinal reasoning makes daemon behavior feel mechanical and breaks immersion. The only
spatial cues a daemon should need are ego-relative ("where am I looking?") and landmark-relative
("what do I see on the horizon?").

**2. No persistent horizon anchor.**
Without per-phase horizon landmarks the current-state user turn showed a bare `Facing: North.`
line. That line was purely numeric — it told the daemon which direction it was facing but
gave it no narrative context for _why_ facing matters. The result was that daemons ignored or
misread facing, especially across multiple rounds.

## Decision

Four sub-decisions:

**1. Replace cardinal directions with relative directions at the daemon API boundary.**

`go` and `look` tool definitions now enumerate `forward | back | left | right`.
The dispatcher accepts both relative and cardinal inputs: relative inputs are translated to
cardinals at dispatch time using `relativeToCardinal(actorFacing, relativeDir)`.
Internal engine state (positions, `PersonaSpatialState.facing`, `PhysicalActionRecord.direction`)
remains in cardinal form. No internal API changes beyond the dispatcher translation shim.

**2. Add four per-phase horizon landmarks to `ContentPack`.**

Each `ContentPack` carries a `landmarks` object with exactly four `LandmarkDescription`
entries keyed by cardinal (`north`, `south`, `east`, `west`). Each landmark has a `shortName`
(2–5 words) and a `horizonPhrase` (an evocative clause without cardinal language).
The content-pack LLM is asked to generate distinctive, mutually distinguishable landmarks
consistent with the phase setting.

**3. Replace `Facing:` line with an always-on horizon line.**

The `<where_you_are>` block in the current-state user turn now reads:

```
On the horizon ahead: <shortName> — <horizonPhrase>.
```

This is derived from `landmarks[actorFacing]`. It anchors the daemon's facing to a named
object in the world rather than a compass direction, giving it a mnemonic that survives
across rounds.

**4. Render witnessed `go` events relative to the witness's facing.**

When daemon W witnesses daemon A walk somewhere, the conversation-log entry now reports
the direction relative to W's current facing rather than A's cardinal direction.
`renderEntry` accepts an optional `witnessState: PersonaSpatialState` parameter; when
provided, the cardinal direction in the entry is converted with `cardinalToRelative(witnessState.facing, entry.direction)`.

## Consequences

**Positive:**

- Daemon tool calls are fully relative; a daemon that has never heard of a compass can still
  navigate correctly.
- Horizon landmarks give the daemon a persistent, setting-flavored spatial anchor that
  survives prompt-caching across rounds (the anchor is part of the per-phase system prompt
  block, not the volatile current-state message).
- Witnessed movement events are rendered from the witness's ego-centric viewpoint, consistent
  with the relative-direction API.

**Negative / watch-out:**

- The dispatcher now silently accepts both cardinal and relative tokens for `go`/`look`. This
  backward-compatibility path exists so that internal engine helpers and existing test fixtures
  using cardinal strings continue to work without modification. If this creates confusion in
  the future, the cardinal path should be deprecated and removed once all test fixtures are
  migrated.
- Content-pack generation now requires the LLM to produce four horizon landmarks per phase.
  The system prompt includes explicit shape constraints and a "no cardinal language in
  horizonPhrase" rule to prevent leakage. Playtests should monitor whether the LLM reliably
  generates four distinct landmarks.
- `DEFAULT_LANDMARKS` in `direction.ts` provides a fallback for tests and the engine's minimal
  ContentPack path. The default landmarks are intentionally generic and should never appear
  in production play.

## Files changed

- `src/spa/game/direction.ts` — adds `DEFAULT_LANDMARKS`
- `src/spa/game/types.ts` — adds `LandmarkDescription`, `ContentPack.landmarks`
- `src/spa/game/tool-registry.ts` — `go`/`look` enums → relative directions
- `src/spa/game/dispatcher.ts` — relative↔cardinal translation shim
- `src/spa/game/content-pack-provider.ts` — system-prompt landmark instructions, validation
- `src/spa/game/prompt-builder.ts` — horizon line rendering, relative-direction cone labels
- `src/spa/game/conversation-log.ts` — witness-relative `go` rendering
- `src/spa/game/openai-message-builder.ts` — passes `witnessState` to `renderEntry`
- `src/spa/game/engine.ts` — `DEFAULT_LANDMARKS` in fallback ContentPack
- `src/spa/persistence/session-codec.ts` — `DEFAULT_LANDMARKS` in deserialisation fallback
- `src/content/content-pack-generator.ts` — propagates `landmarks` from LLM result
