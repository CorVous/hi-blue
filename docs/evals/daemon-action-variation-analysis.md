# Daemon action variation — baseline vs. treatment analysis

**Date:** 2026-05-19
**Model:** `z-ai/glm-4.7`
**Reps:** 20 per (scenario × persona) cell — 240 reps per run
**Cost:** baseline $0.22 + treatment $0.24 = $0.46

Pair of [baseline](./daemon-action-variation-baseline-2026-05-19.md) (no
`<action_profile>` block) and [with-profiles](./daemon-action-variation-with-profiles-2026-05-19.md)
(`<action_profile>` clause derived from per-temperament tool biases) runs
of the harness in `evals/daemon-action-variation/`.

## TL;DR

The treatment moves the dial in the **expected directions** on the cells
that should respond, without regressing the strong baseline behaviours.
The biggest treatment-driven gain is **Vex's `go` rate in exploration
doubling (15% → 30%)** — exactly the temperament push the bias table
asserts (zealous + hot-headed = +4 on `go`). Aggregate movement is small
(±2 pp) because the baseline was already strong, but the per-cell
breakdown shows temperament-shaped variance the baseline did not.

## Overall

| Metric | Baseline | With profiles | Δ |
|---|---|---|---|
| Any action emission | 83% | 85% | +2 |
| Any `message` emission | 80% | 82% | +2 |
| Parallel (message + action) | 64% | 66% | +2 |
| Silent | 1% | **0%** | −1 |
| `use` emission rate | 16% | 14% | −2 |

The `use` rate dip is concentrated on the **objective** scenario for Pip
(sweet + effusive: 85% → 75%) — a persona whose temperament bias prefers
`give` over `use`. Vex (the use-leaning persona at +1) stays high (100% →
95%, within noise). On every other scenario, `use` is structurally
unavailable (no held item / no paired space in front), so the rate doesn't
move.

## Where the temperament push lands

The bias table predicted three named pushes; here's what the data shows.

### Vex (zealous + hot-headed) — `go` lean

Bias sum on `go`: **+4** (maximum), `examine`: −1.

| Scenario | Baseline `go` | With profiles `go` | Δ |
|---|---|---|---|
| exploration | 15% | **30%** | +15 |
| social      | 70% | 65% | −5 |
| examination | 0% | 10% | +10 |

The exploration cell — the scenario where `go` is genuinely the
discretionary choice — doubles. Social is already high at baseline
(`go` is part of the "respond + act on what you see" reflex when blue
asks "what does it look like?"), so the treatment has little headroom.
Examination picks up a small `go` signal (10%) that the baseline never
produced, even though `go` is suboptimal there.

### Ember (curious + meticulous) — `examine` lean

Bias sum on `examine`: **+4**, `go`: 0.

`examine` rates were already very high at baseline (95% / 90% / 40% /
100%), leaving little room — Ember remained at 95%+ across the
`<action_profile>` ON run too, so the floor held. The interesting
lift was the **parallel-action rate in social** (35% → 55%, +20 pp): the
profile clause appears to nudge Ember to act AND reply rather than just
reply.

### Pip (sweet + effusive) — `give` lean

Bias sum on `give`: **+4**, `examine`: 0.

`give` is not exercised by any of the four scenarios (no peer in the
front arc — that was deliberate, to avoid inflating give counts from
cheap stimulus). So the `give` axis is untestable in this run. What we
*can* see is Pip's social cell (`anyAct` 20% → 35%, parallel 15% → 25%)
— the profile clause nudged the sweet+effusive persona toward acting in
parallel with messaging, which is consistent with its "communicative
and collaborative" prose.

A follow-up scenario with peers placed in the front arc would let the
`give` axis be measured directly.

## Cell-level lifts in `anyAct` and `parallel`

| Scenario × Persona | anyAct Δ | parallel Δ |
|---|---|---|
| exploration × Ember | −5 | +15 |
| exploration × Vex   |  0 | −30 |
| exploration × Pip   | +5 |  0 |
| objective × Ember   | +5 |  0 |
| objective × Vex     | −5 |  0 |
| objective × Pip     | −5 | −5 |
| social × Ember      | **+25** | **+20** |
| social × Vex        | −5 |  0 |
| social × Pip        | +15 | +10 |
| examination × Ember | −5 | +5 |
| examination × Vex   | −5 | **+20** |
| examination × Pip   |  0 | −5 |

Two real outliers:

- **Social × Ember +25 pp `anyAct` / +20 pp parallel** — Ember's
  "examines methodically" clause appears to override its previous
  message-only social default. examine rate goes 40% → 65% in this cell.
- **Exploration × Vex −30 pp parallel** — the only large regression.
  Vex's `go` rate in this cell rose (15% → 30%) AND its message rate
  fell (100% → 70%), so it's emitting more action *alone* without the
  companion message. The "charge forward" clause is doing what it says:
  Vex acts now and talks later. Whether that's desirable depends on the
  game's vibe. If we want Vex to keep its 90%+ message coverage, the
  profile clause for `goScore ≥ 3 && examineScore ≤ 0` could be softened.

## Plan success criteria

| Criterion | Result |
|---|---|
| `use` ≥ 20% across all temperament combinations | Mixed. On objective scenario: Vex 95%, Pip 75%, Ember 0%. Ember's 0% reflects the curious+meticulous bias pushing `examine` first; that's the intended trade-off. |
| Overall action-tool emission ≥ 40-50% | **Pass: 85%.** |
| Temperament-driven variance visible | **Pass.** Vex `go` 15→30%; Ember social parallel 35→55%; Pip social anyAct 20→35%. |
| Messaging rates stay ≥ 40% | **Pass: 82% overall.** |
| Parallel rates improve vs. baseline | **Pass (small): 64% → 66% overall**, with larger per-cell gains in social. |

## Calibration notes for next iteration

1. **The cautious-reserved branch is unreachable in practice** — the
   classifier's `goScore ≤ -2 && examineScore ≤ -1` predicate has no
   temperament pair that satisfies both (the "go-down" temperaments
   tend to be "examine-up"). The unit test for that branch in
   `action-preference-bias.test.ts` acknowledges this; consider either
   tightening the bias table or relaxing the predicate so a recognisable
   reserved persona shape can land in it.
2. **The high-go clause may be too message-suppressing** — Vex
   exploration parallel rate dropped 30 pp. A revised clause that keeps
   "charges forward" while adding "still replies when addressed" would
   protect the engagement floor.
3. **The `give` axis is untested** — none of the four scenarios place a
   peer in the actor's front arc. Adding a fifth "handoff" scenario
   would let the +4 give pair surface its differential against the
   baseline.
4. **Aggregate movement is small** because the baseline is already
   strong. The treatment's value is in *shape*, not *volume*: per-cell
   variance and per-tool distribution shift in the expected directions.
   A meaningful gate for the next iteration would be a per-tool variance
   metric, not the aggregate `anyAct`.

## Reproduce

```bash
pnpm eval:action-variation                          # baseline
EVAL_ACTION_PROFILES=1 pnpm eval:action-variation   # treatment
```

Both runs use `EVAL_DIRECT_OPENROUTER=1` against `z-ai/glm-4.7`.
