# Phase-Goal Pool

There is no "Phase Goal pool" in this project, and we will not be authoring or curating one.

## Why this is out of scope

The game used to be structured around phases, with each daemon delivered a per-phase directive (the "Phase Goal") drawn from `src/content/goal-pool.ts`. That whole layer was retired during the move to a single continuous game:

- #313 — Single-game loop: retire phase management, per-game budget, farewell line, win/lose conditions
- #344 — First restructure (merged): game mechanics, complications, objective pool
- #347 — Restructure playtest rules and game model from phases to single continuous game
- #355 / #357 — Cleanup: retire deprecated phase-concept shims

`src/content/goal-pool.ts` no longer exists. The directive role it played has been split: per-game guidance now flows through `sysadmin-directive-pool.ts`, and per-daemon character flows through `persona-goal-pool.ts` and `temperament-pool.ts`. Re-introducing a phase-scoped goal pool would conflict with the single-continuous-game model and would mean re-litigating the restructure decisions above.

The other pools listed in the original ask (temperament, persona-goal, typing-quirk) have been curated organically in the time since — see `src/content/temperament-pool.ts`, `persona-goal-pool.ts`, `typing-quirk-pool.ts` and their tests in `src/__tests__/content.test.ts`. No standing work remains there.

## Prior requests

- #178 — Author/curate content pools (temperament, phase-goal, persona-goal, typing-quirk)
