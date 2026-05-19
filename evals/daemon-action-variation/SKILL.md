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

Four scenarios target different parts of the action surface:

1. **exploration** — empty-handed in a room of unknown items. Tests examine
   vs go balance and the temperament-driven shape.
2. **objective** — holding the objective item with the paired space directly
   in front. Tests `use` emission (critical-path tool).
3. **social** — peer just messaged the daemon while items are also visible.
   Tests message+action parallel turns.
4. **examination** — interesting object one cell ahead, unexamined. Tests
   curiosity-driven examine emission.

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

The harness writes one report per mode under `docs/evals/`:

- `daemon-action-variation-baseline-<date>.md` / `.json`
- `daemon-action-variation-with-profiles-<date>.md` / `.json`

Compare the two files to read the lift from the action-profile clauses.

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

Three personas spanning the bias axes — examine-leaning, go-leaning, give-leaning:

| Persona | Temperaments | Lean |
|---|---|---|
| Ember | curious + meticulous | examine |
| Vex   | zealous + hot-headed | go |
| Pip   | sweet + effusive     | give |

Override via `EVAL_ACTION_PAIRS` to walk a wider grid (e.g. all 24
temperament combinations) once the default trio shows the expected
treatment lift.

## Success criteria

From the issue plan:

- `use` frequency ≥20% across all temperament combinations (baseline floor
  on `use` enforced by `toolBiasSum`).
- Overall action-tool emission ≥40–50% of turns.
- Temperament-driven variance visible (curious → higher examine; zealous →
  higher go; sweet → higher give).
- Messaging rates stay ≥40% of turns — no regression on the engagement axis.
- Parallel message+action rate improves vs. baseline.

The per-cell summary table in the markdown report makes all of the above
readable at a glance.
