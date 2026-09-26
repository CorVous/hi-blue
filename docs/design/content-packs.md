# Content packs, bootstrap and LLM providers

Design notes for the new-game generation path in `src/spa/game/`: content-pack
generation and validation, the bootstrap that runs it, the three LLM provider
seams, and the small helpers that sit beside them (mentions, composer, seeds).
Vocabulary follows [CONTEXT.md](../../CONTEXT.md). The design decisions are in
[ADR 0010](../adr/0010-content-pack-partial-retry.md) (retry, which the code has
since drifted from; see "Retry strategy" below) and
[ADR 0014](../adr/0014-type-first-objective-authoring.md) (type-first authoring).

## Provider seams

Three interfaces isolate every LLM call so tests and evals never touch the network:

| Interface | Browser implementation | Mock | Module |
|---|---|---|---|
| `ContentPackProvider` | `BrowserContentPackProvider` | `MockContentPackProvider` | `content-pack-provider.ts` |
| `LlmSynthesisProvider` | `BrowserSynthesisProvider` | `MockSynthesisProvider` | `llm-synthesis-provider.ts` |
| `RoundLLMProvider` | `BrowserLLMProvider` (`browser-llm-provider.ts`) | `MockRoundLLMProvider` | `round-llm-provider.ts` |

- The browser implementations are the only code that calls `llm-client.ts`. Mocks
  record their inputs (`calls`, `dualCalls`) and return scripted results.
  `MockRoundLLMProvider` cycles its scripted results in order. It accepts a bare
  string (just the text) or `{ toolCall }` (one tool call) as shorthand for a full
  `RoundTurnResult`.
- `bootstrap.ts` re-exports `ContentPackProvider` and `SynthesisProvider` so
  `views/start.ts` can take the types without importing the provider modules,
  which would create an import cycle.
- `OpenAiMessage` is defined in `round-llm-provider.ts`, not `llm-client.ts`, so
  both the browser and the server-side proxy can import it without pulling in
  browser globals.
- Both JSON-mode providers (content packs, synthesis) read `content` and fall back
  to `reasoning` when `content` is empty. GLM-4.7 sometimes returns its whole
  answer in the reasoning channel.
- `CapHitError` (the spend cap, HTTP 429) is never retried by any provider. It
  surfaces straight away so the UI can show the cap screen.
- **Reasoning defaults.** `BrowserLLMProvider` (daemon turns) defaults to
  `disableReasoning: true`, because GLM-4.7's thinking trace adds 1–4K tokens of
  latency to each turn for little roleplay benefit (see
  [the GLM-4.7 guide](../prompting/glm-4.7-guide.md)). Pass
  `{ disableReasoning: false }` to turn the thinking step back on. The two
  JSON-mode providers default to `disableReasoning: false`.
- `RoundTurnResult.costUsd` comes from OpenRouter's `usage.cost`. The token
  counts (`promptTokens`, `completionTokens`, `cachedPromptTokens`) come from the
  final usage chunk and are used for prompt-caching diagnostics. Mocks leave all
  of them unset.
- `LifecyclePhase` events (#437) run `started` → `first-token` → `completed`,
  or end in `errored`. In `__DEV__` builds, the game view uses them to drive the
  per-daemon footer status indicator. `first-token` fires only once a text
  delta arrives, so a stream that errors before its first chunk goes straight
  from `started` to `errored`.
- Persona synthesis (`BrowserSynthesisProvider`) retries a failed call once.
  Every persona must come back with exactly `VOICE_EXAMPLES_PER_PERSONA` voice
  lines, and the ids must match the input exactly (none missing, none extra).

## Type-first bindings

Generation is type-first ([ADR 0014](../adr/0014-type-first-objective-authoring.md), #451):

1. `rollObjectiveTypes` draws the Objective types in code, before any LLM
   call. It draws uniformly with replacement over `OBJECTIVE_TYPES`.
2. `binding-prompt-builder.ts` mints a `BindingSkeleton` per type, with fixed
   entity ids: `carry-{i}-obj`/`carry-{i}-space`, `useSpace-{i}-space`,
   `useItem-{i}-item` and `convergence-{i}-space`. It also mints two decoys
   (`decoy-0`, `decoy-1`) and `obstacle-{i}` ids. Which id fields a skeleton sets
   depends on its type: `objectId` is set only for carry, `itemId` only for
   use_item, and `spaceId` for every type except use_item.
3. The LLM authors only the flavor fields for each binding. It must echo the
   minted ids exactly. `buildObjectiveRecords` later finds entities by these
   ids, so a renamed id would break the Objective.

A **binding** is the tie between one minted entity (two for Carry) and the
Objective type it serves (CONTEXT.md, "Objective binding"). The dual (A/B)
variant (#302) asks one call for two packs. The ids, binding types and structure
are the same in both, and only names and flavor differ. One shared
`ValidationSchedule` checks both packs.

## Validation (`binding-aware-validator.ts`)

The validator returns a `ValidationResult`. It never throws. It checks each pack
against the schedule it was generated from. Every error names a `ValidationRule`
and the `retryUnit` it belongs to.

The error and result types, the `RetryUnit` and `ValidationRule` unions and the
use-tell keyword matchers live in `content-pack-validation.ts`. The validator and
`content-pack-provider.ts` both import them from there, so the validator does not
import the provider and the two modules do not form an import cycle.

The field lists at the top of the module mirror the system prompt. Each binding
has a `*_REQUIRED_FIELDS` list and, where it applies, a `*_FORBIDDEN_FIELDS` list.
When you change one, change `CONTENT_PACK_SYSTEM_PROMPT`,
`DUAL_CONTENT_PACK_SYSTEM_PROMPT` and `describeSkeletonInUserMessage` with it.

| Rule | Checks |
|---|---|
| `missing-field` | A required string field is absent or empty, or a binding, decoy, obstacle or the top-level `pack`/`phases`/`packA`/`packB` is missing. |
| `binding-forbidden-field` | A field outside the binding's shape is present. Decoys may not carry `activationFlavor` or `post*` fields. |
| `wrong-id` | The id differs from the minted one. The message includes the exact JSON shape, because the model most often drops the `id` from a sub-object. |
| `wrong-count` | The pack does not have exactly two decoys. |
| `actor-presence` | A carry object's `placementFlavor` lacks the literal `{actor}`. |
| `actor-exclusion` | An obstacle's `shiftFlavor` contains `{actor}`. |
| `verb-of-activation` | A use_space or use_item `examineDescription` has no use-cue keyword, or a decoy's has one. |
| `structural` | The response is not an object, or a dual response has no phase 0. |

**Warnings, not errors.** A use-cue in a carry or convergence space's
`examineDescription` becomes a warning. The warning goes back in the `ok` value
and does not trigger a retry.

### Prose tells

A prose tell is the only way a daemon can discover what an entity is for.
Daemons never see `pairsWithSpaceId` or the binding type (#253). Each binding
therefore needs a clue in its `examineDescription`:

- **Carry.** The object's `examineDescription` must name its paired space
  (#253). The prompt demands this at MUST strength, but no validator enforces
  it. The unused matcher `examineMentionsPairedSpace` (the full space name, or
  failing that any non-stopword space-name token of four or more characters,
  #382) has been deleted. If enforcement is added later (#346), it can be
  recovered from the repository history.
- **Use-Space and Use-Item.** `examineMentionsUseTell` matches whole words from
  `USE_TELL_KEYWORDS`, so "use" does not match inside "fuse". The list joins the
  Use-Space cue set (#335) and the extra Use-Item cues (#334: crank, handle, flip,
  twist, wind). Keep it in sync with the cue lists written out in both system
  prompts. `USE_CUE_KEYWORD_HINTS` is the short subset quoted back in corrective
  feedback. `findMatchedUseTellKeywords` names the exact word that broke a
  decoy, so the model does not have to guess it from the prompt.
- **Convergence (#336).** The tell is enforced by the prompt only. The prompts
  require the space to hint that shared occupancy matters, but no keyword
  validator checks it. A curated list (meet, gather, together…) was rejected. It
  would over-constrain wording that has many valid forms, on top of the existing
  use-cue rule. The structural guarantee comes from the required fields instead:
  a Convergence binding cannot validate without all four tier flavors.

## Retry strategy (`BrowserContentPackProvider`)

Each generation makes up to `OUTER_ATTEMPT_BUDGET` (3) attempts. The dual path
uses the same logic.

- **Validation failure.** The next attempt resends the system and user prompts,
  the previous raw JSON as an assistant turn, and a corrective user turn.
  `buildCorrectiveFeedback` groups the errors by `retryUnit` ("For carry binding
  carry-0: …"), so the model sees every problem with one entity in one place, and
  it removes duplicate messages. The model is asked to repair the JSON in place
  and keep the ids and any fields that passed.
- **Hard error** (empty response, JSON parse failure, network). The provider
  waits `BACKOFF_MS_BEFORE_RETRY[attempt]` and retries from a clean conversation:
  the previous output and the feedback are both dropped.
- If the last attempt fails, its error is rethrown. If every attempt fails
  validation, the provider throws `ContentPackError("…exhausted retry budget")`.

Retry units follow [ADR 0010](../adr/0010-content-pack-partial-retry.md). The
code no longer splices repaired entities back into the pack, as ADR 0010
proposed. Retry units now only group the corrective feedback. The ADR also chose
a fresh call over continuing the conversation; the code now continues the
conversation. `RetryUnit` still lists `objective-pair`, which dates from the
pre-binding validator. `objective-pair` with an empty `pairId` marks errors that
belong to the whole pack.

### Attempt log (`content-pack-attempts.ts`)

This log exists only in `__DEV__` builds. In production, `recordContentPackAttempt`
returns at once, so there is no cost and nothing is written to localStorage.

- Each outer attempt appends an `AttemptRecord` to a ring buffer of
  `ATTEMPTS_RING_SIZE` records. The buffer is stored under
  `hi-blue:debug/content-pack-attempts` inside a versioned envelope
  (`ATTEMPTS_ENVELOPE_VERSION`; bump the version when the record shape changes).
  It survives a reload, so a bootstrap that died with "exhausted retry budget"
  can still be debugged. With only three attempts, this log is the only record
  of what failed.
- A record stores only a summary of each validation error (unit kind, rule,
  entity, field), never the model's prose. `rawLength` is kept for triage: a
  validation failure with a tiny `rawLength` means the JSON was cut off.
- Failed attempts also go to `console.warn` with the prefix
  `[content-pack:attempt]`, so playtesters can paste them into bug reports.
- The records are read from the devtools console through
  `window.__contentPackAttempts()`, which `installDevtoolsAccessor` installs
  lazily. It cannot be installed at import time: `__DEV__` is not defined until
  the Vitest setup file's `beforeEach` runs.
- Storage errors (quota exceeded, private mode) are swallowed. The recorder is
  for debugging only and must never break the game.

## Bootstrap

`bootstrap.ts` (#173) starts persona synthesis and content-pack generation.
Neither function writes to localStorage. The start screen saves only when the
player clicks BEGIN.

- `generateNewGameAssetsSplit` returns two promises. Personas resolve seconds
  before content packs, so the loading screen can show each stage as it
  finishes. Content-pack generation waits for the persona ids through
  `aiIdsPromise`.
- `suppressUnhandledRejection` attaches a no-op `catch` to each promise. A
  consumer may await only one of the two promises, and the other would
  otherwise raise an unhandled-rejection error. Consumers that do await still
  see the rejection.
- `generateContentPacksOnlySplit` (#380) regenerates only the packs and reuses
  the resolved personas. Its `personasPromise` resolves immediately, so code
  that chains on it works unchanged.
- `buildSameDaemonsSession` implements the end-game "Same Daemons, New Room" and
  "Continue" choices (#307).
- `BootstrapOpts`:
  - `personasRng` and `contentPackRng` (spike #239) take precedence over `rng`.
    The two generators run concurrently, so each needs its own stream for a
    seeded run to be reproducible.
  - `engagementClauses` (spike #239 step 8) is opt-in, set by
    `?engagementClauses=1`. It appends a clause to each persona blurb based on
    its temperament pair.
  - `actionProfiles` is on by default and turned off by `?actionProfiles=0`. It
    renders each daemon's `<action_profile>` clause. See
    `src/content/action-preference-bias.ts`.

### Pending bootstrap (`pending-bootstrap.ts`)

The bootstrap starts on the start screen and must outlive the move to the game
view. `pending-bootstrap.ts` holds it in a module-level singleton, which the game
view, `render-app.ts` and the dev inspector all read. It is never persisted: no
session can be built or saved until the content packs arrive.

- Lifecycle: `pending` → `personas-ready` → `ready`. It moves to `failed` if
  either promise rejects. `startBootstrap` is idempotent: it returns the
  bootstrap already in flight unless that one failed.
- Personas are cached on the entry and survive a content-pack failure.
  `restartContentPacks` reuses them and falls back to a full `startBootstrap`
  only when no personas are cached.
- `clearPendingBootstrap` runs once the game view has built and saved the
  session. After that, entering the game view takes the normal restore path.
- `PendingCallMeta` (call name, start time, retry count out of
  `PENDING_CALL_RETRY_MAX`, last error) is what the dev inspector's pending strip
  displays.

## GameSession

- `GameSession` carries three per-AI maps from one round into the next:
  `priorToolRoundtrip`, `priorDiskSnapshots` and `priorDiskEntities`.
  `runRound` replays the tool roundtrip (the OpenAI `tool_calls` and their
  results) into the message builder. It uses the snapshots and entities to
  write the `<whats_new>` diff and the perception-delta lines
  (first-sight, departure, transition).
- Only the latest round's tool roundtrip matters, so each round replaces
  `priorToolRoundtrip` completely. The two disk maps are merged instead. A
  locked-out AI produces no new capture that round and keeps its old one, so its
  diffs pick up cleanly when the lockout lifts.
- `submitMessage` returns only the round result and the next state. It does not
  return the raw assistant text: the view paints panels from the `message`
  entries that `encodeRoundResult` emits (since #214).
- `GameSession.restore` builds the instance with `Object.create` so it skips the
  constructor, which would call `startGame`. Class field initializers do not run
  on that path, so `restore` sets the three maps itself.
- If `objectiveTypes` is not passed to the constructor, the session has no
  Objectives.

## Addressing: mentions and the composer

The player addresses a daemon by typing `*name` in the composer. For the handle
format and why identity is the `*xxxx` AiId rather than a color, see
CONTEXT.md under **AiId** and **blue**.

- A mention must come at the start of the text or after whitespace. It is
  case-insensitive, and the first mention that matches a known persona wins.
- `MentionMatch.nameEnd` is where the highlight ends. `end` also takes in one
  trailing punctuation character, so "*Sage," does not leave a bare comma as the
  message body.
- `deriveComposerState` enables Send only when there is an addressee, the
  addressee is not chat-locked, and some text remains outside the mention. The
  border, panel and mention highlight still show when Send is disabled, so a
  locked addressee still gets visual feedback.
- `applyAddresseeChange` rewrites the first mention in place, keeping the cursor
  on the same side of it. With no mention, it prepends `*name `.
- `buildPersonaColorMap` reads the persona's `color` field, never the AiId, so
  changing the palette means changing only the persona records.

## Seeds

- `spike-seed.ts` (spike #239) exists only for that spike. When `?seed=N` is
  set, `getSpikeRng(label)` returns a Mulberry32 stream seeded from the master
  seed XOR an FNV-1a hash of the label. Each label gets its own stream, so
  personas and content packs running concurrently do not race for draws. The
  text the LLM writes is still random; the spike accepts that as cosmetic,
  because the choices driven by the rng dominate game-to-game variance. When no
  seed is set, callers fall back to `Math.random`.

## Tests

- `__tests__/fixtures/make-test-pack.ts` builds a `ContentPack` from a flat entity
  list. It keeps the input order. Its `overrides` argument wins over everything,
  including `entities`, so a test can inject a malformed pack. Since the v11
  schema flip (#462), it only copies the list onto `pack.entities`.
- `__tests__/fixtures/make-game-state.ts` holds the shared game-state builders:
  the three test personas, the `ROW_AI_STARTS` and `CORNER_AI_STARTS` layouts,
  `makeTestGame` (a `startGame` over `makeTestPack` with a `"wall"` wall name
  and a $5 budget by default), `makeEntity`, `seededRng`, `makeSilentProvider`,
  `withCountdownZero` and `withPackOrderedWorld`. Suites keep a small local
  wrapper when their setup genuinely differs.
- `src/content/__tests__/content-pack-generator.test.ts` checks the placement
  constraints of `generateDualContentPacks` directly over seeded runs: obstacles
  never share a cell, nothing else sits on an obstacle, every open cell is
  reachable from every AI start, and a carry object never starts on its own
  space.
- Scripted daemon responses in `game-session.test.ts` include a `message` tool
  call. Without one, the round coordinator's #254 retry would fire in tests that
  are not about retries.
