# SPA shell design notes

Covers the root files of `src/spa/` (`main.ts`, `render-app.ts`,
`current-view.ts`, `bbs-chrome.ts`, `byok-modal.ts`, `llm-client.ts`,
`streaming.ts`, `env.d.ts`, `test-setup.ts`), the dev inspector,
`styles.css`, and the SPA test harness. Save formats are covered in
[persistence.md](persistence.md).

## Rendering without a router (`main.ts`, `render-app.ts`, `current-view.ts`)

ADR 0011 removed URL routing. `main.ts` registers the three views, performs
one boot render, and wires the sessions icon and Escape. After that, every
re-render is a call to `renderApp` from a view.

- **Legacy save.** At boot, if the old single-key save (`hi-blue-game-state`)
  exists and no session pointer is set, the save is deleted and the one-shot
  boot reason `legacy-save-discarded` is stored. The first `renderApp`
  displays it. If localStorage is unavailable, this step is skipped silently.
- **In-memory state** in `render-app.ts` consists of `pickerOpen` and
  `pendingBootReason`. The sessions icon and Escape toggle `pickerOpen`, and
  route navigations clear it. `pendingBootReason` is consumed by the first
  render.
- **Reason precedence** (`takeEffectiveReason`) is: an explicit `opts.reason`
  (even `null`), then the one-shot boot reason, then the reason derived from
  the view.
- **Pending bootstrap owns a fresh session**
  (`pendingBootstrapOwnsFreshSession`). After CONNECT, a bootstrap may still be
  generating content for a freshly minted session (`empty` or
  `no-active-pointer`). While it runs, the game view shows the
  progressive-loading UI instead of bouncing back to start. This never
  overrides a sticky `broken` / `version-mismatch` session: a bootstrap must
  not save new content under a stale session's id. The regression test for
  this is in `game.test.ts`, "version-mismatch session with pending
  bootstrap".
- **`schemaVersion`** is passed to a view only when the effective reason is
  `version-mismatch`. An explicit `opts.schemaVersion` takes priority over the
  dispatcher's value; `game.ts` passes one after `clearActiveSession`.
- **`currentView` combine rule.** A `#/sessions` verdict (broken or
  version-mismatch) is sticky: `pickerOpen` is ignored and the verdict's
  reason reaches the banner. Otherwise, `pickerOpen` shows the picker with no
  reason, because the user opened it. Otherwise, the verdict's route
  determines the view.
- **Escape closes the picker** unless the BYOK dialog is open or focus is in
  an input or textarea.

## BBS chrome (`bbs-chrome.ts`)

- **Build-time defines are read behind `typeof` guards.** Vitest does not
  inject the esbuild defines, and the IIFE that builds `BANNER` runs at module
  load, before any `beforeEach` stub.
- **Version suffix.** A release build shows `bbs terminal · v<version>`. Any
  other build shows `v<latest ancestor tag> · 0x<short sha>`. If no `v*` tag
  exists yet, the `package.json` version is used.
- **Banner rows** are `[amberPrefix, blueLetters, amberSuffix]`. The blue
  segment is 33 characters wide in every row, which keeps the columns aligned.
  Only the meta row has a suffix. Each `║` is wrapped in `.banner-side` so the
  CSS can fill the gaps between lines (see Styles).
- **Panel chrome.** The border glyph text is filled in once per panel. The
  thin/heavy swap on selection is pure CSS (`.panel--addressed`). The HTML
  scaffold leaves `data-transcript` empty so that AiIds are not hard-coded;
  `initPanelChrome` fills it in from the persona id.
- **`LoadState`.** `loading-daemons` and `generating-room` are the
  progressive boot phases. `unstable` is set when a round fails with an error
  other than cap-hit, such as a transient upstream 502/503/504 (#231). The
  next successful round clears it.

## BYOK (`byok-modal.ts`, `llm-client.ts`)

- **Validation** calls OpenRouter's `/api/v1/auth/key`.
  - 401 and 402 are rejections.
  - Other 4xx responses are `rejected-other`.
  - 5xx responses and network failures offer "save unverified".
  - A 200 response that reports `usage >= limit` is treated as a 402.
  - A 200 response whose body cannot be parsed counts as validated
    (`readAuthKeyInfoOrNull` returns `null`). The endpoint has already
    accepted the key, and the limit check is only advisory.
- **Build info** (the commit SHA) is shown only when the SPA runs on the
  local dev host.
- **Target resolution.** When a non-empty key is stored, requests go directly
  to OpenRouter. Otherwise they go to the Worker proxy. If localStorage
  cannot be read, the SPA behaves as if no key were stored.

## LLM request shape (`llm-client.ts`)

- **`usage: { include: true }`** asks OpenRouter to report cost in USD. For
  streams, the final SSE chunk carries it. For JSON calls, the proxy's
  reconciliation prefers this authoritative `usage.cost` over recomputing
  cost from token counts, which keeps JSON calls consistent with streaming
  calls.
- **`stream_options.include_usage`** is required for OpenRouter to emit the
  usage chunk on a stream. The proxy also injects it, but BYOK requests skip
  the proxy.
- **`tools`** are sent only when the list is non-empty; the request never
  contains an empty array.
- **`parallel_tool_calls: true`** comes from spike #239, which tested whether
  GLM-4.7 emits a message and an action in one assistant turn. The
  coordinator still drops the tail. The flag only makes the behaviour
  measurable.
- **`reasoning: { enabled: false }`** skips the thinking step entirely.
  `{ exclude: true }` would still think and only hide the trace. Daemon turns
  disable reasoning by default (`BrowserLLMProvider`), and the `?think=1` dev
  affordance turns it back on.
- A 200 response whose body contains an `error` object throws
  `UpstreamErrorBodyError`.

## SSE parsing (`streaming.ts`)

- Events are split on blank lines. The unfinished trailing event stays in the
  buffer until the next read.
- Tool calls accumulate by `index`. The id and name arrive in the first
  fragment, and later fragments append to the arguments. The accumulated
  calls are flushed on `finish_reason: "tool_calls"` or `[DONE]`.
- **Usage.** OpenRouter's final chunk has empty `choices` and a populated
  `usage` (`usageFromChunk`). `cached_tokens` is read from the OpenAI-style
  `prompt_tokens_details.cached_tokens`, falling back to the Anthropic-style
  `cache_read_input_tokens`. It is left undefined when the provider does not
  report caching.
- Malformed JSON chunks are dropped. The same `try` block wraps the callbacks,
  so an exception thrown by `onDelta` or another callback while it handles a
  chunk is dropped too.

## Build-time globals (`env.d.ts`, `test-setup.ts`)

`scripts/build-spa.mjs` defines `__WORKER_BASE_URL__`, `__COMMIT_SHA__`,
`__VERSION__`, `__RELEASE_VERSION__`, `__LATEST_RELEASE_VERSION__` and
`__DEV__`. `__DEV__` is true exactly when `WORKER_BASE_URL` is
`http://localhost:8787` (ADR 0013).

`test-setup.ts` stubs the Worker URL and `__DEV__ = true` before every jsdom
test and resets `location.search`. The `setSearch()` helpers use
`history.replaceState`, which persists between tests, so a leaked test
affordance such as `?winImmediately=1` would change a later test's round.

## Dev inspector (`dev-inspector/`)

- **One gate.** `renderInspector` is the only entry point, and its
  `if (!__DEV__) return` is the only check. The sub-modules trust it and have
  no guard of their own. esbuild folds the constant and removes the inspector
  from the production JS. The CSS is not tree-shaken, so the inspector's
  selectors remain in the stylesheet as dead bytes, which reveals nothing.
  `dev-gating.test.ts` exercises the `__DEV__ === false` branch.
- **Three modes.** A session shows the game strip, the world map and the
  per-Daemon footers. A pending bootstrap shows only the pending strip. With
  neither, everything is hidden.
- **Side-channel records.** Turn results, system prompts, errors and rounds
  are not part of `GameState`. The provider wrapper in `views/game.ts` records
  them in module-level maps. Every session render clears the turn results
  so that data from a previous session does not appear.
- **Update invariants.** `updateDaemonFooterSummary` never touches the pip,
  which only `setDaemonFooterInFlight` changes.
  `updateDaemonFooterDetails` never replaces a `<details>` element or its
  `open` attribute, so a block the user expanded stays open. The persona card
  is filled in once. `updateGameStripSummary` keeps the strip's `<details>`
  element. `updateWorldMap` mutates the existing cells and never creates or
  removes nodes.
- **Pending strip.** A 100 ms ticker updates the elapsed time. Only
  `renderPendingStrip` restarts it; `updatePendingStrip` does not.
- **World map.** The map shows only the 5×5 room, with no wall ring and no
  out-of-bounds cells. This clipping affects only the display: Daemon
  perception still includes the Walls beyond the room. Cell precedence is
  Daemon `@ ` > obstacle `##` > objective object on its paired space `**` >
  objective object `* ` > objective space `+ ` > interesting object `o ` >
  floor `. `. A held entity has no cell of its own; it appears in its
  holder's tooltip.
- **Daemon markers are position-only** (ADR 0015). Every Daemon uses the same
  glyph. Identity comes from the colour, `data-ai` and the tooltip. There is
  no direction arrow, direction letter or movement trail.
- **Vista focus.** `vista-mask.ts` uses the shared `projectVista`, so the
  inspector and the runtime cannot disagree about what a Vista contains. The
  mask depends only on position, so two Daemons on the same cell highlight
  the same cells. Out-of-bounds Wall cells are dropped. The tint goes on
  `backgroundColor` and the marker colour on `color`, so the tint never hides
  a marker's identity. The focus follows the Daemon when the map updates.
  Clicking the active focus button again, or pressing Escape, clears the
  focus. The Escape listener is attached once per document.
- **Test oracles** (`vista-focus.test.ts`) come in two complementary kinds:
  1. `expectedVistaMask` is built from the runtime's `VISTA_OFFSETS`. It
     follows the geometry the game uses, but it cannot catch a wrong table,
     because `vista-mask.ts` reads the same table.
  2. The brute-force `dx² + dy² ≤ 4` check guards the table's contents. It
     deliberately does not use `projectVista` filtered by `isWall`: that is
     the implementation's own loop, so the test would only confirm that the
     code equals itself.
- **Shared fixtures.** The static fixtures pass spatial records to the engine
  by reference, so any test that moves a Daemon snapshots the positions and
  restores them afterwards. jsdom converts hex colours to `rgb()`, so colour
  assertions normalise both sides.

## Styles (`styles.css`)

- **Stage grid.** `#stage` uses `height: 100%`, which resolves through
  `html` and `body` to the viewport, together with `min-height: 100dvh`. The
  definite height lets the `1fr` panels row resolve against the viewport
  instead of growing with its content. The min-height keeps the stage from
  collapsing. `#phase-banner` uses `display: none`, which removes it from grid
  flow, so `#panels` is pinned to row 5 (the `1fr` row) and `#composer` to
  row 6. Without the pins, the composer would take the `1fr` row and the game
  would overflow. `stage-layout.test.ts` enforces this contract.
- **Box-drawing chrome.** Borders are runs of box-drawing glyphs. The body's
  inherited text-shadow halos overlap from glyph to glyph and make vertical
  sides look beaded, so the chrome drops the halo. The banner's `║` and the
  panel's `│` columns instead stack zero-blur text-shadow copies of the glyph
  1 and 2 px above and below it. The copies fill the gap that
  `line-height: 1` leaves between rows and align themselves with the corner
  glyphs, with no positioning math.
- **Side columns.** They use the same explicit `13px` as `.brow`. At mobile
  breakpoints the body drops to `12px`, and an inherited size would shift the
  `│` about 0.6 px away from the corner's vertical arm. They have no explicit
  width because `1ch` is the advance of `0`, and JetBrains Mono's box glyphs
  are slightly different.
- **Dashes.** Dashed rules use a gradient of 6 px ink and a 3 px gap, which
  matches how `-` renders in JetBrains Mono at 13 px. The native `dashed`
  style gives a 2/2 px stipple. The phase banner's transparent 1 px border
  keeps its box size unchanged.
- `.banner-blue` is applied again inside `.login-tag b` / `.login-sysinfo b`,
  because their amber rule has specificity (0,1,1) and beats the single-class
  rule.
- **Progressive loading.** `#stage[data-load-state]` has three states:
  - `loading-daemons`: empty frames, disabled composer, red status.
  - `generating-room`: names with braille spinners and a bottom-to-top
    brightness wipe driven by `--fill-pct`, yellow status.
  - Stable: the attribute is removed.

  In the top-info colours, `.ok` is green, `.err` is red and `.warn` is
  yellow.
- **Password field** sets `font-variant-ligatures: none`. JetBrains Mono
  ligates `**` and `***` and raises the middle asterisk, which misaligns a
  masked password.
- **Bento layout (≤720px).** The addressed Daemon gets the main panel and the
  other two become strip cards about 88 px tall. The desktop
  `flex: 1 1 0; width: 0` is reset, because inside grid cells it would
  collapse the panels to zero width. Strip cards anchor the transcript to the
  bottom (absolute positioning, with the older lines clipped) and show the
  label on the top edge. The main panel keeps the scrolling transcript and the
  bottom label. Each line is wrapped in `.msg-line` so that strip cards can
  use per-line nowrap with an ellipsis, while desktop inherits `pre-wrap`.
- **Dev strip line wraps.** A nowrap flex row's min-content width is the sum
  of its items. Line 1 holds the randomized setting, weather and time-of-day
  strings, which can exceed the roughly 351 px available at a 375 px
  viewport. `#stage` has a single `auto` track and its items default to
  `min-width: auto`, so the wide row stretched the whole page. Measured over
  24 boots at 375 px, 3 overflowed without wrapping and none overflowed with
  it.

## SPA test harness (`src/spa/__tests__/`)

- `generatePersonas` and `generateDualContentPacks` are mocked to return the
  static fixtures (ids red/green/cyan, names Ember/Sage/Frost), so panel
  selectors are stable and no LLM is called. `IDENTITY_SHUFFLE_RANDOM` pins
  `Math.random` so the shuffle leaves that order unchanged.
- `game.ts` restores from an active session (#173). Without one it redirects
  to start, so tests seed a session before rendering. Call
  `seedSessionInStub` before `vi.resetModules()`, so the routes import the
  same `session-storage` instance.
- `makePassSseStream` emits empty content and a usage chunk. The SPA acts
  only on `message` tool calls, and free-form text would trigger the #254
  retry instead of a pass. The non-zero cost exercises budget deduction.
- `makeLocalStorageStub` copies its initial data, so tests mutate
  `stub._store`, not the object they passed in.
