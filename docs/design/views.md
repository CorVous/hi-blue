# Route views (`src/spa/views/`)

Design notes for the three route renderers (`start.ts` → `#/start`,
`game.ts` → `#/game`, `sessions.ts` → `#/sessions`), the game route's
`game-bootstrap-flow.ts`, `game-chrome.ts`, `game-endgame.ts` and
`transcript-lines.ts`, and the shared
`archived-build-link.ts` and `dom.ts`. Each renderer owns what is visible for its route:
it hides the other routes' screens and shows or hides the global chrome
(`#stage > header`, `#topinfo`, `#banner`).

## Shared: route chrome

- Routes show and hide screens through `setHidden` (in `dom.ts`), which sets
  `hidden` on every element a list of selectors finds and skips the ones
  that are missing, so a test fixture without some screen still renders.
- The start route hides the global chrome (the dial-up login takes the whole
  viewport). The game and sessions routes therefore always un-hide it on
  entry (`revealGameRouteChrome`, `showGlobalChrome`), because either can be
  entered straight after the start route.
- Every route hides `#endgame`, and the game route shows it again only for a
  finished session. The endgame choices ("new daemons", "same daemons",
  "continue") leave through `renderApp`, so a route that forgot it would
  leave the endgame screen over the next game.
- `#persistence-warning` is shared by the start route's reason banner and the
  game route's save warnings. The start route hides it whenever it has no
  reason to show, and the game route hides it on every entry before its own
  checks run, so a banner such as "broken" does not follow the player into a
  new game.
- `sessions.ts` also paints the banner and topinfo itself (`paintBanner`,
  `paintTopInfo`). Without that, loading `#/sessions` directly leaves them
  empty.
- `renderReasonBanner` (in `archived-build-link.ts`) paints the reason
  banner for both `start.ts` and `sessions.ts`. Each view passes its own
  message table and decides how to show or hide the element. A reason with
  no copy in the table paints nothing. For `version-mismatch`, when the
  save's schema number maps to an archived release (`lookupArchiveVersion`),
  the banner links to `./v/<version>/` so the player can continue in the last
  build that could read that schema. Otherwise it shows
  `VERSION_MISMATCH_MESSAGE`, which both tables share.
  `buildArchivedBuildLink` holds the link format in one place for the banner
  and for the picker's per-row note.

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
- **Repeated renders.** The start screen renders again whenever the player
  comes back to it (for example after "new daemons"). Each render aborts the
  previous render's `AbortController` (`abortPreviousRender`). The login
  form, BEGIN and password-mask listeners and the resize listener are added
  with that signal, the uptime interval is cleared on abort, and every step
  of the dial-up `setTimeout` chain checks it (`setTimeoutUnlessAborted`).
  Without it each render added another set of listeners, and an animation
  still typing from an earlier render kept writing into `#dial` over the new
  one.
- **Reusing the bootstrap.** If the player returns to the start screen,
  `startBootstrap` gives back the bootstrap already in progress, so generation
  does not restart. A bootstrap that failed is not reused: the start screen
  starts a fresh one. It used to reuse the failed entry, so every later
  CONNECT went straight to the game route's recovery banner.
- **Generation failure.** A failure is shown here only while the start screen
  is still visible, and only for the bootstrap that is still current (an
  abandoned one is aborted, and its rejection must not paint anything). Once
  the player has moved to `#/game`, the game route's loading flow handles it.
  - `CapHitError` shows `#cap-hit` and hides the start screen, as before.
  - Anything else shows `#start-bootstrap-error` under the login form, with the
    upstream message when there is one (`HTTP 401: …`) and a `[ retry ]`
    button that starts a new bootstrap. Every failure used to show the "AIs
    are sleeping" cap screen, which told a player with a network blip or a bad
    key to come back tomorrow.
  - CONNECT with a failed bootstrap also starts a new one before routing to
    the game, so the loading screen shows a fresh attempt.
  - The returned promise still rejects; `main.ts` logs it.
- **Skipped animation.** `renderDialTranscriptHtml()` includes the `.ok` /
  `.hot` status spans as markup, so it is assigned with `innerHTML`. As plain
  text the tags would show literally and the dial would lose its colours. The
  animation is skipped for `?skipDialup=1` and for `prefers-reduced-motion`.
  `matchMedia` can throw in some test environments; that counts as "no
  preference".
- **jsdom tolerance.** `tryFocus` and `trySetCaret` (in `dom.ts`, shared with
  the game composer's mention caret) swallow errors because
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

## `game.ts`: game route

### Structure

- The endgame screen lives in `game-endgame.ts`. `game.ts` only disables
  the composer, releases the cached session and calls `showEndgame` with the
  ended state, the ended session's id, and a `releaseEndedGame` callback
  that clears `session`, `hydratedSessionId` and `gameEndHandled` when a
  choice leaves the endgame. The endgame never reads `game.ts`'s module
  state directly, so the two files do not import each other in a cycle.
  `transcript-lines.ts` builds the `.msg-line` elements (player and daemon
  lines with mention highlighting) that both the panels and the endgame's
  final lines use.
- The bootstrap loading flow lives in `game-bootstrap-flow.ts`. `game.ts`
  calls `enterBootstrapLoading` with its context (typed there as the
  narrower `BootstrapFlowView`) and one `AdoptBootstrappedSession` callback.
  The flow builds and saves the new game, then hands the session to that
  callback, which assigns `session`, `hydratedSessionId` and `hydratedEpoch`
  and re-enters `renderGame`. The flow never imports `game.ts`, so there is
  no cycle. The DOM helpers both files need (route chrome, panel painting,
  spinners, topinfo, the stage load state and the save warning) live in
  `game-chrome.ts`, which imports neither.
- `renderGame` is a short entry point. It works on one `GameViewContext`
  holding the root, the composer elements, the search params, the dev hooks,
  the persona lookups and lockouts, and the round state (`roundInFlight`,
  `connectionUnstable`). Top-level functions take that context as a
  parameter, grouped by concern: bootstrap loading and recovery, restore
  from storage, composer wiring, transcript painting, round dispatch, and
  the endgame. Other state that must outlive one entry (`session`,
  `hydratedSessionId`, `hydratedEpoch`, `gameEndHandled`) stays at module
  level.
- **One context per page.** The route is re-entered without a reload:
  toggling the session picker, Escape, Load, the bootstrap handover and the
  endgame choices all call `renderGame` again on the same persistent DOM.
  `enterGameViewContext` therefore keeps the context in `viewCtx` and, while
  the composer form is the same element, refreshes its per-entry fields in
  place and keeps `roundInFlight` and `connectionUnstable`. The composer
  `input`, `scroll` and `submit` listeners and the panel click listeners are
  added only when the context is first created, so there is exactly one of
  each. When each entry built a fresh context and added its own listeners, a
  re-entry during a round (opening and closing the picker) got a context
  whose `roundInFlight` was false: typing re-enabled Send, and a submit
  started a second round on the same `GameSession` while the first was still
  running. `submitRound` also returns early while `roundInFlight` is set.
- **Dev hooks.** `__DEV__` is read once per entry, when the context picks
  `inspectorDevHooks` or `NOOP_DEV_HOOKS`. The rest of the view calls the
  hooks without testing `__DEV__`. In production builds the constant folds
  to the no-op branch, so the inspector code is tree-shaken
  (`build.test.ts` enforces this). The hooks are chosen per entry, not at
  module load, because tests stub `__DEV__` per test.
- Pure text logic lives outside the view: `splitMentionSegments` and
  `buildMentionRegex` in `mention-parser.ts`, and `fisherYatesShuffledCopy`
  (initiative order) in `shuffle.ts`. The view only turns segments into DOM.

### Test and dev affordances

- `isDevHost()` (`src/spa/dev-host.ts`) is true only when `pnpm wrangler dev` serves both the SPA and
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

### Bootstrap loading flow (`game-bootstrap-flow.ts`)

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
  retry after failure, and a parallel outer retry of the content packs. When
  it fires, `failPendingBootstrap` aborts the stalled requests and marks the
  entry `failed`, so they stop costing money and regenerate starts fresh.
- **A success that arrives after the timeout.** The timeout aborts the
  bootstrap, but a provider that ignores the signal (a mock, or a response
  already fully read) can still resolve. If it later succeeds,
  `dismissStaleBootstrapRecovery` hides the recovery banner and replaces its
  buttons with clones that have no listeners. Otherwise the banner would sit
  on top of the working game, and its regenerate or abandon buttons could
  destroy the running session.
- **Handover.** After saving, the flow calls its `AdoptBootstrappedSession`
  callback, which sets the module-level `session` in `game.ts` and calls
  `renderGame` again. That second entry skips both the loading branch
  and the localStorage restore, and runs the normal set-up path, where
  `refreshComposerState` decides whether Send is enabled. A failed save's
  warning is shown after that entry, because each entry first hides
  `#persistence-warning`.
- **One flow per bootstrap and session.** `renderBootstrapLoadingFlow`
  records a `LoadingFlow` (the session id active when it started, the pending
  bootstrap, its timers, and what blocks the screen: the cap-hit panel, the
  recovery banner, or nothing) in the module-level `loadingFlow`. The route
  is re-entered during loading whenever the player toggles the picker. A
  re-entry for the same pending bootstrap and session only reveals the route
  chrome again (`revealRunningLoadingFlow`), restoring the cap-hit panel or
  the recovery banner the flow was showing. Starting a second flow instead
  added a second set of spinner and wipe timers and a second 300 s timeout.
  Regenerate keeps the flow and swaps in the new pending bootstrap.
- **A flow the player left behind does nothing.** The bootstrap promise
  outlives the screen that started it: after a timeout the player can
  abandon and land on the start screen with a fresh session and a fresh
  bootstrap, and the old promise can still succeed later. Every step of the
  flow (painting the personas, the handover, the failure paths) first checks
  `loadingFlowAbandoned`: if the active pointer no longer names the flow's
  session, it stops its timers and returns. Otherwise it saved the old game
  into the new session, cleared the newer pending bootstrap and pulled the
  player off the start screen. Regenerate keeps the session id, so it still
  hands over.
- **Epoch.** A new game starts at epoch 1. The loading topinfo always paints
  `NEW_GAME_EPOCH`, and the handover resets `hydratedEpoch`, which otherwise
  still held the epoch of the last session restored on this page, so topinfo
  showed that session's epoch for the new game.
- **Recovery.** A timeout shows "stuck" copy and any other failure shows
  "broken" copy (`paintRecoveryCopy`). When the error carries an upstream
  message (`HttpStatusError`, `UpstreamErrorBodyError`) the copy names it,
  for example `HTTP 402: Insufficient credits`, instead of calling the world
  malformed. A failed regenerate repaints the copy for its own error. Regenerate calls `restartContentPacks()`, which keeps the
  cached personas. If the recovery DOM is missing, the flow clears the
  session and sends the player to the start route with reason `broken`.
- `dropListenersByCloning` (in `dom.ts`, shared with the sessions picker's
  `#sessions-new` button) replaces an element with a clone of itself, which
  drops every listener on it, and returns the clone. The regenerate wiring
  keeps that returned clone, so `runRegenerate` disables the button the
  player can see while the content packs regenerate. It once disabled the
  detached original instead, which left the visible button clickable during
  regeneration. Only a retryable failure enables it again, because that is
  the only exit that shows the recovery banner for another attempt. A cap
  hit hides the banner behind `#cap-hit` and leaves the button disabled. A
  success runs `dismissStaleBootstrapRecovery`, which has already swapped the
  button for a clone, so re-enabling the captured one would only touch a
  detached element; `wireRegenerateButton` enables the button again whenever
  the banner is next shown.

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
  drivers such as the e2e tests wait on this attribute instead of
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
  covered. All remaining spinners are removed in `finally`.
- **Events the view skips.**
  - `ai_start`: spinners are removed through `onAiTurnComplete`, and panel
    content comes from `message` events.
  - `ai_end`: message content already ends with `\n`.
  - `action_log`: the dev inspector replaced it.
- **`message` events.** A message from the player is skipped
  (`playerLineAlreadyPaintedAtSubmit`), because `beginRound` painted it at
  submit time and painting it again would duplicate it. Only
  daemon-to-player messages are painted. They are not paced: since #213,
  daemon speech goes through tool calls and the encoder emits one complete
  `message` per turn, so pacing would only slow tests without making
  streaming feel better.
- **One line per message.** A daemon message stays in a single `.msg-line`
  even if it contains `\n`, so the strip-card preview can show it as one
  truncated line. A message arrives whole, so it is painted with the same
  `transcriptMessageLine` that rebuilds restored transcripts and the
  endgame's final lines. The view used to accumulate streamed tokens in
  `line.dataset.body` and re-render the line on each one; that path went
  with token streaming.
- **`game_ended`.** The event only marks the round as the last one. After the
  events loop the final state is saved, topinfo is repainted so the turn
  counter shows the final round, and then `enterEndgame` runs with that state.
  It captures the state for the endgame buttons and sets `session` to null, so
  any later submit does nothing. It also disables the prompt, and
  `mountSessionView` enables it again on every entry, so the prompt works in
  the game an endgame choice leads to.
- **The endgame screen (#576).** The subtitle comes from `outcome`: a win says
  "You have completed the objectives." and the budget-exhausted ending says
  "You have hit your budget." Both lines are the product owner's wording. The
  panels are hidden, so the final round's Daemon-to-player lines (the entries
  logged in round `state.round - 1`) are painted again into
  `#endgame-final-lines`. Without them the player never sees what the Daemons
  said on the last round, which is often what tells them how the game ended.
- **`enterEndgame` can run more than once per page.** Toggling the session
  picker (or pressing Escape in it) re-renders the game route, which restores
  the finished save and enters the endgame again on the same persistent DOM.
  So `resetEndgameControls` first replaces every endgame button with a clone
  (`dropListenersByCloning`), re-enables it and clears the status lines.
  Without that, each entry adds another click handler, and one click on
  download saves twice or one click on same daemons pays for two content-pack
  generations that race each other.
- **Reloading a finished game.** A restored session with `isComplete` goes
  straight to the endgame screen. Mounting it as a playable round would let the
  player send another round into a finished game. The active pointer is kept,
  so the endgame choices still work after a reload. "Continue"
  (shown only when `readStoredByokKey()` finds a stored OpenRouter key) saves
  the new room under the same session id, because the active pointer is
  unchanged. "Same daemons" archives the old session and mints a new one.
- **Endgame choices act on the ended session, not the active one.** "Same
  daemons" and "continue" wait for a content-pack generation that can take
  minutes, and meanwhile the player can open the picker and load another
  session. Each choice therefore carries the ended session's id
  (`EndgameChoice`) and, after every await, gives up without touching storage
  or routing if the active pointer no longer names it
  (`playerLeftEndedSession`). "Same daemons" builds the new room first, then
  archives the ended session, saves the room under a freshly minted id
  (`mintSessionId` plus `saveActiveSession`'s `sessionId` option), and only
  then removes the ended session (`rmSession`, never `clearActiveSession`,
  which deletes whatever is active) and moves the pointer. Building first
  means giving up leaves nothing half-done. "Continue" saves under the ended
  session's own id. "New daemons" removes the ended session only after
  `archiveSession` succeeds.
- **A torn final save is discarded, not archived.** `archiveSession` refuses
  a session whose `saving` marker is still there, and nothing on the
  endgame screen can clear it, so every click on "new daemons" or "same
  daemons" used to fail with the same archive error, and "same daemons" paid
  for a content-pack generation before finding that out. Both choices now ask
  `isSessionComplete` first (`planArchive`), before building a room. An
  incomplete session is not archived: the choice goes ahead, removes the torn
  session as usual, and the status line says the last save was incomplete
  (on "same daemons" alongside "spinning up a new room…"; "new daemons"
  leaves the screen at once). The finished game is still in memory, so the
  download button keeps working until the player chooses.
- **A failed choice keeps the finished game.** If archiving throws (a full
  storage quota, or an unreadable `meta.json`), the room cannot be built, or
  the new room cannot be saved, `failEndgameChoice` writes the reason to
  `#endgame-choice-status` and enables the choice buttons again. Before, a
  failed archive still deleted the session, so the only copy of the finished
  game was lost.
- State is saved after the events loop, including on the round that ends the
  game. Before #576 the final round was not saved, so the stored session ended
  one round early, with `isComplete: false` and the winning Objective still
  pending.
- **The player can leave the round's session while it runs.** A round takes
  as long as the daemons do, and meanwhile the picker can `[ load ]` another
  session, `[ + new session ]` can mint one, or `[ rm ]` can delete this one.
  `submitRound` records the round's owner (the `GameSession` and its id) at
  submit. After `submitMessage` returns, `playerLeftRoundSession` checks that
  `session` and the active pointer still name that owner. If not, the view
  paints nothing and enters no endgame, because the panels and the endgame
  now belong to another session. `saveRoundLeftBehind` still saves the
  finished round under the owner's own id (`saveActiveSession`'s `sessionId`
  option), so the round is not lost, unless the session was removed, in which
  case the round is dropped. If the cached `session` is still the owner's (the
  player came back to it, or moved to a fresh session on the start route), it
  is released so the next entry restores the saved round, and the route is
  re-entered at once when the owner is on screen again. A failure in a round
  the player left is not reported on the session they are now looking at.
  `enterEndgame` takes the ended session's id from its caller for the same
  reason, instead of reading the active pointer.
- **Round errors (#231).** Failures other than `CapHitError` (a transient
  upstream 502/503/504, a dropped network connection, a malformed response)
  used to stop the round with no sign in the UI. They now show `#round-error`
  and set the topinfo pip to `connection unstable`. Both clear when the next
  round starts. When the error carries an upstream message, `#round-error`
  includes it. An error chunk inside a 200 stream counts when it arrives
  before the turn received any content or tool call (see `streaming.ts` in
  spa-shell.md).

## `sessions.ts`: the session picker

Issue #174 (parent #155). There are two sections, active sessions and
archived sessions, with one row per session.

- The row kinds are `ok` (tree listing plus `[ load ] [ dup ] [ rm ]`),
  `broken` (`[ corrupt ]`, placeholder tree, `[ rm ]` only) and
  `version-mismatch` (a `[ version mismatch ]` tag, a note linking to the
  archived build when the schema is in `SCHEMA_ARCHIVE_MAP`, and `[ rm ]`
  only). Archived rows are read-only and can offer
  `[ continue with new room ]` when an OpenRouter key is stored.
- Active and archived rows come from one `buildSessionRow`. The variant
  supplies the directory tag (`[ active ]` on the active row,
  `[ readonly ]` on every archived row), the extra buttons for a playable
  row, and the remove function behind `[ confirm rm ]`. An archived row's
  "last played" time is its `lastPlayedAt`; an active row's is its
  `lastSavedAt`.
- Sort order: `ok` rows by `lastSavedAt`, newest first, then the rest by id.
- In the tree listing, `engine.dat` always comes last because it is the
  commit signal: it is written after the daemon files.
- `[ rm ]` confirms inline. It swaps to `[ confirm rm ] [ cancel ]`, and
  cancel puts `[ rm ]` back.
- `[ + new session ]` is cloned on each render to drop the previous render's
  listener. It mints a session, makes it active and routes to start.
- `dupSession` throws only on programmer error, so the dup handler swallows
  the error.
