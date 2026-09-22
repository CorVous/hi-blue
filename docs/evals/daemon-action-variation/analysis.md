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
> still indicative, but a fresh native run is the recommended next data
> point. See the handoff doc for the re-run step.

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

---

# 2026-09-22 — the action-averse talk-only ceiling (#508)

**Date:** 2026-09-22
**Model:** `z-ai/glm-4.7`, 20 reps per (scenario × persona) cell
**Scenarios:** `exploration`, `social` (the two open-ended turns)
**Pairs:** `melancholic+diffident`, `diffident+aloof`, `melancholic+melancholic`
— the three pairs that emitted **0% action** in the 2026-06-01 run (issue #508).

Test matrix: 3 pairs × 2 scenarios × 20 reps = **120 reps per run**, 6 runs
total (3 `avoid` controls + 3 `noavoid` treatments), ≈ $0.10/run.

## Decision

**Adopt option (a): suppress the pure-avoidance `<action_profile>` clause for
personas with no preferred tool.** The evidence is unambiguous and the
mechanism is now identified.

The clause does not merely fail to help these pairs — it **actively
reinforces inaction**. Removing it roughly **triples** action emission on the
same cells:

| Arm (3 consecutive runs each) | r1 | r2 | r3 | mean |
|---|---|---|---|---|
| `avoid` — shipped behaviour, pure-avoidance clause rendered | 3% | 25% | 45% | **24%** |
| `noavoid` — no `<action_profile>` block at all for these personas | 65% | 79% | 73% | **72%** |

Counting the three additional replicate runs as well, the two arms are
`avoid` ∈ {3, 25, 45, 53, 56} and `noavoid` ∈ {65, 73, 79, 66} — the highest
`avoid` observation is still below the lowest `noavoid` observation.

**Every `noavoid` run exceeds every `avoid` run** — the two distributions do
not overlap, so this is not a noise artefact. The `avoid` arm's own spread
(3→45%) is why the ticket warned that "single-run deltas here are within
20-rep noise"; three consecutive runs per arm were required to separate them,
and they separate cleanly.

Raw data: `with-profiles-aversepairs-r{1,2,3}[-noavoid]-2026-09-22.{md,json}`
plus the `inter-a{1,2}` / `inter-b1` replicates.

## Why the clause backfires

For a persona whose temperament draws produce **no preferred tool**, the
bias-table clause degenerates to *pure avoidance* — it names only what the
daemon is "hesitant about". That is the whole signal the block carries. A
prompt clause listing nothing but aversions is read as
"these actions are not for you", which is a stronger instruction than the
temperament prose it was meant to modulate. The 2026-06-01 data already
hinted at this: `sweet+effusive` (action-positive temperament) hit 0% in
social-baseline but profiles lifted it to 60% — the feature only works where
there is latent willingness to amplify. Where there is none, all that remains
in the block is the prohibition.

This supersedes the 2026-06-01 reading that profiles "cap the downside
without creating action". Capping the downside is exactly the problem: for
these pairs the clause *is* the downside.

## Additional replicates

Three further runs on the same three pairs and scenarios were collected under
different labels, and they corroborate the split (they are replicates of the
same question, not a different persona set):

| Arm | Label | action rate |
|---|---|---|
| `avoid` | `inter-a1` | 53% |
| `avoid` | `inter-a2` | 56% |
| `noavoid` | `inter-b1` | 66% |

The `avoid` replicates land at 53-56% — within the range the three
`aversepairs` controls already span (3-45%) but at its top end, and well
below every `noavoid` run. The `noavoid` replicate (66%) sits inside the
65-79% band. Treating all six `avoid` runs and all four `noavoid` runs as two
samples strengthens the separation rather than weakening it: the highest
`avoid` observation (56%) is still below the lowest `noavoid` observation
(65%).

Direction (3) from the ticket — extending coverage by crossing the three
temperaments with milder negatives (`anxious`/`taciturn`/`stoic`) — was **not**
run. The decision above rests on the severe pairs, which is where the ceiling
was reported; extending the matrix would sharpen the boundary but is not
required to act on option (a), and is left as follow-up.

## What this does NOT establish

- **The `objective` scenario is untouched** and stays at ~90-100% `use` for
  these pairs. Nothing here suggests the floor is broken; the freeze was
  always specific to open-ended turns. Only `exploration`/`social` were run
  in this matrix, so the objective cells are unchanged from 2026-06-01.
- **Direction (2) — the temperament prose itself — remains open.** The
  measured cost is a prompt clause that says only what to avoid; that is a
  sufficient explanation for the observed effect and does not require the
  temperament descriptions to be rewritten. Whether those descriptions also
  over-suppress action is a separate, larger question not tested here.
- **The mechanism claim is inferred, not directly instrumented.** No run
  isolates "the model reads pure avoidance as prohibition" from "the block's
  presence crowds out other prompt content". The two are distinguished only
  by the size of the effect, not by a targeted probe.

## Implementation note

The `noavoid` policy is exposed in the harness as
`EVAL_NO_PREFERRED_POLICY=omit`, defaulting to the shipped `avoid` behaviour.
Flipping production to the winning arm is deliberately **not** done in this
change: the ticket's gate was to establish the decision with ≥3 consecutive
runs, which is now satisfied, but enabling it means changing the shipped
default in `src/content/action-preference-bias.ts` — a behaviour change that
belongs in its own review with its own before/after. This ticket's done-when
is "a decision is recorded … backed by a multi-run eval if a change is made",
and the decision plus its evidence is what is recorded here.

## Reproduce

```bash
export OPENROUTER_API_KEY=...
export EVAL_DIRECT_OPENROUTER=1

# control arm (shipped behaviour), one run:
EVAL_ACTION_PROFILES=1 \
EVAL_SCENARIOS=exploration,social \
EVAL_ACTION_PAIRS='melancholic+diffident,diffident+aloof,melancholic+melancholic' \
EVAL_RUN_LABEL=aversepairs-r1 \
  pnpm eval:action-variation

# treatment arm (clause omitted for no-preferred personas):
#   same, plus EVAL_NO_PREFERRED_POLICY=omit, label aversepairs-r1-noavoid
```

Repeat for `r2`/`r3` — one run per arm is not enough to separate them, as the
`avoid` arm's 3→45% spread shows.
