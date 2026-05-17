# ADR 0011 — Remove URL routing from the SPA in favour of a state-driven render

**Status:** Accepted

The SPA ships a hash-based router (`src/spa/router.ts`) backed by a `withDispatcher` wrapper in `main.ts` that reads the active-session pointer and `loadResult` on every route entry and `hashchange`, then either rerenders or sets `location.hash` to redirect. The active-session pointer in localStorage — not the URL — is already the source of truth: every `hashchange` re-reads storage and may override the URL, so the URL contributes nothing to the decision. The hash is a derived value that drives a render via a synthetic event, with quirks (the `#/game?${Date.now()}` cache-bust at three call sites exists only to force a `hashchange` when already on `#/game`) and visible weirdness (the back button cycles screens that were never intentional navigation destinations). The `withDispatcher` wrapper carries five branches that exist purely to translate between "what hash did the user type" and "what does storage say should render," and the routes themselves carry ~19 `location.hash = …` call sites that are just "rerender with reason."

## Decision

Delete `src/spa/router.ts` and the `withDispatcher` wrapper. Replace them with a single `renderApp(root, opts?)` function that:

1. Reads `activeSessionId` + `loadResult` from localStorage,
2. Composes that with an in-memory `pickerOpen` flag through a new pure function `currentView({ verdict, pickerOpen })` in `src/spa/current-view.ts`,
3. Dispatches to `renderStart` / `renderGame` / `renderSessions` based on the resulting view,
4. Writes `data-view` and `data-reason` attributes on the root element as the testable observables.

The existing pure function `src/spa/persistence/active-session-dispatcher.ts` is **untouched** — `current-view.ts` composes it. The combine rule is: if the dispatcher verdict routes to `#/sessions` (`broken` or `version-mismatch`), the picker is sticky and `pickerOpen` is ignored; otherwise `pickerOpen === true` overrides to the picker, and `pickerOpen === false` lets the verdict's natural route win. The sessions icon toggles `pickerOpen` and calls `renderApp(root)`. Escape on the picker sets `pickerOpen = false` and calls `renderApp(root)`. The back button is no longer captured by the app — it leaves the SPA, which is the platform default and matches a stateless single-screen UI.

Renderer signatures change from `(root, params: URLSearchParams)` to `(root, opts: { reason?: DispatcherReason | "legacy-save-discarded" })`. URL test-affordance params (`?skipDialup=1`, `?winImmediately=1`, `?seed=…`, `?engagementClauses=…`) continue to read from `location.search` directly — they were never hash params for any reason other than they passed through the router as `URLSearchParams`. The legacy-save-discarded flag is computed once at module load (the existing pattern in `main.ts`) and consumed by the **first** `renderApp` call via `opts.reason = "legacy-save-discarded"`; subsequent calls don't see it.

## Considered Options

**State-driven `renderApp` with in-memory `pickerOpen` (chosen).** localStorage stays the single source of truth for *session* state; only the transient *view* of whether the picker is open lives in memory. This matches what the data already says — the dispatcher verdict drives the screen, and the picker is the one screen the verdict can't infer (there's no localStorage marker for "user clicked the [ ls ] icon"). An alternative was to mirror `pickerOpen` to localStorage so a refresh preserves it, but the picker is a fleeting affordance, not a state worth surviving reload; landing on a fresh load with the picker open over a populated session would be more surprising than going straight to the game.

**Delete the router entirely (chosen).** A smaller-diff alternative was to keep the router and just teach renderers to call `renderApp` directly when they want to rerender, sidestepping `hashchange`. This leaves the cache-bust trick (`#/game?${Date.now()}`) in place as a temptation and keeps two ways to navigate — the router and the renderApp call — which is worse than one. Deleting `router.ts` and its test forces every call site to a single primitive.

**Renderer signature `(root, opts: { reason?: … })` (chosen).** Continuing to pass `URLSearchParams` was viable — every renderer already optionalises it — but the only field anyone reads is `reason`, and the rest of the affordance params come from `location.search` regardless. A typed `opts` object makes the contract honest and lets the typechecker enforce that the only legal reasons are the dispatcher reasons plus `legacy-save-discarded`.

**`data-view` + `data-reason` attributes as test observables (chosen).** The unit and e2e tests currently assert against `location.hash`, which is the *cause* of the render rather than the render itself. Migrating those assertions to `main[data-view="game"]` / `main[data-reason="broken"]` asserts what the user actually sees, decouples the tests from the URL implementation, and gives Playwright a stable selector that doesn't depend on URL state at all. The alternative — sniffing which DOM panels are visible — is brittle (panels are hidden/shown for several reasons) and couples test text to UI text.

**Back button leaves the app (chosen).** Capturing `popstate` to re-enter the app was rejected: there's nothing meaningful to go back *to* in a state-driven model, and the current hash-based back behaviour (cycling through previous hashes that may no longer match storage state) is already a bug source rather than a feature. The platform default — back leaves the page — is the honest behaviour.

## Consequences

- The "direct `#/game` entry redirects to `#/start`" test in `e2e/start-screen.spec.ts` and analogous bookmark/deep-link cases are no longer reachable — there is no URL to type. Bookmarking the app means bookmarking the host, and the SPA decides what to render from storage on load. This is an intentional product change; the URL was never load-bearing for the user.
- Five e2e specs (`start-screen`, `sessions-picker`, `bootstrap-recovery`, `bootstrap-failure-bounce`, `endgame-choices`) update their `page.goto("/#/sessions")` to a sessions-icon click and their hash assertions to `main[data-view]` / `main[data-reason]` selectors.
- The `#/game?${Date.now()}` cache-bust at `routes/game.ts:1627`, `:1658`, and `routes/sessions.ts:474` disappears — these were workarounds for the fact that `location.hash = "#/game"` from `#/game` doesn't fire `hashchange`. With `renderApp(root)` they are unconditional.
- Test affordance params (`?winImmediately=1` etc.) now read exclusively from `location.search` in each route. The `location.search`-first reading path already exists; the change is removing the hash-params merge.
- `getPendingBootstrap()`-aware redirect for the in-flight bootstrap (currently in `withDispatcher` for `#/game`) becomes a branch inside `currentView` or its caller: if `verdict.reason ∈ {empty, no-active-pointer}` and a pending bootstrap exists, render `game` instead of `start`. This preserves the existing invariant (the bootstrap must not be redirected to `#/start` mid-flight).
- For broken / version-mismatch sessions the picker is sticky: closing it via Escape or the sessions-icon toggle is a no-op because `currentView` still derives `"sessions"` from the verdict. This falls out of the combine rule for free and needs no explicit close-guard.
