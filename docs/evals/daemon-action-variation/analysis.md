# Daemon action variation — eval analysis

**Date:** 2026-05-19 / 2026-05-20
**Model:** `z-ai/glm-4.7`
**Reps:** 20 per (scenario × persona) cell — 240 reps per run

> **Status note (post-#466–#472):** the tool-surface change these runs
> projected — drop `examine`, rename `look` → `face`, drop `give` — has
> since merged into the production engine. The eval harness now runs
> natively against that surface (the `EVAL_TOOL_SURFACE=5tool`
> projection was removed). The "5-tool" runs below were produced by the
> eval-local projection against the pre-merge engine; their numbers are
> still indicative. **The recommended fresh native run has now been
> collected — see the [2026-06-01 native run](#native-run-2026-06-01)
> section immediately below, which supersedes the projected numbers.**

This file aggregates three pairs of runs:

1. **v2 (7-tool surface, hard directive)** — baseline $0.22 + treatment $0.26 = $0.48
2. **5-tool surface, v2.0 hard directive** — baseline $0.22 + treatment $0.24 = $0.46
3. **5-tool surface, v2.5 soft directive (70/30 lean)** — baseline reused + treatment $0.28

The 5-tool/v2.5 section is the current best calibration. v2 results remain
valid as the calibration data for the current production engine.

---

## Native run 2026-06-01

**Date:** 2026-06-01 · **Model:** `z-ai/glm-4.7` · **Reps:** 20 per cell,
180 reps per run. First run on the *real* merged 5-tool surface (no
eval-local projection), collected on branch
`fix/action-averse-daemon-draws` (PR #506). An HTML summary of this run
lives at `~/html/eval-report.html`.

This run does two things: (1) confirms the action-profile lift survives
the native surface, and (2) adds a dedicated **action-averse** pass that
exercises the guardrails added in PR #506 — which the representative
personas never trigger.

Output files:
`{baseline,with-profiles}-default-2026-06-01.{md,json}` (representative
personas) and `{baseline,with-profiles}-action-averse-2026-06-01.{md,json}`
(the three worst action-averse pairs).

### Representative personas (action-positive)

Personas: Ember (curious+meticulous), Vex (zealous+hot-headed), Pip
(sweet+effusive). These all have `go`/`use` bias sums ≥ 0, so the PR's
floor and avoided-exclusion never fire — the per-persona bias tables are
byte-identical between baseline and treatment. This cell validates the
*feature*, not the *fix*.

| Metric | Baseline | With profiles | Δ |
|---|---|---|---|
| Any action emission | 46% | **70%** | **+24 pp** |
| Any `message` emission | 99% | 93% | −6 |
| Parallel (message + action) | 44% | **63%** | **+18 pp** |
| Silent | 0% | 0% | 0 |
| `use` emission rate | 30% | 28% | −2 |
| Cost | $0.262 | $0.186 | — |

The +24 pp any-action / +18 pp parallel lift holds on the native surface,
messaging stays healthy at 93%, and silence stays at 0%. The big movers
are the exploration cells, where `face` — near-absent at baseline —
emerges as a real choice (Ember 0→50%, Pip 0→70%).

Two single-cell soft spots, both within 20-rep noise (~±10 pp) and
consistent with the known 70/30-spread tradeoff:

| Cell | tool | baseline | treatment | Δ pp |
|---|---|---|---|---|
| objective × Ember | `use` | 70% | 55% | −15 |
| social × Vex | `go` | 70% | 50% | −20 |

Not enough to retune on one run — the bar is ~3 consecutive runs showing a
stable shift.

### Action-averse pairs (the PR's guardrails)

Pairs: `melancholic+diffident`, `diffident+aloof`, `melancholic+melancholic`
— the worst action-averse draws. The summed bias debug confirms the
guardrails are active: `go = −1` for all three (raw `−3` to `−4` before the
floor) and `use = −1` (raw `−2`); with the avoided-exclusion, neither
`go` nor `use` is ever named in a "hesitant about" clause.

| Metric | Baseline | With profiles | Δ |
|---|---|---|---|
| Any action emission | 34% | 32% | −2 |
| Any `message` emission | 98% | 96% | −2 |
| Parallel (message + action) | 32% | 28% | −4 |
| Silent | 0% | 0% | 0 |
| `use` emission rate | 33% | 32% | −1 |

Per-cell, the shape is the story:

- **objective scenario:** treatment `use` stays **90–100%** across all
  three pairs, and silence is 0% everywhere — cautious draws still
  complete objectives. This is the guardrail's core promise, kept.
- **exploration / social scenarios:** ~0% action in *both* baseline and
  treatment. For deeply action-averse pairs the temperament prose
  dominates; the profile cannot manufacture engagement the personality
  refuses.

**Interpretation.** The guardrails do their job — cap the downside (no
avoid-the-critical-path, no silence, `use` preserved) rather than boost
action. The flat-to-slightly-negative aggregate (34→32%) is within noise,
but its direction is a hint: for pairs with *no* preferred tool the
rendered clause is now pure-avoidance, which may mildly reinforce
inaction. Candidate follow-up (not this PR): A/B whether omitting the
`<action_profile>` block entirely for no-preferred personas reads better
than a pure-avoidance clause. Gate on ≥3 runs before acting.

### Verdict

- **Ship the feature** — clears every success bar on the native surface
  (any-action 70%, parallel 63%, messaging 93%, zero silence).
- **Ship the guardrails** — validated: `use` 90–100% on objective, zero
  silence, floor provably active.
- **No `ACTION_TOOL_BIAS` retune indicated** — the action-positive soft
  spots and the action-averse flat delta are both within noise.

---

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
[daemon-action-variation eval](./with-profiles-2026-05-19.md).
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
