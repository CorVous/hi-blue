# Daemon Action Variation Eval

Real-LLM harness for measuring action-tool emission distributions per persona
variant per scenario.

Counterpart to `evals/free-text-drift/`: where that runner walks one daemon
across 30 rounds to find drift, this one freezes a single first turn and
replays it N times to get a probability distribution over the tool surface.

## What it tests

The action-profile feature attaches per-temperament action-tool preference
clauses (`<action_profile>` block in the system prompt) derived from
`src/content/action-preference-bias.ts`. The eval measures whether those
clauses actually push the model toward varied action emission — beyond
`message`-only turns.

The tool surface is the merged daemon action set after #466–#472: `go`,
`face`, `pick_up`, `put_down`, `use` (+ `message`). `examine` was removed
(descriptions auto-emit), `look` was renamed to `face`, `give` was removed.

Three scenarios target different parts of the action surface:

1. **exploration** — empty-handed in a room of unknown items. Tests face
   vs go balance and the temperament-driven shape.
2. **objective** — holding the objective item with the paired space directly
   in front. Tests `use` emission (critical-path tool).
3. **social** — peer just messaged the daemon while items are also visible.
   Tests message+action parallel turns.

An earlier `examination` scenario was dropped after the tool-surface
change made it redundant — with `examine` removed and descriptions
auto-shown, "daemon next to interesting item" stopped exercising any
behaviour the other three didn't already cover.

Each scenario is repeated against the *same* frozen initial state per
variant, so the per-cell distribution reflects model choice probability,
not drift across rounds.

## Running it

```bash
# Baseline (actionProfiles OFF — measures current behaviour)
pnpm eval:action-variation

# Treatment (actionProfiles ON — measures with the new clauses)
EVAL_ACTION_PROFILES=1 pnpm eval:action-variation
```

The harness writes one report per mode under
`docs/evals/daemon-action-variation/`:

- `baseline-<date>.md` / `.json`
- `with-profiles-<date>.md` / `.json`

Compare the two modes to read the lift from the action-profile clauses.

## Environment

- `OPENROUTER_API_KEY` (when `EVAL_DIRECT_OPENROUTER=1`) **or** a running
  proxy worker (`pnpm dev`) reachable at `EVAL_BASE_URL` (default
  `http://localhost:8787`).
- `EVAL_MODEL` (default `z-ai/glm-4.7`).
- `EVAL_REPETITIONS` (default `20`).
- `EVAL_ACTION_PROFILES` (`1` = on, anything else = off).
- `EVAL_ACTION_PAIRS` — comma-separated `t1+t2` list overriding the default
  three-variant set. Example: `EVAL_ACTION_PAIRS=curious+meticulous,zealous+hot-headed,sweet+effusive`.

## Default variants

Three personas spanning the bias axes — face-leaning, go-leaning,
pick_up-leaning (on the merged 5-tool surface):

| Persona | Temperaments | Lean |
|---|---|---|
| Ember | curious + meticulous | face, use |
| Vex   | zealous + hot-headed | go, pick_up |
| Pip   | sweet + effusive     | face, pick_up |

Override via `EVAL_ACTION_PAIRS` to walk a wider grid (e.g. all 24
temperament combinations) once the default trio shows the expected
treatment lift.

## Success criteria

- `use` frequency ≥20% across temperament combinations (baseline floor
  on `use` enforced by `toolBiasSum`).
- Overall action-tool emission lifts meaningfully vs. baseline.
- Temperament-driven variance visible (curious/meticulous → higher face;
  zealous/hot-headed → higher go).
- Messaging rates stay healthy — no regression on the engagement axis.
- Parallel message+action rate improves vs. baseline.

The per-cell summary table in the markdown report makes all of the above
readable at a glance.
