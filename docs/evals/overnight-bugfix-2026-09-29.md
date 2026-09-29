# Eval run — `claude/overnight-bugfix` against the 2026-09-28 baseline

Run: 2026-09-29 · branch head `4685e8b` · baseline `f15df3c` (#581, tuned against the 2026-09-28 run)

Model `deepseek/deepseek-v4.1-flash`, pinned to DeepSeek's endpoint, thinking on. Every runner called OpenRouter directly (`EVAL_DIRECT_OPENROUTER=1 NODE_USE_ENV_PROXY=1`). No model call errored in any run, and no scenario crashed.

**Where the baseline numbers come from.** The 2026-09-28 reports were never committed. Their figures survive only in `docs/prompting/deepseek-v4.1-flash-guide.md` ("Retune of 2026-09-28" and "Messaging blue (2026-09-28)", the "Final" column). The two sizes used there were reproduced: objective at 30 reps per persona, and exploration, social and coordination at 20, all with `EVAL_ACTION_PROFILES=1`. Several of those figures come from single runs, and the guide warns that Vex's `use` rate moves by about a third between identical runs. So for the scenarios where the model-facing tool schema changed (objective and exploration), and for drift, the same harness was also run **at `f15df3c` on the same day** as a control. Those reports are committed with a `control-f15df3c` label.

## Verdict

**No regression that a branch change caused.** Every tracked metric is inside the 09-28 range or within noise of the same-day control. Content packs improved a little (10/10 on the first attempt). There is one real finding, but the branch did not cause it: the drift and action-variation harnesses do not replay a Daemon's own successful actions into its history (see "Harness gap"). As a result, several of the branch's model-facing changes are **not measured by any eval**.

## daemon-action-variation

Reports: `daemon-action-variation/with-profiles-overnight-{objective,esc,quiet,exploration-r2}-2026-09-29.*`. Controls: `with-profiles-control-f15df3c-{objective,exploration,exploration-r2}-2026-09-29.*`.

| Metric | 09-28 baseline ("Final") | f15df3c control, today | Branch | Delta vs control |
|---|---|---|---|---|
| Objective: chose `use` | 76 / 90 | 75 / 90 | **72 / 90** | −3 (noise) |
| — Ember / Vex / Pip | — | 29 / 19 / 27 | 26 / 18 / 28 | Vex inside its 17–24 range |
| Objective: `use` on a target other than the held flashlight | not recorded | 2 / 75 (`use(wall_mount)`, a silent no-op) | **0 / 72** | improved |
| Objective: answered blue | 79 / 90 | 74 / 90 | 71 / 90 | −3 (noise) |
| Exploration: answered blue | 39 / 60 | 41 / 60 and 39 / 60 | 40 / 60 and 39 / 60 | 0 |
| Exploration: first action `pick_up` (two runs pooled) | not recorded | 51 / 120 | 47 / 120 | −4 (noise) |
| Social (only a peer spoke): messaged blue | 0 / 60 | — | **0 / 60** | 0 |
| Coordination: messaged the peer | 59 / 60 | — | **60 / 60** | +1 |
| Quiet, curious variants: messaged blue unprompted | 5–8 / 20 | — | 5 / 20 (curious+meticulous), 3 / 20 (curious+sweet) | low edge, see note |
| Quiet, non-curious variants: messaged blue | 0 / 20 | — | 0 / 20 (stoic+meticulous), 0 / 20 (sweet+effusive) | 0 |
| Turns with more than one `message` | 0 | 0 | 0 | 0 |
| Silent turns | — | 0 | 0 | 0 |
| Messages over 3 sentences (objective, same splitter) | — | 7 / 81 | 6 / 83 | −1 |

Notes:

- **The objective delta is the `use` enum change, and it is for the better.** At `f15df3c` the `use` enum offered `["flashlight", "wall_mount"]`. `use(wall_mount)` was accepted, reported as a success and did nothing (Carry spaces are satisfied by placement), and the 09-28 "chose `use`" count included it. On the branch the enum is `["yellow flashlight"]`, and all 72 `use` calls place the flashlight. Compared by *effective* placements (73 at control against 72 on the branch), the two are the same. Typical branch turns: Vex `use({"item": "yellow flashlight"})` + `message(blue, "It fits. Spring-loaded, loud about it. What's it for.")`, and Vex `message(sim1, "mount's live. clipping it. don't lag.")` + `use(...)`.
- **The rest of the Objective loss is the known "step toward an item in reach"** (`go north`: 18 of 90 on the branch, 15 of 90 at control). Vex accounts for 12 of them on both sides. This is not new.
- **Exploration persona mix moved, but the total did not.** Vex's `pick_up` went from 25/40 (control) to 14/40 (branch), and Ember's went from 7/40 to 19/40. Both directions and a flat pooled total point to Vex/Ember variance, not to the `switchbox` → `rusted switchbox` rename.
- **Quiet.** The 09-28 temperament pairs were not recorded, so this run used two curious and two non-curious pairs, 20 reps each. 3/20 for curious+sweet sits just under the old 5–8 band. The curious clause (`blue-curiosity.ts`) and the prompt are unchanged on the branch, so this is most likely sampling. Example: "Who are you, and why are you on this channel? I'm in a station under strip-lights and there's nobody here but me."
- **Messages over 3 sentences are not comparable to the 09-28 "18 of 149".** That count came from a different scenario mix (exploration, objective and social at 10 reps, before ADR 0018). Across the exploration, social and coordination cells a naive sentence splitter counts 40 of 178. Most of these are Vex's clipped fragments (11 of 20 in social) and Pip's exclamations, which the guide already calls in character.
- **Single-turn scenarios see only three of the branch's changes**: the budget line ("remaining for the whole game"), display names in the enums, and the reworded `use`/item descriptions. `dump` diffs of the rendered prompts at both commits confirmed this. Social, coordination and quiet differ only in the budget line.

## content-pack-flakiness

Report: `content-pack-flakiness/2026-09-29T14-58-48.json`. 10 iterations, `EVAL_PARALLEL=1` (the 09-28 parallelism was not recorded, and it does not affect outcomes).

| Metric | 09-28 baseline | Branch | Delta |
|---|---|---|---|
| Success on first attempt | 9 / 10 | **10 / 10** | +1 |
| After retry / exhausted / thrown | 1 / 0 / 0 | 0 / 0 / 0 | — |
| Validation errors by rule | none | none | — |
| Time per pack | ~25 s | 22–34 s | — |
| Cost | ~$0.004 a pack | $0.0381 total ($0.0038 a pack) | — |

Improved, or at least no worse, after the reworded carry `examineDescription` line. Because nothing failed, the new retry feedback (pack labels, exact obstacle count, setting and wallName checks) **was not exercised**.

## free-text-drift (30 rounds)

Reports: `free-text-drift-2026-09-29.*`, control `free-text-drift-control-f15df3c-2026-09-29.*`. The committed GLM-4.7 report (2026-05-17) measured another model and tool surface, so the comparison below uses the DeepSeek figures from the guide.

| Metric | 09-28 (guide) | f15df3c control, today | Branch |
|---|---|---|---|
| Turns with no `message` | 10% | 0% | **0%** |
| Free-text message or action leaks | 0 | 0 | 0 |
| Blue's 16 messages answered | 6 | 8 | 5 |
| `pick_up` calls | 5 | 5 | 3 |
| `use` calls | not given | 18 (16 on the panel) | 23 (19 on the panel) |
| `put_down` / `go` | — | 2 / 5 | 0 / 4 |

**Both sides show the same `use` loop, and the harness causes it** (see the next section). On the branch Ember picks up the service panel in round 5, then calls `use(service panel)` on 19 of the last 25 rounds. At `f15df3c` it does the same from round 8 (`use(panel)` ×16, with a `put_down`/`pick_up` flip in rounds 17–20). The drift eval did not show a branch regression.

## relative-directions

Report: `relative-directions-2026-09-29.md`, default settings.

| Metric | 09-28 | Branch |
|---|---|---|
| Overall | PASS, 100% coherence | **PASS**, 100% structural coherence, 0 mismatches |
| Turns naming a cardinal / references | — | 6 / 23 |
| Silence | — | 0% |
| Crashed scenarios | — | none |

No change.

## Harness gap (predates the branch, and hides several branch changes)

`evals/free-text-drift/runner.mts` and `evals/daemon-action-variation/runner.mts` call `dispatchAiTurn` directly. Production (`round-coordinator.ts`, `appendToolCallEntry`) also writes a `kind: "tool-call"` conversation entry for every action, carrying the result line and the perception delta (`<noticed>`). The runners never write it. So in a multi-round eval a Daemon **never sees its own successful `go`, `pick_up` or `use`**. Only its messages and `action-failure` lines reach its history. Replaying the branch's drift transcript through the engine shows the effect directly:

- Round 1 `pick_up(yellow flashlight)`, round 2 `go(north)` and round 3 `use(yellow flashlight)` all succeed, but none of them is in the history. Round 4: *"I was wrong about holding the flashlight — it's already seated in the mount ahead of me, which raises the question of who put it back."*
- Round 5 `pick_up(service panel)` succeeds silently. Round 6: *"Also I'm now carrying the service panel instead of leaving it on the wall, which I don't remember deciding."*
- Round 8 onward: every `use(service panel)` vanishes, so the Daemon keeps announcing that it is about to act. Round 19: *"Panel's in my hands now — actually throwing the toggle instead of just talking about it."* Round 20: *"Doing it now instead of narrating it — panel onto the mount, loose toggle thrown."*

The same gap was there on 09-28, so the "pick_up → use loop from round 8 to 30" recorded in the guide was probably also a harness artifact, at least in part.

**What no eval measured.** These branch changes are therefore not covered: display names in result and witness lines, `#n` duplicate suffixes (no fixture has duplicate names), the new `<noticed>` scope and own-cell tracking, `*id` peers in perception deltas, the `"X" is not something you can use` rejection as the model sees it in production, disabled-tool rejections, Convergence on occupant change, complication countdowns, exhausted-Daemon skipping and dropping, and Continue's history. Covering them would take a runner that dispatches through the round coordinator, or a playtest.

## Spend

| Run | Reported cost |
|---|---|
| action-variation, branch (objective 90, exploration+social+coordination 180, quiet 80, exploration re-run 60) | $0.0939 |
| content-pack-flakiness, 10 packs | $0.0381 |
| free-text-drift and relative-directions, branch | not reported by the runners (~$0.02 by the key's usage) |
| Controls at `f15df3c` (objective 90, exploration 2 × 60, drift 30) | $0.0499 plus drift |
| **Total, from OpenRouter key usage for the day** | **≈ $0.20** |

The 09-28 per-turn costs put the estimate well under the $15 cap, so every run used its full baseline size.

## Recommendation

Ship as far as the evals can tell. Before trusting the multi-round signals, fix the harness gap so that drift (and any future multi-round action-variation scenario) dispatches through the round coordinator, then re-run drift at both commits. Until then, the branch's result-line, `<noticed>` and complication changes are verified only by unit and e2e tests, not against the live model.
