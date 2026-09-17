# Direction-eval retarget audit (#541)

Evidence for the acceptance bullet: *"Audit active source/tests/eval paths for
retired assumptions. Distinguish intentionally historical schemas/fixtures/docs
from live dependencies; do not delete history indiscriminately."*

Audit performed on branch `wayfinder/541-vista-verification`, cut from
`origin/main` at `e28e5f9`. Final head: see the PR.

## What changed

| Commit | Scope |
|---|---|
| `a75af01` | `evals/relative-directions/scoring.ts` + its unit test — scoring inverted from punishing cardinals to expecting them |
| `1ee5f0c` | `evals/relative-directions/runner.mts` — retargeted off `SCENARIO_ORIENTATION` and relative-only prompts |
| `cd60bc0` | `evals/daemon-action-variation/scenarios.ts`, `evals/free-text-drift/runner.mts` — stale cone scene prose |
| `d85c08d` | `evals/free-text-drift/scoring.ts`, `evals/daemon-action-variation/SKILL.md`, `evals/free-text-drift/runner.mts`, `src/spa/game/__tests__/drift-scoring.test.ts` — retired verbs and the relative-direction axis |

## Live dependencies that were found and fixed

Three were *behavioural*, not cosmetic — each made an eval measure nothing or
measure the wrong thing:

1. **`evals/relative-directions/scoring.ts`** treated `north/south/east/west` as
   "cardinal leaks" to be punished, and parsed `forward/back/left/right` as
   movement statements. Under ADR 0015 this is exactly inverted: cardinals are
   the approved vocabulary. The eval's pass rule failed a Daemon for speaking
   the model it was supposed to speak.
2. **`evals/free-text-drift/scoring.ts`** validated a tool call's `direction`
   argument against an eval-local `forward|back|left|right` set. The only
   shipped tool carrying `direction` is `go`, which emits cardinals — so
   `CARDINAL_DIR_SET.has(dir)` was always false, `ToolCallDetail.direction` was
   never populated, and the `directionCounts` series reported four dead
   zero-filled buckets. A second hard-coded relative list seeded
   `allDirections`, which would have kept emitting those dead series even after
   the first was fixed.
3. **`evals/free-text-drift/runner.mts`** injected inbound chat naming relative
   directions ("step forward", "head back", "the panel on your right") — spatial
   instructions no Daemon has had the vocabulary to act on since ADR 0015.

Also fixed: `SCENARIO_ORIENTATION = "north"`, an orientation the runtime no
longer stores, used to convert a cardinal `go` into a relative direction; and
`evals/daemon-action-variation/SKILL.md`'s "directly in front" scene prose.

## Deliberately preserved as historical

Deleting these would have destroyed provenance the ticket requires keeping:

- `evals/daemon-action-variation/runner.mts:461` — "`give` removed by
  #466–#472, `face` retired with facing itself" (tool-surface provenance).
- `evals/daemon-action-variation/scoring.ts:49` — "`face` drifted this way
  once", the rationale for exhaustively-typed bucket keys.
- `evals/daemon-action-variation/SKILL.md:21` — ADR 0015 retired `face`, since a
  Daemon has a position but no orientation.
- `evals/relative-directions/runner.mts:8-10` — states the directory and script
  name are retained "for history only".
- `e2e/dev-inspector.spec.ts:302,305` — negative assertions requiring the
  inspector marker carry *no* direction/facing/compass attribute. These enforce
  the retired model's absence and are correct as written.
- `e2e/persistence-reload.spec.ts:469-470` — negative assertions that saved
  bytes contain neither `facing` nor `landmark`.
- `src/spa/persistence/session-codec.ts:96`, `src/save-serializer.ts:16,51` —
  migration notes recording what v12/v5 retired.

## Non-defects

- `"horizon"` inside `"horizontal"` (e.g. `dev-inspector.spec.ts` viewport
  tests) is a substring coincidence, not the retired horizon line.
- `"silence-in-the-face-of-input"` (`evals/free-text-drift/runner.mts:222`) is
  an English idiom.
- `"turn"` inside `turns`/`TurnRecord`, `"face"` inside `surface`/`interface`.

## Verification

| Command | Result |
|---|---|
| `pnpm run lint` | PASS — 220 files, no fixes |
| `pnpm run typecheck` | PASS — 3 projects |
| `pnpm run test` | PASS — 81 files, 1830 tests |
| `pnpm run build` | PASS |
| `pnpm run smoke` | See PR — the suite is flaky on `main` independent of this change |

Baseline before this work, on a clean `origin/main`: lint PASS (220 files),
typecheck PASS, test PASS (81 files / 1821 tests). The +9 net tests are the
retargeted coverage.

### Known flake, pre-existing

`pnpm run smoke` is unstable on the current `main` independent of this branch.
Two consecutive runs on a clean checkout at `e28e5f9` with no code change gave
**4 failed / 58 passed** and then **62 passed / 0 failed**. All four failures
were `e2e/sessions-picker.spec.ts` timing out waiting for `#begin` to become
enabled — the dial-up/synthesis race the tip commit (`test(e2e): stop
start-screen specs racing the dial-up animation (#556)`) was already addressing.
That spec passes **12/12 in isolation**. Recorded here rather than hidden behind
a retry.

## Not proven

- **No live-model eval was executed.** All three harnesses fetch a real model;
  no approved access was available in this environment. What is proven is that
  the harnesses load, pass argument parsing, run their control flow, and render
  their reports — each now reaches its model call and fails only on connection.
  Actual scoring behaviour against a live model is unverified.
- `evals/` is matched by **no tsconfig**, so `pnpm typecheck` does not check any
  eval file. Filed as #557; this branch did not fix it. Eval edits were verified
  by executing the modules directly instead.
