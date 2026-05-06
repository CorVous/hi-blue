# Ralph QA Checklist — Rounds 1–3 merged into `claude/review-issues-ralph-loop-dt49w`

> Items with an automated equivalent live in `e2e/`; run `pnpm test:e2e`.

Final integration smoke: ✅ passed — `pnpm lint` clean, `pnpm typecheck` clean, 269/269 tests pass on the merged tip.

> Issues #29, #30, #31, #32 below are still **open**. After you merge the round PR into the long-lived branch, run the close-out agent (`close.md`) to close them with commit references.

## What landed

| Issue | Title | Merge commit |
|---|---|---|
| #29 | Smoke worker `/game` endpoint with full SSE event encoder | `7ff7b9a` |
| #30 | Endgame fragment renderer + dev `/endgame` route | `d74012f` |
| #31 | `phase_advanced` and `game_ended` SSE events | `82c013d` |
| #32 | Chat-page endgame overlay revealed on `game_ended` | `91c4def` |

After this round, the smoke worker drives `runRound` end-to-end over SSE, and a player who reaches phase-3 completion sees the endgame screen take over without a navigation. Both QA flows from PRD #28 are now reachable: the live game flow (play through phase 3 → overlay reveals) and the dev shortcut (`GET /endgame` with stub data).

## Human QA

The items below require eyes-on-screen judgement. Run the smoke worker locally (`pnpm wrangler dev` or equivalent) and exercise each.

### Live game flow — the full path

- [x] Open the smoke worker root and confirm three AI panels render and update independently as a round plays out (panels do not block each other serially) — issue #29, commit `7ff7b9a`.
- [x] Send a message to a specific AI and confirm the addressed AI's panel responds; the other two AIs do not receive the player message in their visible histories — issue #29, commit `7ff7b9a`.
- [x] Watch token streaming and confirm the word-by-word pacing reads as "the AI is talking" rather than dumping or jittering — issue #29, commit `7ff7b9a`.
- [x] Cross a phase boundary in a real session and confirm the action-log entry / status marker for `phase_advanced` is legible (the marker is intentionally minimal — overlay-style phase transitions are a future concern) — issue #31, commit `82c013d`.
- [x] Complete phase 3's win condition in a real session and confirm the chat container hides and the endgame overlay takes over **without** a URL change or page reload — issue #32, commit `91c4def`. Automated: `e2e/endgame-current-behaviour.spec.ts` asserts `#send`/`#prompt` disabled, `localStorage` cleared, and URL stable on `game_ended` (issue #80). Overlay-visibility coverage deferred until `#endgame-screen` element ships into the SPA.
- [x] After the overlay reveals, confirm the page feels like an ending rather than a paused game (the "moment of completion" feel) — issue #32, commit `91c4def`.
- [x] Reload the page after the overlay has revealed and confirm the experience is acceptable (current behaviour: session resumes; if the round produces no further `game_ended` event the chat is visible again — flag this as a follow-up if it feels wrong) — issue #32, commit `91c4def`.

### Dev `/endgame` route — layout sanity

- [x] Hit `GET /endgame` directly and confirm the endgame screen layout, copy, and button placement read correctly without any game state — issue #30, commit `d74012f`.
- [x] Confirm the standalone route's stub persona data does not look like real production content (it should be obviously placeholder — this route is a developer affordance) — issue #30, commit `d74012f`.

### Cross-cutting

- [ ] Trigger a chat lockout mid-session and confirm the disabled selector state and in-character lockout message are legible; confirm the locked AI still receives whispers and takes turns — issue #29, commit `7ff7b9a`. **To arm lockout in local dev:** open `http://localhost:8787/?lockout=1` — the SPA reads this param on boot and calls `armChatLockout` (red, 2 rounds) for the next round. (Previously this was handled by the smoke worker's `GET /` handler, which is unreachable when wrangler v4 assets serve `dist/index.html` directly — see issue #91.)
- [ ] Kill the worker mid-round (network plug substitute) and confirm the UI degrades gracefully rather than wedging — issue #29, commit `7ff7b9a`.
- [x] Hit the daily-cap rate guard while the new `/game/turn` endpoint is in flight and confirm the `[CAP_HIT]` short-circuit produces the same UX as the existing `/chat` route — issue #29, commit `7ff7b9a`.

## Code review (optional)

- [ ] Sanity-check the `ENABLE_TEST_MODES` gating around `testMode: "win_immediately"` in `POST /game/new`. The reviewer found this was unconditionally active in the first cut; confirm the binding is only set in `vitest.config.ts` (miniflare) and not in `wrangler.jsonc` — issue #31, commit `82c013d`. **SPA affordance:** `?winImmediately=1` on `http://localhost:8787/?winImmediately=1` now injects `winCondition: () => true` into the active session's phase config at SPA boot (gated to local dev only via `__WORKER_BASE_URL__` check). The smoke worker's old `GET /` handler for this param has been removed (issue #91).
- [ ] Look at `renderEndgameSection({ inlineScript: false })` in `renderChatPage` and decide whether the overlay's hoisted button handlers in the chat-page IIFE are the right long-term seam, or whether the endgame fragment should own its own behaviour via a separate dispatcher module — issue #32, commit `91c4def`.

## Notes on what was deferred

The following open issues exist but were **not** picked up in this run because they overlap heavily with the just-landed UI surface and would benefit from human direction on scope/priority:

- **#21** "Nix action log" — directly conflicts with the `action_log` SSE events in #29.
- **#22** "GUI should be one page" — restructures the same page #32 just rewrote.
- **#23** "Mobile support" — re-themes the chat page's CSS that #29/#32 just modified.
- **#20** "AI delay on turn-taking" — touches `runRound` pacing, which the encoder also handles.
- **#26** "Server should be OpenAI-compatible API" — large architectural change to the proxy.
- **#18** Phase content authoring (HITL) — explicitly labelled `ready-for-human`.
- **#25, #28** are PRDs (parent specs), not implementation tickets.

Pick one of these as the next AFK run after deciding which UI direction wins.
