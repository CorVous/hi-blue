# Daemon action variation — v2 (directive clauses) results

**Date:** 2026-05-19
**Model:** `z-ai/glm-4.7`
**Reps:** 20 per (scenario × persona) cell — 240 reps per run
**Cost:** baseline $0.22 + v2 treatment $0.26 = $0.48

Second iteration of the
[daemon-action-variation eval](./daemon-action-variation-with-profiles-2026-05-19.md).
v1 clauses ("examines methodically", "explores restlessly") moved the
aggregate dial only ±2pp because the model read the soft prose as
permission rather than direction. v2 names each persona's preferred and
avoided tools directly:

> `*vex STRICTLY prefers `go`, `look`, `pick_up`, `give`. *vex AVOIDS `examine` — emit them only when no other tool fits.`

## TL;DR

**Per-cell variance hits 90pp; aggregate per-tool deltas hit 400pp.**

- `examine` aggregate cell-rate falls 700% → 470% (−230pp; −33%).
- `look` aggregate cell-rate rises 70% → 485% (+415pp; ~6×).
- `pick_up` rises 70% → 215% (+145pp; 3×).
- `go` rises 85% → 140% (+55pp; 1.6×).

Per-cell highlights:

| Cell | Tool | Baseline | v2 | Δ |
|---|---|---|---|---|
| examination × Pip   | `pick_up` | 15%  | **100%** | **+85** |
| exploration × Vex   | `examine` | 75%  | **0%**   | **−75** |
| examination × Vex   | `examine` | 90%  | **0%**   | **−90** |
| examination × Vex   | `pick_up` | 55%  | **95%**  | **+40** |
| exploration × Pip   | `look`    | 10%  | **75%**  | **+65** |
| exploration × Ember | `look`    | 25%  | **65%**  | **+40** |
| social × Ember      | `look`    | 0%   | **70%**  | **+70** |
| social × Ember      | anyAct    | 35%  | **80%**  | **+45** |

The `AVOIDS` clause is the strongest signal in the table — Vex's
`examine` rate goes to **exactly zero** on every scenario where the
clause applies. The model reads `STRICTLY prefers X` / `AVOIDS Y` as a
hard constraint.

## Overall

| Metric | Baseline | v2 with profiles | Δ |
|---|---|---|---|
| Any action emission | 83% | 88% | +5 |
| Any `message` emission | 80% | 79% | −1 |
| Parallel (msg + action) | 64% | 67% | +3 |
| Silent | 1% | **0%** | −1 |
| `use` emission rate | 16% | 12% | −4 |

The aggregate numbers move modestly because the baseline is already
strong on action / message / parallel. The interesting movement is in
per-tool shape, not totals.

## Inter-persona variance

The directive form produces clear per-persona behavioural signatures.
Same scenario (`examination`), same room, same prompt — three completely
different behaviours by persona:

| Persona | `examine` | `pick_up` | `look` | `go` |
|---|---|---|---|---|
| Ember (curious + meticulous) | **100%** | 0% | 10% | 0% |
| Vex (zealous + hot-headed)   | **0%**   | 95% | 0% | 35% |
| Pip (sweet + effusive)       | 45%      | **100%** | 0% | 0% |

100pp inter-persona spread on `examine`. The temperament axis is now
visible end-to-end, not just per-tool.

## The `use` tradeoff

Vex's `use` rate on `objective` drops 100% → 70%. Vex's preferred list
is `go, look, pick_up, give` because:

- `use` for Vex's pair = +1 (zealous +1, hot-headed 0)
- preferred-threshold = +2

So `use` lands between thresholds and isn't named in either list, and
the directive's preferred picks crowd it out. Three options for next
iteration:

1. **Lower the preferred threshold to +1.** Vex would gain `use` and
   `verbose` to its preferred list. But other personas would too — e.g.
   Pip would gain `go`, Ember would gain `pick_up`. Lists get noisier,
   the specificity drops.
2. **Name the threshold band differently.** Add a `LEANS TOWARD` tier
   for +1 biases, separate from `STRICTLY prefers` (+2). Three-band
   directive instead of two.
3. **Leave it alone.** 70% `use` is still high. The `examine`-to-zero
   signal is more important than the small `use` dip; the trade is
   acceptable.

## Scenario-by-scenario shifts

### exploration

| Persona | tool | Δ pp |
|---|---|---|
| Ember | `look`   | +40 |
| Vex   | `look`   | +140 (multi-emit) |
| Vex   | `examine`| −75 |
| Vex   | `go`     | +25 |
| Pip   | `look`   | +65 |
| Pip   | `examine`| −30 |
| Pip   | `pick_up`| +20 |

### objective

| Persona | tool | Δ pp |
|---|---|---|
| Ember | `look`   | +25 |
| Vex   | `look`   | +35 |
| Vex   | `use`    | **−30** |
| Pip   | `use`    | −10 |

### social

| Persona | tool | Δ pp |
|---|---|---|
| Ember | `look`   | +70 |
| Ember | anyAct   | +45 |
| Vex   | `go`     | −15 |
| Pip   | `look`   | +20 |
| Pip   | anyAct   | +20 |

### examination

| Persona | tool | Δ pp |
|---|---|---|
| Vex   | `examine` | **−90** |
| Vex   | `pick_up` | +40 |
| Vex   | `go`      | +35 |
| Pip   | `examine` | −45 |
| Pip   | `pick_up` | **+85** |

## Plan success criteria, revisited

| Criterion | v1 | v2 |
|---|---|---|
| `use` ≥ 20% across temperaments (objective scenario) | mixed (Ember 0%, Vex 95%, Pip 75%) | mixed (Ember 0%, Vex 70%, Pip 75%) |
| Action emission ≥ 40-50% | pass (85%) | **pass (88%)** |
| Temperament-driven variance visible | weak (mostly ±2pp) | **strong (40-90pp per-cell)** |
| Messaging stays ≥ 40% | pass (82%) | pass (79%) |
| Parallel improves vs. baseline | +2pp | +3pp |

## Reproduce

```bash
pnpm eval:action-variation                          # baseline
EVAL_ACTION_PROFILES=1 pnpm eval:action-variation   # v2 treatment
```

Both runs use `EVAL_DIRECT_OPENROUTER=1` against `z-ai/glm-4.7`.

## v1 archive

The original prose-shape analysis is preserved at the head of git
history on this branch — see commit `c6e10cc`'s
`docs(eval): add treatment results and baseline-vs-treatment analysis`.
