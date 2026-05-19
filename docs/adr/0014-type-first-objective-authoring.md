# ADR 0014 — Type-first objective authoring: draw Objectives before Content-Pack flavor

**Status:** Accepted

Today, `generateContentPack` asks the LLM to author every `objective_space` with full UseSpace AND Convergence flavor (10 fields) and every `interesting_object` with full UseItem flavor (~7 fields). Only afterwards does `startGame` call `drawObjectives` (`src/spa/game/objective-pool.ts`) to pick the 3 **Objective** records that actually fire. The result is that roughly 40% of authored flavor — convergence-tier strings on Carry-only spaces, `activationFlavor` on items that never become UseItem targets, post-\* fields on entities that never get used — is dead weight in every game.

## Decision

Reverse the bootstrap path: roll 3 **Objective** types in code (uniform with replacement over {Carry, UseSpace, UseItem, Convergence}) **before any LLM call**. Each drawn Objective mints its own dedicated entity (or pair for Carry) — **strict 1-to-1 binding** — and the LLM is asked to author **only the flavor that binding will fire**.

- A **Carry-bound** space has no use-cue or convergence-hint in its `examineDescription`; it carries `name`, `examineDescription`, `proximityFlavor` only. Its paired Carry-bound object carries the full Carry shape (`placementFlavor`, paired-space tell, etc.).
- A **UseSpace-bound** space has a use-cue (no convergence-hint), plus `activationFlavor`, `satisfactionFlavor`, `postExamineDescription`, `postLookFlavor`.
- A **Convergence-bound** space has a convergence-hint (no use-cue), plus the four `convergenceTier{1,2}{,Actor}Flavor` fields.
- A **UseItem-bound** item has the activation-cue tell, plus `useOutcome`, `activationFlavor`, `postExamineDescription`, `postLookFlavor`.

Two **lean decoy** `interesting_object`s are added per pack — only `examineDescription` + `proximityFlavor` + `useOutcome`, **forbidden** from the activation-cue tell. The AI can prune them via `examine`; their role is atmospheric / negotiation filler, not puzzle deception.

`drawObjectives` and the convergence-pool inclusion guard at `src/spa/game/objective-pool.ts:76-85` are removed. Pack A and Pack B continue to share entity IDs, kinds, placements, and Objective bindings; only flavor strings differ across settings.

## Considered Options

**Strict 1-to-1 binding (chosen).** Each drawn Objective gets its own entity. Maximises per-field savings, simplifies the LLM prompt (each entity has exactly one binding), and avoids degenerate "one action satisfies two Objectives" gameplay. Letting a single space back both UseSpace and Convergence — the obvious alternative — reintroduces 8-field spaces with dual tells (use-cue AND convergence-hint), cancelling most of the savings. Same-Objective duplicates (today's with-replacement semantics in `drawObjectives`) were rejected as a leftover of the pool design, not a designed feature.

**Lean decoys (chosen).** Decoys are minimal `interesting_object`s, identifiable as decoys by examination because they lack the activation-cue tell. The alternative — indistinguishable mimic-decoys with fake `activationFlavor` that fires once harmlessly — preserves puzzle depth but reauthor's the per-field cost we're escaping and runs ~the same LLM-token cost per decoy as a real entity. Decoys-as-decoration is the smaller, more honest design; it accepts a thinner puzzle (AIs prune decoys after one examine) in exchange for the authoring savings.

**Uniform with replacement over 4 Objective types (chosen).** Simplest distribution; produces real variance including occasional 3-of-a-kind games. Alternatives — without replacement (forces 3 distinct types, makes games samey), weighted (prefers Carry / penalises Convergence), and structured constraints ("always 1 Carry") — all bake designer preference into structure before we have playtest data showing which type ratios actually feel good. Variance is recoverable via weighting later if needed.

**Type-first determinism in code, not in the LLM (chosen).** Drawing types via the Session-seeded RNG before the LLM call keeps the random Objective subset reproducible from the seed and lets the prompt prescribe exactly the required fields. Asking the LLM to choose the Objective mix was rejected: it pushes a structural decision into a creative call, complicates retry semantics, and erases per-Session seed reproducibility.

**Variable entity count, no clamp (chosen).** A pack carries 5–8 Objective-capable entities (3 UseItem-only floors the count at 3 + 2 decoys = 5; 3 Carry tops it at 6 + 2 decoys = 8). Clamping to a fixed count would force entity-sharing across Objectives, reintroducing the multi-binding flavor cost.

## Consequences

- **LLM-token cost per pack drops ~40% on average.** A worst-case 3×Convergence game still authors 12 convergence flavor fields (3 spaces × 4) but skips all UseSpace and Carry-shaped fields on those spaces; a 3×Carry game authors 6 mostly-lean entities.
- **AI discovery loop narrows.** Decoys become identifiable via examination, so the puzzle leans entirely on entities that DO carry tells. This is a deliberate trade — accepted as part of the lean-decoy choice — and may show up in playtests as faster solves or fewer wrong-action attempts.
- **Validator becomes binding-aware.** Each entity's required prose tells and authored fields are determined by its binding, not its kind. The pure-result `ValidationResult` API (per ADR 0010) is unchanged; `ValidationError` records gain a binding alongside the entity ID.
- **Partial-retry layer (ADR 0010) extends naturally.** Retry units stay at "Carry pair" / "single entity"; the retry prompt includes the entity's binding so regenerated flavor matches the required field set.
- **`drawObjectives` and the convergence-pool inclusion guard at `objective-pool.ts:76-85` are removed.** Bindings determine flavor at authoring time; runtime no longer needs a guard.
- **Pack storage shape: flat `entities` list, bucket views derived.** The on-disk shape is a single `ContentPack.entities: WorldEntity[]` (schema v11; flattened from the v10 bucketed shape in #462). The four bucket views the rest of the engine talks in — `carryPairs`, `boundSpaces`, `interestingObjects`, `obstacles` (plus the union `objectiveSpaces`) — are derived on demand by `src/spa/game/pack-selectors.ts`. Binding-aware authoring (above) writes into the flat list; selectors read out of it. New games are minted with partial flavor under the new flow; the v10→v11 migration (handled in #462) brings older Sessions onto the flat shape so the new code path sees a uniform input.
- **Test surface shifts.** Generator, validator, partial-retry, and pack-shape fixtures across `__tests__/` need updating to the new authoring contract. `MockContentPackProvider` continues to stub at the `ContentPackProvider` boundary.
