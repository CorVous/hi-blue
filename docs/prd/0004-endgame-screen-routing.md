## Problem Statement

A QA tester wanting to evaluate the endgame screen has no way to reach it. `renderEndgamePage` ships in the renderer module (added by issue #19) and is unit-tested in isolation, but the smoke worker has no `/endgame` route, the chat page never navigates away on game completion, and there is no in-game path that takes a player from "phase 3 win condition fires" to "endgame screen visible." The QA checklist items for endgame reachability, layout sanity, and the endgame's feel ("does this read as the end of a game?") all sit behind a wall of integration code that does not yet exist. Even a maintainer wanting to eyeball recent endgame markup changes has to hand-write a temporary route and not commit it — which is the hint that the missing path is real.

## Solution

Two ways to reach the endgame screen, both small.

The real flow: when a player completes phase 3, the chat page reveals an inline endgame overlay. The overlay is markup already present in the chat page (initially hidden), revealed by client-side glue that listens for the `game_ended` SSE event emitted by the coordinator wiring (PRD 0003). No URL change, no navigation, no state transfer — the in-memory game state stays in the same JavaScript context, and the renderer simply swaps which container is visible.

The QA flow: a `/endgame` route on the smoke worker serves the standalone `renderEndgamePage()` HTML with stub persona data, so a tester (or a reviewer eyeballing markup) can hit the screen directly without playing through three phases. This is intentionally a developer affordance, not a player-facing route.

Both flows reuse the same body markup. The endgame body is extracted into a fragment-renderer that the full-page renderer wraps in a doc shell and the chat-page overlay embeds inline. One source of truth for endgame markup; two consumers.

## User Stories

### QA tester

1. As a QA tester, I want to play through phase 3 and reach the endgame screen, so that I can verify the win-condition path actually surfaces the endgame UI.
2. As a QA tester, I want the endgame screen to appear automatically when phase 3 completes, so that I do not have to perform any manual navigation to verify the transition.
3. As a QA tester, I want the chat page's transition to the endgame screen to be visually clear, so that I can sniff-test the moment-of-completion feel.
4. As a QA tester, I want a direct route to the endgame screen with stub data, so that I can inspect the screen's layout and copy without playing through a full game.
5. As a QA tester, I want the standalone endgame route to clearly identify itself as a developer affordance, so that I do not mistake it for a player-facing URL.
6. As a QA tester, I want the endgame screen to remain reachable on page reload after the game has ended within a session, so that I can re-inspect it without restarting the game.

### Player (future)

7. As a player, I want to see an endgame screen when I finish the game, so that the experience has a clear ending and is not just "the chat input goes quiet."
8. As a player, I want the endgame screen to feel like a distinct moment, so that I understand the game is over rather than just paused.
9. As a player, I want the endgame screen to remain accessible until I close the tab, so that I can read it without rushing.

### Maintainer

10. As a maintainer, I want one source of truth for endgame markup, so that updates to the endgame layout do not have to be made in two places.
11. As a maintainer, I want the standalone endgame route gated behind dev-only stub data, so that production traffic cannot stumble into a fake endgame screen.
12. As a maintainer, I want the existing `renderEndgamePage` tests to remain authoritative without modification, so that the refactor does not invalidate the unit-test coverage already in place.

### Developer

13. As a developer, I want the endgame fragment to be a pure function of its inputs, so that it is trivially testable and reusable across the full-page and overlay renderings.
14. As a developer, I want the chat page's overlay reveal to depend only on a known SSE event type, so that the contract with the coordinator is explicit.
15. As a developer, I want the SSE event that triggers the overlay to be the same `game_ended` event PRD 0003 emits, so that the integration seam is single-purpose and the event taxonomy stays coherent.

## Implementation Decisions

### Module shape

- **Endgame fragment renderer (deep, pure).** A new function returns the endgame body markup as a string, with no doctype, no `<html>`, no `<head>`, no `<body>` wrapper. Pure function of its inputs (initially: nothing — the body is presently a static template; persona data wiring is owned by the save-payload populator PRD).
- **Full-page renderer (refactored).** The existing `renderEndgamePage` is rewritten to wrap the fragment in the existing doc shell (styles, meta tags, etc.). Public signature and externally-visible HTML output unchanged.
- **Chat-page overlay (modification to chat-page renderer).** The chat-page output gains an initially-hidden container that contains the endgame fragment. CSS hides it by default; client-side JS reveals it on the `game_ended` event.
- **Client-side overlay glue (modification to the chat page's SSE handler).** When the parser sees a `game_ended` event, it sets a flag and toggles the overlay container's visibility. The chat container is hidden in the same step. No window/location changes.
- **Standalone `/endgame` route (dev affordance).** A new route in the smoke worker serves the full-page renderer with stub persona data. Returns 404 when an environment flag is set indicating production. (For local Wrangler dev, it always serves; for any future production deploy, the flag gates it off.)

### Wire-format dependency

- This PRD depends on PRD 0003 emitting a `game_ended` SSE event when the coordinator's win condition fires on phase 3. The event payload shape is decided in 0003; this PRD only consumes the event's existence.
- The chat-page parser already has a switch on `evt.type`; adding the `game_ended` branch is one new case, parallel to `phase_advanced`.

### Markup extraction

- The fragment renderer owns the buttons, sections, status text, and any data attributes the save-payload populator (separate PRD) will write into. The doc shell wrapping is the only thing the full-page renderer adds.
- Styles continue to live in the doc shell's `<style>` block; the fragment does not carry inline styles. The chat page's existing `<style>` block absorbs the endgame styles when embedding the overlay, so the visual presentation matches.
- Any data attributes the endgame screen exposes for downstream wiring (`data-save-payload`, etc.) are part of the fragment, not the doc shell — populators target the fragment regardless of which renderer wrapped it.

### Routing

- `/endgame` is a `GET` handler on the smoke worker. It returns the standalone full-page render with stub data.
- The chat page is unchanged at `/`. Players continue to land there; the overlay handles the transition.
- No new POST routes. No new client-state machinery beyond the overlay toggle.

### Stub data shape (for the dev route)

- The stub data is enough to make the endgame screen render without errors: three persona names, a fake save payload (or empty), and any other fields the fragment dereferences. Real persona/save data is the save-populator PRD's concern.
- The stub is hard-coded in the worker handler. No KV, no fixtures file.

## Testing Decisions

A good test asserts external behaviour of the rendered output (does the markup contain the expected sections, buttons, data attributes) without coupling to internal helper-function names or markup details that would change the moment a copy edit happens.

### Modules tested

- **Endgame fragment renderer** — fixture-style unit test asserting that the returned string contains the expected buttons (download, submit), section headings, and data attributes (placeholder for the save payload). Mirrors the existing `renderEndgamePage` tests in shape.
- **`/endgame` route** — worker-pool integration test asserting a `GET /endgame` returns 200 with `Content-Type: text/html` and a body containing the endgame markers. Pattern matches the smoke-test integration tests.

### Modules not tested at this level

- **Full-page renderer (`renderEndgamePage`).** Existing tests stay authoritative. Because the function now reuses the fragment renderer, the existing tests continue to validate end-to-end output without modification — that's the proof the refactor preserved behaviour.
- **Overlay reveal glue (chat-page client JS).** Not unit-tested. The reveal is verified through QA against the integrated `game_ended` event from PRD 0003 — there is no useful test of "JS toggles a `hidden` attribute" that does not also re-verify what the SSE handler does, which is already covered.
- **Stub data shape.** Not tested independently; covered transitively through the route integration test.

### Prior art

- The existing UI tests already assert on `renderEndgamePage` output structure — the new fragment-renderer test follows the same shape.
- The proxy smoke test is the model for the route integration test.

## Out of Scope

- **Save-payload client populator.** Wiring the chat-page's in-memory game state into the endgame screen's `data-save-payload` attribute is owned by a separate follow-up PRD. This PRD only ensures the data attribute exists and the screen is reachable.
- **Real persona data on the dev route.** The `/endgame` route serves stub data, not real game state. Hooking it to a session is not in scope; a tester wanting realistic data plays through a real game.
- **Endgame copy authoring.** The current placeholder copy stays as-is. Polish belongs to the HITL phase-content authoring track (issue #18).
- **Production gating of the dev route.** The route is intended for local Wrangler dev; an environment-flag-based 404 is sketched in implementation decisions but full production-deploy hardening (auth, header gating, removal at build time, etc.) is a deploy-time concern outside this PRD.
- **Endgame state persistence.** Reaching the endgame and then refreshing the page restores the player to the chat page, not the endgame, in v1. Persisting the "game has ended" flag client-side (localStorage, cookie) is a possible follow-up but not required for QA.
- **Animations or transitions.** The overlay reveal is a simple visibility toggle. No fade, no slide, no progressive disclosure of sections.
- **Diagnostics submission flow.** The diagnostics POST already works (issue #19 shipped it). This PRD does not modify it; it only ensures the screen that hosts the submit button is reachable.
- **Real LLM provider, KV diagnostics persistence.** Both deferred and unrelated to making the endgame screen reachable.

## Further Notes

- This PRD has a hard dependency on PRD 0003. The chat-page overlay reveal is meaningless without a `game_ended` event to listen for. Implementation order: 0003 lands first, then this PRD's overlay glue plugs into the new event.
- The dev `/endgame` route is independent of 0003 and could land alone. Splitting this PRD into "fragment + dev route" (zero-dep) and "overlay + glue" (depends on 0003) is reasonable if the implementer wants to ship incrementally.
- The decision to use an inline overlay rather than a navigation to `/endgame` was driven by state preservation: the chat page holds the in-memory game state, and a real navigation would require either re-fetching state from the server (which means session storage exists and is queryable, which is in 0003's scope) or transferring state via query params (fragile). The overlay approach sidesteps that by keeping the same JS context. If session-state queryability becomes a desirable property later (e.g., for refresh-resilience), revisiting this is reasonable but not currently required.
- The `data-save-payload` attribute lives on the fragment because that's where the save-populator (separate PRD) will write to. Locating it on the doc shell would make the populator's job harder when the endgame is rendered as an overlay.
- Tracked on the issue tracker as #28.
