# Daemon action variation — eval analysis

**Date:** 2026-05-19 / 2026-05-20
**Model:** `z-ai/glm-4.7`
**Reps:** 20 per (scenario × persona) cell — 240 reps per run

This file aggregates three pairs of runs:

1. **v2 (7-tool surface, hard directive)** — baseline $0.22 + treatment $0.26 = $0.48
2. **5-tool surface, v2.0 hard directive** — baseline $0.22 + treatment $0.24 = $0.46
3. **5-tool surface, v2.5 soft directive (70/30 lean)** — baseline reused + treatment $0.28

The 5-tool/v2.5 section is the current best calibration. v2 results remain
valid as the calibration data for the current production engine.

## Headline: 5-tool surface, v2.5 treatment vs. baseline

Aggregates over 9 cells (3 scenarios × 3 personas — the original
`examination` scenario was dropped; see "examination scenario removed"
below). Numbers in parens are the 12-cell aggregates from before the
removal, kept for back-reference.

| Metric | Baseline | v2.0 (hard) | v2.5 (soft 70/30) |
|---|---|---|---|
| Any action emission | **36%** (52%) | **66%** (73%) | **74%** (81%) |
| Any `message` emission | 97% (94%) | 91% (87%) | 89% (89%) |
| Parallel (msg + action) | **33%** (46%) | **56%** (60%) | **64%** (70%) |
| Silent | 1% (0%) | 0% (0%) | 0% (0%) |
| `use` emission rate | 26% (19%) | 24% (18%) | 24% (18%) |

**v2.5 produces the strongest numbers in the eval so far:**
- **+39pp any-action vs. baseline** (was +30 in v2.0).
- **+31pp parallel vs. baseline** (was +23 in v2.0).
- Messaging held at 89% — softer language doesn't suppress chat the way
  the hard directive did.

### examination scenario removed

The original eval had four scenarios. `examination` (daemon stands one
cell from an interesting unexamined object) was dropped because:

1. The proposed surface change auto-shows item descriptions, so
   "curiosity-driven examine" stops being a meaningful test — the
   daemon already sees what the item is.
2. Across all three personas, the baseline already emitted 95-100%
   `pick_up` on this scenario (it's the only sensible action). The
   cells masked treatment effect rather than measuring it.

Dropping these three cells strengthens the aggregate signal — the 9
remaining cells exercise scenarios where the model has real choices
between message-only, action, or both.

### What v2.5 changed in the prose

```
v2.0: *vex STRICTLY prefers `go`, `face`, `pick_up` — these come first.
v2.5: *vex leans toward `go`, `face`, `pick_up` (~70% of action emissions).
      The remaining ~30% spreads across the other available action tools —
      don't fixate on a single tool. Variety beats repetition.

v2.0: *name AVOIDS X — emit them only when no other tool fits.
v2.5: *name is hesitant about X — picks them less often than other actions,
      but still uses them when the moment clearly calls for it.
```

The intent was to keep persona-leaning behaviour but stop the model from
treating "STRICTLY prefers X" as "always pick X". Avoided tools get a
nonzero floor so cautious personas still move and use items occasionally.

### Within-persona variety: mixed results

The 70/30 wording worked best where the persona's preferred tool was NOT
also the contextually-correct answer:

| Cell | v2.0 dominant rate | v2.5 dominant rate |
|---|---|---|
| exploration × Ember (`face`) | 70% | **35%** ✓ (spread to pick_up 10%, go 5%) |
| objective × Ember (`face`) | 25% | 15% ✓ (use rose 20→35%) |

Where the preferred tool IS the right answer, the model still concentrates
on it — variety language doesn't override situational correctness:

| Cell | v2.0 | v2.5 |
|---|---|---|
| examination × Vex (`pick_up`) | 85% | 100% |
| examination × Pip (`pick_up`) | 95% | 95% |
| social × Vex (`go`) | 80% | 95% |

This is a defensible outcome — the model still picks the right tool when
the situation demands it, and only spreads when multiple actions are
equally reasonable.

## Headline: 5-tool surface, v2.0 vs. baseline (archival)

| Metric | Baseline | v2.0 (hard directive) | Δ |
|---|---|---|---|
| Any action emission | 52% | **73%** | **+21 pp** |
| Any `message` emission | 94% | 87% | −7 |
| Parallel (msg + action) | 46% | **60%** | **+14** |
| Silent | 0% | 0% | 0 |
| `use` emission rate | 19% | 18% | −1 |

### Per-cell highlights — 5-tool

| Cell | metric | baseline | treatment | Δ pp |
|---|---|---|---|---|
| exploration × Ember | anyAct  | 0%  | **70%** | **+70** |
| exploration × Vex   | anyAct  | 40% | **95%** | **+55** |
| exploration × Pip   | anyAct  | 10% | **60%** | **+50** |
| exploration × Pip   | pick_up | 0%  | **55%** | **+55** |
| social × Vex        | anyAct  | 40% | **90%** | **+50** |
| social × Vex        | parallel| 40% | **90%** | **+50** |
| social × Vex        | go      | 40% | **80%** | **+40** |
| examination × Ember | go      | 5%  | 20%     | +15 |

### Per-tool aggregate (5-tool, sum across 12 cells)

| Tool | Baseline | Treatment | Δ |
|---|---|---|---|
| `go`      | 95%  | **195%** | +100 pp (~2×) |
| `face`    | 10%  | **150%** | **+140 pp (~15×)** |
| `pick_up` | 290% | 360%  | +70 |
| `use`     | 230% | 215%  | −15 |
| `message` | 1265%| 1175% | −90 |

`face` is a new lexical element to the model — the baseline rarely uses it.
The directive clause naming `face` in preferred lists is what teaches the
model to reach for it.

### Tradeoff — 5-tool

**Vex objective parallel −20 pp.** Vex emits `use` at 100% in both runs
(critical-path correctness is preserved), but treatment cuts companion
`message` from 95% → 75%. The action-heavy directive suppresses messaging
when the daemon already knows what to do.

## v2 (7-tool surface, directive clauses)

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
