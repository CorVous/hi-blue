# Route views (`src/spa/views/`)

Design notes for the three route renderers (`start.ts` → `#/start`,
`game.ts` → `#/game`, `sessions.ts` → `#/sessions`) and the shared
`archived-build-link.ts`. Each renderer owns what is visible for its route:
it hides the other routes' screens and shows or hides the global chrome
(`#stage > header`, `#topinfo`, `#banner`).

## Shared: route chrome

- The start route hides the global chrome (the dial-up login takes the whole
  viewport). The game and sessions routes therefore always un-hide it on
  entry (`revealGameRouteChrome`, `showGlobalChrome`), because either can be
  entered straight after the start route.
- `sessions.ts` also paints the banner and topinfo itself (`paintBanner`,
  `paintTopInfo`). Without that, loading `#/sessions` directly leaves them
  empty.
- `renderVersionMismatchBanner` exists in both `start.ts` and `sessions.ts`.
  When the save's schema number maps to an archived release
  (`lookupArchiveVersion`), the banner links to `./v/<version>/` so the player
  can continue in the last build that could read that schema. Otherwise it
  shows the plain copy. `buildArchivedBuildLink` holds the link format in one
  place for both banners and for the picker's per-row note.

## `start.ts`: dial-up login

- **Warning banner.** It appears only for reasons that have copy in
  `PERSISTENCE_WARNING_MESSAGES`. The dispatcher also routes here with
  reasons such as `empty` or `no-active-pointer`. Those are not problems the
  player needs to see, so no banner is shown for them.
- **CONNECT gating.** CONNECT is disabled only while the dial-up animation is
  typing. Asset readiness does not gate it. Persona and content-pack
  generation starts on mount through `pending-bootstrap` and keeps running in
  the background. After CONNECT the game route watches that bootstrap and
  renders progressive loading. That route builds and saves the session, not
  this one.
- **Double-submit guard.** `_connectSubmitInFlight` ignores repeated
  submits, such as a double-click, once a CONNECT with the correct password
  is in progress. Each render resets it.
- **Reusing the bootstrap.** If the player returns to the start screen,
  `getPendingBootstrap()` gives back the bootstrap already in progress, so
  generation does not restart.
- **Generation failure.** A failure is shown here (`#cap-hit`) only while the
  start screen is still visible. Once the player has moved to `#/game`, the
  game route's loading flow handles it.
- **Skipped animation.** `renderDialTranscriptHtml()` includes the `.ok` /
  `.hot` status spans as markup, so it is assigned with `innerHTML`. As plain
  text the tags would show literally and the dial would lose its colours. The
  animation is skipped for `?skipDialup=1` and for `prefers-reduced-motion`.
  `matchMedia` can throw in some test environments; that counts as "no
  preference".
- **jsdom tolerance.** `tryFocus` and `trySetCaret` swallow errors because
  some jsdom and input configurations do not support `focus()` or
  `setSelectionRange`.
- **Uptime.** `formatUptime` renders time since the build's commit as
  `Dd HHh MMm`, matching the design-system placeholder (`11d 04h 22m`).
  Negative spans show as zero.
- **Query flags (spike #239).**
  - `?seed=N` fixes the persona archetype, setting noun and spatial layout
    through Mulberry32 sub-streams. Without it, generation uses
    `Math.random`.
  - `?engagementClauses=1` (step 8 of the spike) adds per-persona engagement
    clauses to each daemon's blurb at synthesis time. It is off by default,
    and only the exact value `1` turns it on.
  - `?actionProfiles=0` turns off the per-persona `<action_profile>` clauses
    derived from temperaments. They are on by default, and any other value
    leaves them on. The switch exists for A/B comparison and debugging.
- `_testOverrides` / `StartTestOverrides` were meant as a way for tests to
  inject providers. Nothing sets them at present.

## `game.ts`: game route

### Test and dev affordances

- `isDevHost()` is true only when `pnpm wrangler dev` serves both the SPA and
  the worker on `http://localhost:8787`. Every other host fails it, including
  production on GitHub Pages and a separate static server pointed at a local
  worker, so dev affordances do nothing there. The check has two parts as
  defence in depth. The build-time half (`__WORKER_BASE_URL__` equals the dev
  URL) turns affordances off in every production-targeted build, even if a
  future deploy serves SPA and worker from one origin. The runtime half
  compares `location.origin`.
- `applyTestAffordances` reads flags from `location.search`, not from the
  hash params. The flags belong on the page URL itself, the same way the
  legacy worker took them. `?winImmediately=1` wraps `submitMessage` so that
  the next round ends the game with outcome `win`. Integration tests use it
  to reach `game_ended` without meeting objectives through tool calls. The
  affordances are applied on every entry that has a session, including the
  recursive entry after bootstrap.
- `?think=1` turns model reasoning back on for prompt tuning.
  `BrowserLLMProvider` turns it off by default for routine daemon turns. The
  flag works only on the dev host.

### Session cache and the active pointer

- Module state: `session`, `hydratedSessionId`, `hydratedEpoch`.
  `hydratedSessionId` is the id that `session` was loaded from. Clicking
  Load in the picker writes a new active id and re-enters this route without
  a page refresh. When the pointer has moved (`activePointerMoved`), the
  cached session is dropped so that the restore path loads the new session
  instead of re-rendering the old one.
- `gameEndHandled` stops a second `game_ended` event from binding the endgame
  handlers again. It is reset whenever a session is set up.

### Bootstrap loading flow (`renderBootstrapLoadingFlow`)

- This runs when the player has just pressed CONNECT and a bootstrap is
  pending. The session cannot be built until the content packs arrive, but
  the player should see the main screen loading, not stay on the dial-up
  screen. The screen goes through three states on `#stage[data-load-state]`:
  `loading-daemons`, then `generating-room` once personas arrive, then
  `stable`, which removes the attribute and restores the fully bright look.
  `renderLoadingTopInfo` paints the topinfo until the session exists.
  `refreshTopInfo` takes over after that and resets the mobile status pill.
- **Only for an empty session.** The bootstrap is used only when
  `loadActiveSession()` returns `none`, which means a session id was minted
  but nothing has been saved under it yet. Only then is it safe to build and
  save a new game. For a stale or populated session, the pending bootstrap is
  discarded and `renderApp` routes by what storage holds: a populated session
  goes to the game, a broken or version-mismatched one goes to the sessions
  picker. The same check runs again when the assets arrive
  (`bootstrapInvalidatedMidFlight`), in case another navigation replaced the
  session meanwhile. Otherwise the new game would be saved under the wrong
  session id.
- **Brightness wipe.** `BRIGHTNESS_WIPE_TAU_MS` (60 s) is chosen so that the
  bright band reaches about 95% at about 3 minutes (the target pack load
  time) and about 99% at about 4.5 minutes. It is capped at 99% so the panel
  never looks finished before the packs actually arrive.
- **Spinners.** Braille spinners are appended as child spans of
  `.panel-name`. `initPanelChrome` rewrites the label text but does not
  remove child elements, so the spinners are removed explicitly
  (`removeAllPanelSpinners`) before the session is handed over.
- **Timeout.** `BOOTSTRAP_LOADING_TIMEOUT_MS` (300 s) allows for a slow first
  persona-synthesis call (about 95 s observed on a cold start), its one
  retry after failure, and a parallel outer retry of the content packs. The
  daemon harness waits the same length of time for the stable state.
- **A success that arrives after the timeout.** When the timeout fires, the
  bootstrap promise keeps running. If it later succeeds,
  `dismissStaleBootstrapRecovery` hides the recovery banner and replaces its
  buttons with clones that have no listeners. Otherwise the banner would sit
  on top of the working game, and its regenerate or abandon buttons could
  destroy the running session.
- **Handover.** After saving, the flow sets the module-level `session` and
  calls `renderGame` again. That second entry skips both the loading branch
  and the localStorage restore, and runs the normal set-up path, where
  `refreshComposerState` decides whether Send is enabled.
- **Recovery.** A timeout shows "stuck" copy and any other failure shows
  "broken" copy. Regenerate calls `restartContentPacks()`, which keeps the
  cached personas. If the recovery DOM is missing, the flow clears the
  session and sends the player to the start route with reason `broken`.
- `dropListenersByCloning` replaces an element with a clone of itself, which
  drops every listener on it. Note: `runRegenerate` still sets `disabled` on
  the regenerate button from before the clone, which is now detached.

### Restore path

- **Storage unavailable.** If localStorage cannot be used (for example, a
  `SecurityError` in private mode), a warning appears and the route renders
  with no session. There is nothing to restore, and the start route has
  already dealt with that case.
- **No active pointer.** Rendering falls back to the start route, where the
  dispatcher mints a new session.
- **Transcripts.** Transcripts are rebuilt from `conversationLogs`. Saves do
  not store transcript HTML. Each panel's transcript is cleared before it is
  refilled, because clicking [load] on another session keeps the previous
  session's lines in the panels. Clearing only when there were entries left
  old lines behind whenever the new session had fewer entries for that
  panel. Only messages to or from the player (`blue`) are shown.
  Daemon-to-daemon messages and broadcasts exist only as LLM context.
- Restored transcripts are scrolled to the bottom inside
  `requestAnimationFrame`, so that `scrollHeight` is laid out before it is
  assigned.
- **Failed load.** On `broken` or `version-mismatch`, the start route shows
  the reason. A version-mismatched save keeps its bytes
  (`deactivateActiveSession`). A broken one is cleared.
- **Order of set-up.** The first `refreshComposerState()` runs after the
  panel loop has set `data-ai` on every `.ai-panel`. Its lockout pass finds
  panels by `[data-ai]`. If it ran earlier it would skip the `panel--locked`
  paint, and a restored chat lockout would look unlocked until the next
  keystroke. Lockouts come from active complications, so a reload keeps Send
  disabled for AIs whose chat is locked out.

### Rounds (form submit)

- A leading `*Name` mention is removed from the message, so the player's line
  and the LLM submission contain only the body. Mentions later in the
  message stay.
- While a round is running, `#stage[data-round-in-flight]` is set. External
  drivers (the playtest daemon, e2e tests) wait on this attribute instead of
  polling transcript text. It is cleared in `finally`, after the events loop
  has painted the round.
- When the player sends, the composer resets straight away to
  `*<addressee> ` instead of waiting for every daemon to finish. Setting the
  value from code does not fire `input`, so `refreshComposerState()` is
  called directly to repaint the mention overlay.
- **Spinners (#254).** Each daemon's spinner is removed when the coordinator
  finishes that daemon's turn, including any retry (`onAiTurnComplete`). The
  coordinator awaits AIs one at a time in initiative order, so spinners stop
  one by one, as they did before #254, and the retry window is still
  covered. All remaining spinners are removed in `catch` and `finally`.
- `encodeRoundResult` is still passed `completions`, which it ignores.
- **Events the view skips.**
  - `ai_start`: spinners are removed through `onAiTurnComplete`, and panel
    content comes from `message` events.
  - `token`: the encoder has not emitted it since #214.
  - `ai_end`: message content already ends with `\n`.
  - `system_broadcast`: it lives only in each daemon's `conversationLog` as
    LLM context.
  - `action_log`: the dev inspector replaced it.
- **`message` events.** A message from the player is skipped
  (`playerLineAlreadyPaintedAtSubmit`), because `appendPlayerLine` painted
  it at submit time and painting it again would duplicate it. Only
  daemon-to-player messages are painted. They are not paced: since #213,
  daemon speech goes through tool calls and the encoder emits one complete
  `message` per turn, so pacing would only slow tests without making
  streaming feel better. `_pace` is currently unused.
- **One line per message.** A daemon message stays in a single `.msg-line`
  even if it contains `\n`, so the strip-card preview can show it as one
  truncated line. The accumulated body is kept in `line.dataset.body`, so
  each update re-renders the whole body with mention highlighting.
- **`game_ended`.** The session is captured for the endgame buttons, then
  `session` is set to null, so any later submit does nothing. "Continue"
  (shown only when an OpenRouter key is stored) saves the new room under the
  same session id, because the active pointer is unchanged. "Same daemons"
  archives the old session and mints a new one.
- State is saved after the events loop, and not when the game ended.
- **Round errors (#231).** Failures other than `CapHitError` (a transient
  upstream 502/503/504, a dropped network connection, a malformed response)
  used to stop the round with no sign in the UI. They now show `#round-error`
  and set the topinfo pip to `connection unstable`. Both clear when the next
  round starts.

## `sessions.ts`: the session picker

Issue #174 (parent #155). There are two sections, active sessions and
archived sessions, with one row per session.

- The row kinds are `ok` (tree listing plus `[ load ] [ dup ] [ rm ]`),
  `broken` (`[ corrupt ]`, placeholder tree, `[ rm ]` only) and
  `version-mismatch` (a `[ version mismatch ]` tag, a note linking to the
  archived build when the schema is in `SCHEMA_ARCHIVE_MAP`, and `[ rm ]`
  only). Archived rows are read-only and can offer
  `[ continue with new room ]` when an OpenRouter key is stored.
- Sort order: `ok` rows by `lastSavedAt`, newest first, then the rest by id.
- In the tree listing, `engine.dat` always comes last because it is the
  commit signal: it is written after the daemon files.
- `[ rm ]` confirms inline. It swaps to `[ confirm rm ] [ cancel ]`, and
  cancel puts `[ rm ]` back.
- `[ + new session ]` is cloned on each render to drop the previous render's
  listener. It mints a session, makes it active and routes to start.
- `dupSession` throws only on programmer error, so the dup handler swallows
  the error.
