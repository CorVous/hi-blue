# ADR 0010 — Content-pack partial-retry: per-unit batched repair instead of full re-roll

**Status:** Accepted

`BrowserContentPackProvider.generateContentPacks` is the bootstrap-blocking call that produces every phase's **Content Pack** at game start. Its prompt asks the LLM to honour several discoverability rules — paired-space prose-tell, verb-of-activation cue, `{actor}` token presence/exclusion — that gate the AI-readability of the room. When the model drifts on any one of these on any one entity, the only repair affordance today is to throw the entire pack away and re-roll the whole prompt. PR #345 documented this cost by softening four of those rules from `ContentPackError` to `console.warn` rather than pay the re-roll on cosmetic drift, which trades correctness for boot reliability. This ADR records the architecture that lets us re-promote those rules without that trade.

## Decision

`generateContentPacks` gains a **partial-retry layer** that sits between validation and the full pack re-roll. When validation collects per-entity failures, the provider issues a single **batched repair call** scoped to the entities that drifted — one **Objective Pair**, **Interesting Object**, or **Obstacle** at a time as a *retry unit* — splices the regenerated entities back into the in-memory pack, and re-runs validation on the patched slice. Two rounds of batched repair are attempted (per-unit cap = 2 via round count); exhaustion falls through to the outer full-pack retry from PR #381. Non-validation failures (empty response, JSON parse, network, rate-limit) skip the partial-retry layer and use uniform exponential backoff against the outer budget. `CapHitError` continues to short-circuit.

`BOOTSTRAP_LOADING_TIMEOUT_MS` rises from 90s to 120s to absorb the worst-case wall-clock of `1 full call + 2 rounds of partial + 1 outer retry`.

The validator is refactored to return a `ValidationResult` (`{ ok, errors: ValidationError[] }`) rather than throwing on the first failure; existing throw-based callers get a thin `validateContentPacksOrThrow` wrapper. Each `ValidationError` carries the `retryUnit` metadata the partial-retry layer dispatches on.

## Considered Options

**Per-pair / per-entity granularity (chosen).** The only cross-entity rule (paired-space prose-tell) crosses inside one **Objective Pair**, so the pair is the natural unit for it; everything else is intrinsic to a single entity. Per-field was rejected as too fine — objective_object's `examineDescription` already needs the pair partner's name, so per-field would always pull the pair in anyway. Per-phase (re-roll a single phase, not the whole pack) was rejected as too coarse — most drift is one entity, not five.

**Fresh `chatCompletionJson` call with counter-example user turn (chosen).** Conversation-continuation (append the drifted output as an assistant turn, then a corrective user turn) was rejected: the prior output is what drifted, and giving it back to the model as conversation history risks re-anchoring on the bad output. Framing the bad fragment as a labelled *counter-example* in a fresh user turn ("your previous attempt produced X which violated rule Y") is a louder signal, and keeps the call stateless — fitting the existing `chatCompletionJson` primitive without an LLM-client refactor.

**Batched single call per round (chosen).** The alternatives were N sequential calls per round (busts the 90s timeout at 3 units) and N parallel calls per round (comparable wall-clock but pays an N× token premium and risks OpenRouter rate-limit). Batching one structured response per round trades isolation for cost — if the LLM drops a unit, that round produces no repairs and falls through to round 2 or the outer retry. Per-unit cap = 2 = round count, so the failure mode is bounded.

**Pure-result validator API (chosen).** A throw-on-first-with-aggregate `ContentPackValidationError extends ContentPackError` was a viable smaller-diff alternative, but it shoehorns "validation data" into "exception" semantics — once partial-retry exists, the validator's job is to produce structured data about what's wrong, not to tear the world down. The existing `expectWarnNotThrow` test helper already side-channels that distinction through a `console.warn` spy; the pure-result API makes it first-class.

**`{actor}` → verb-of-activation → paired-space re-promotion order (chosen).** The motivating bug (paired-space, #253) goes last because it (a) is blocked on #382's matcher fix, (b) introduces cross-entity context plumbing into the partial-retry prompt, and (c) had the worst observed drift (0/10 tells across playtests 0006/0007). Landing the layer on `{actor}` rules first validates the pipeline on the cheapest possible blast radius.

## Consequences

- The five rules previously softened by PR #345 are re-promoted to `ContentPackError`, restoring the AI-discoverability guarantees the **Content Pack** is supposed to provide.
- Partial-retry round-trips are billed to the same LLM budget as the original generation. Empirical wall-clock per partial round needs measurement once the layer is live — the 120s bootstrap timeout assumes ~25s per round, and a tighter ceiling may be needed if reality is closer to 30-40s.
- `MockContentPackProvider` continues to stub at the `ContentPackProvider` interface boundary for consumer tests. The partial-retry layer is internal to `BrowserContentPackProvider` and is tested via a new `chatFn` constructor parameter that injects the LLM call.
- The validator's pure-result shape makes adding new per-entity rules cheaper — each rule appends a `ValidationError` rather than threading a new throw site through every caller.
- The partial-retry response schema is its own JSON contract (a discriminated array of unit repairs) that the LLM must honour. If GLM-4.7 drifts on the contract itself, both rounds fail and the outer full-pack retry recovers — but the failure mode is "all-or-nothing per round" rather than "per-unit," and is bounded by the round cap.
