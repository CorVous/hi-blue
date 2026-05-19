## Problem Statement

Tuning the game (prompt iteration, personality synthesis, complication pacing, content-pack debugging) requires the developer to reason about three Daemons' parallel state without seeing it. Today the only diagnostic surfaces are: (a) two `__DEV__`-gated `console.log` lines in `src/spa/game/browser-llm-provider.ts:78,90` for cache-hit % and per-turn tool-name arrays, and (b) a hidden `?debug=1` action-log aside (`src/spa/index.html:187`, `src/spa/routes/game.ts:1137-1144`) showing a flat list of per-turn action descriptions. Neither surface exposes the most diagnostic state — last system prompt sent, last raw completion, last full tool-call args, per-Daemon in-flight LLM status, active complications targeting a specific Daemon, the spatial layout the Daemons are reasoning about, which Daemons see what — and answering any of those questions today requires opening the devtools, juggling `localStorage` inspection, scrolling transcripts, and reading streamed `console.log`s in parallel. The cost of *not* having a tuning surface compounds with every prompt change.

## Solution

Build a `__DEV__`-gated Daemon dev inspector that consolidates engine-side and LLM-side per-Daemon state into the running game UI. The inspector adds three regions to the existing layout: a per-Daemon footer under each `.ai-panel` (summary line + five `<details>` disclosures), a god-view 5×5 ASCII map between `#panels` and `#composer` with click-to-focus cone tinting, and a game-global strip above the map. During pending-bootstrap (no `GameState` yet) the inspector shows a lightweight strip with LLM-call lifecycle state. The inspector is compiled out of production builds via the existing `__DEV__` esbuild `define` — there is no runtime flag, no `?debug=1`, no localStorage opt-in (see [ADR 0013](../adr/0013-dev-inspector-build-time-only.md) for the gating rationale). As part of this work the existing `#action-log` aside, its `?debug=1` toggle path, and the two console.logs in `browser-llm-provider.ts` are removed — the inspector supersedes all three.

## User Stories

### Developer — engine-side per-Daemon state

1. As a developer tuning the game, I want each Daemon's most recent tool-call names visible at a glance under their chat panel, so that I can compare what all three Daemons just did without scrolling three transcripts.
2. As a developer, I want to see each Daemon's active complications (sysadmin directive, tool disable + which tool, chat lockout) as compact chips in their footer summary, so that I can correlate behavioural changes with what's currently acting on them.
3. As a developer, I want a god-view 5×5 ASCII map showing all Daemons (persona-coloured, with facing arrows), obstacles, objective objects, objective spaces, and interesting objects, so that I can ground-truth what the Daemons are reasoning about spatially.
4. As a developer, I want to hover any cell on the map and see a tooltip with the entity name, id, satisfaction state, and holder (where applicable), so that I can identify entities the 2-character glyphs cannot label.
5. As a developer, I want to click a `[ focus cone ]` button in any Daemon's footer to tint that Daemon's cone cells on the map with their persona colour, so that I can see at-a-glance what they can and cannot perceive.
6. As a developer, I want clearing the focus to return the map to god-view (no tint), so that "what's in the world" and "what does Daemon X see" are both one click apart from each other.
7. As a developer, I want a game-global strip above the map showing round number, complication countdown, active pack (A/B), setting/weather/time-of-day, total game cost, objective satisfaction count, and active-complication count, so that game-wide context is visible without me having to open devtools.

### Developer — LLM-side per-Daemon state

8. As a developer, I want a per-Daemon in-flight pip (`● in-flight` / `○ idle` / `✕ errored`) in each footer summary, so that I can tell when a Daemon's LLM call has started, is streaming, has completed, or has failed without inferring from transcript animation.
9. As a developer, I want each footer's summary to show the last completed round's prompt tokens, completion tokens, cache hit %, and cost in a compact `[tok 4128→89 cache 78% $0.0021]` form, so that I can spot a runaway prompt or lost cache hit by comparing the three Daemons' numbers in parallel.
10. As a developer, I want a `<details>` in each footer for the *full system prompt sent on the last completed round*, defaulting closed, so that I can inspect why a Daemon generated what it did.
11. As a developer, I want a `<details>` for the *full raw assistant completion text* on the last completed round, so that I can see what the LLM emitted before tool-call parsing.
12. As a developer, I want a `<details>` for the *last completed round's tool calls with full argument JSON*, so that I can see exactly what each tool invocation requested.
13. As a developer, I want a `<details>` for the *last LLM error text* (status code + body), so that I can diagnose a stuck Daemon without leaving the inspector.
14. As a developer, I want a `<details>` for the Daemon's persona card (handle, colour swatch, both temperaments, persona goal, synthesised blurb), so that I can refresh my memory of which Daemon is which without scrolling to game start.

### Developer — lifecycle

15. As a developer, I want the inspector visible during active game, cap-hit, and end-game, so that I can inspect state at any of those moments — especially end-game, where the final state is otherwise discarded.
16. As a developer, I want a lightweight pending-bootstrap strip (in-flight pip + currently-running call name + retry count + elapsed seconds + last error text) during pending-bootstrap, so that I can diagnose a stuck content-pack or persona-synthesis call without `console.log`s.
17. As a developer, I want the inspector hidden on the sessions picker, start screen, and bootstrap-recovery screens (no live LLM activity or game state to show), so that the picker and start UX stay clean.

### Developer — sticky interaction

18. As a developer, I want each `<details>` disclosure's open/closed state to persist across round updates within the same session, so that I can leave "last system prompt" open for *xqr9 and watch it evolve round-over-round without re-clicking after each turn.
19. As a developer, I want the open/closed state to be per-Daemon (not synced across all three), so that I can have one Daemon's prompt open without three full prompts cluttering my screen.

### Developer — cleanup

20. As a developer, I want the obsolete `#action-log` aside, its `?debug=1` toggle, its event handler, and its CSS to be removed in the same change, so that the codebase has one dev surface instead of two.
21. As a developer, I want the two `console.log` lines in `browser-llm-provider.ts` removed, so that the cache % and tool-call signals live only in the inspector and don't double up in devtools console.

## Design Decisions

### Gating

- **`__DEV__`-only.** No runtime flag. Inspector code is tree-shaken out of production builds. See [ADR 0013](../adr/0013-dev-inspector-build-time-only.md) for rationale and rejected alternatives (`?debug=1`, AND'd, OR'd, new flag, repurposing `?debug=1`).

### Layout

- **Three regions, top-to-bottom inside `#main`:**
  1. `#panels` (existing three `.ai-panel` columns, unchanged).
  2. **Per-Daemon dev footer** appended to each `.ai-panel`'s bottom. Summary line + five `<details>`.
  3. **Game-global strip** between `#panels` and the map.
  4. **God-view map** between the global strip and `#composer`.
  5. `#composer` (existing, unchanged).
- During pending-bootstrap, only the **pending-bootstrap strip** is rendered (single line, no map, no footers — there's no game state yet).

### Per-Daemon footer summary line

- **Order (left-to-right):** in-flight pip → last-round tool calls (names only, comma-separated) → last-round LLM line (`[tok N→M cache P% $C]`) → active-complications chips (`[sysadm-dir]` `[tool-dis:message]` `[chat-lock]`).
- **Reads as:** state-of-this-Daemon-now → what-it-just-did → what-it-cost → what's-acting-on-it.
- **Not in summary:** position/facing (redundant with map), log entry count (low signal), per-round budget delta (redundant with cost field).
- **Round labelling:** each footer's "last" = the most recent completed turn *for that Daemon specifically* (Daemons take turns within a round, so three footers may show three different round numbers simultaneously). Label disclosures with the round number they cover (e.g. `<summary>last prompt — round 7</summary>`).

### Per-Daemon footer `<details>` disclosures

In stable order, all default closed:

1. **Last system prompt** — full text built by `prompt-builder.ts` for this Daemon's most recent round.
2. **Last raw completion** — `assistantText + reasoningParts.join("")` from the most recent `RoundTurnResult`.
3. **Last tool calls** — formatted `name({argsJson})` per call.
4. **Last error** — empty when none; full text + status code when present.
5. **Persona card** — handle, colour swatch, both temperaments, persona goal, synthesised blurb. Static within a session.

### God-view map

- **Cell size: 2 chars per cell.** 5×5 grid with a `##` boundary wall ring (per CONTEXT.md `Wall` — represents what Daemons perceive when an OOB cell falls in their cone).
- **Glyphs:**
  - Daemons: persona-coloured `@` + facing arrow (`^v<>`). E.g. `@^` for north-facing.
  - Obstacles: `##`.
  - Objective object: `*` + ` ` (or `**` if on its paired objective space — satisfied state).
  - Objective space: `+` + ` `.
  - Interesting object: `o` + ` `.
  - Floor: `.` + ` ` (or two dots, picked for readability).
- **Stacking precedence** (when multiple entities occupy the same cell): Daemon > object > space > floor.
- **Hover tooltip per cell** (CSS-positioned `:hover` div, not native `title=` — the latter has ~500ms delay and is ugly). Tooltip contents: `name · id · satisfaction state · holder (if applicable)` for entities; `floor (r,c)` for empty cells; `*xqr9 — facing N — holds: rusted lever (#obj-1)` for Daemons.

### Cone focus

- **`[ focus cone ]` button** in each per-Daemon footer (not a click on the panel — that already inserts an addressee mention at `routes/game.ts:1109`, would conflict).
- **Visual encoding:** background-tint the cone cells with the focused Daemon's persona colour (low alpha, behind the glyphs). Truth-always — non-cone cells continue to show ground truth so the developer can see *what the Daemon is missing*.
- **Cone cells are computed via `projectCone(position, facing)` from `src/spa/game/cone-projector.ts`** — reuse the existing utility; do not re-implement.
- **Clearing focus:** clicking the same button again, or clicking another Daemon's focus button, or pressing Escape with focus active. Cleared state = god-view, no tint.

### Game-global strip

- **Two-line layout:**
  - Line 1: `round N · countdown M · pack A · setting / weather / time-of-day`
  - Line 2: `cost $X.XX · obj K/J satisfied · L active complications`
- Long lists (every objective with its kind and satisfaction state; every active complication with its parameters and resolution round) live in a `<details>` *inside* the strip, default closed. Same summary-plus-disclosure pattern as the footers.

### Pending-bootstrap strip

- **Single line, no `<details>`:** `[● fetching] content-pack · retry 1/3 · 7.2s elapsed · last error: 502 upstream`.
- Reads from `getPendingBootstrap()` (`src/spa/game/pending-bootstrap.ts:86`) for status + error; new wiring needed for "currently-running call name" and "elapsed seconds" (timestamp at start, polled-relative now).
- The pending strip *replaces* the full inspector during pending state; the full inspector takes over the moment `GameState` is available.

### Update cadence

- **End-of-round events** drive: last tool calls, LLM line (tokens/cost/cache), `<details>` content for prompt/completion/tool-calls/error, game-global strip's round/cost/objectives/complications. Hook into the existing round event loop at `src/spa/routes/game.ts:1450+`.
- **Mid-round in-flight pip** driven by LLM provider lifecycle edges (new — see Module Interfaces).
- **Sticky-per-element:** update content in place (replace text inside existing `<pre>`s, etc.), do not re-render whole footer blocks. This is what preserves `<details>` open state across rounds.

### Lifecycle

- **Inspector rendered:** active-game, cap-hit, end-game.
- **Pending-bootstrap strip rendered:** during pending-bootstrap.
- **Nothing rendered:** sessions picker, start screen, bootstrap-recovery.

## Module Interfaces (conceptual)

### New observability surface on `RoundLLMProvider`

The in-flight pip requires lifecycle edges the provider does not emit today (`browser-llm-provider.ts` has only `onUsage` from inside `streamCompletion`). Add an optional callback to the `streamRound` signature in `src/spa/game/round-llm-provider.ts`:

```ts
type LifecyclePhase =
  | { phase: "started"; daemonId?: string }
  | { phase: "first-token"; daemonId?: string }
  | { phase: "completed"; daemonId?: string }
  | { phase: "errored"; daemonId?: string; error: unknown };

interface RoundLLMProvider {
  streamRound(
    messages: OpenAiMessage[],
    tools: OpenAiTool[],
    onDelta?: (text: string) => void,
    daemonId?: string,
    onLifecycle?: (event: LifecyclePhase) => void,   // NEW
  ): Promise<RoundTurnResult>;
}
```

- `BrowserLLMProvider.streamRound` fires `started` before `streamCompletion`, `first-token` on first `onDelta` invocation, `completed` after `streamCompletion` resolves, `errored` in the `catch` path with the raw error.
- `MockRoundLLMProvider.streamRound` fires the same edges synchronously for tests (`started`, `first-token` if `assistantText` is non-empty, `completed`).
- The new callback is `__DEV__`-gated at the *consumer* (the inspector wires it; production code doesn't). The interface stays present in prod (it's optional), but no caller invokes it.

### Inspector module structure

New directory `src/spa/dev-inspector/`:

- **`index.ts`** — `renderInspector(root, { session, pendingBootstrap }): void`. Top-level entry. Decides which region(s) to render based on lifecycle state. No-op outside `__DEV__`.
- **`daemon-footer.ts`** — `renderDaemonFooter(panelEl, aiId, state)`; `updateDaemonFooterSummary(panelEl, aiId, summaryFields)`; `updateDaemonFooterDetails(panelEl, aiId, detailFields)`.
- **`world-map.ts`** — `renderWorldMap(containerEl, gameState, focusedAiId | null)`; `updateMapCellTooltips(...)`; `setMapFocus(aiId | null)`.
- **`game-strip.ts`** — `renderGameStrip(containerEl, gameState)`; `updateGameStripSummary(...)`.
- **`pending-strip.ts`** — `renderPendingStrip(containerEl, pendingBootstrap, callMeta)`.
- **`cone-mask.ts`** — pure: `coneMaskForDaemon(gameState, aiId): Set<string>` returning a set of `"r,c"` cell keys. Reuses `projectCone`; lives in inspector so the inspector can be deleted as a unit.

### Integration points

- **`src/spa/index.html`** — add three container divs inside `#main`: `<div id="dev-game-strip" hidden></div>`, `<div id="dev-world-map" hidden></div>`, plus a `<div class="dev-daemon-footer" hidden></div>` appended *inside* each `.ai-panel`. All `hidden` by default; inspector reveals them in `__DEV__`.
- **`src/spa/routes/game.ts`** — call `renderInspector(...)` after `renderGame` completes; subscribe to the same event loop the transcript renderer uses (around line 1450) for round-end updates; subscribe to lifecycle edges from the LLM provider (new wiring) for in-flight-pip updates.
- **`src/spa/game/browser-llm-provider.ts`** — implement lifecycle edges; delete the two `console.log` lines (`:78`, `:90`).
- **`src/spa/styles.css`** — add inspector styles (footer, map, strip, tooltip, cone tint); delete `#action-log` styles (`:713-`).

### Deletions

- `#action-log` aside in `src/spa/index.html:187`.
- Toggle in `src/spa/routes/game.ts:1137-1144`.
- Event handler in `src/spa/routes/game.ts:1461-1468`.
- Clear-on-session-change at `src/spa/routes/game.ts:256`.
- Hide-on-game-ended at `src/spa/routes/game.ts:1536-1542`.
- `#action-log` CSS at `src/spa/styles.css:713-`.
- `?debug=1` URL param read at `src/spa/routes/game.ts:1137`.
- Two `console.log` lines at `src/spa/game/browser-llm-provider.ts:78-83`, `:90-102`.
- `action_log` event type if it has no remaining consumers (verify against `round-result-encoder.ts:50` — if the type is still emitted, leave it; the inspector doesn't need a flat action stream).

## Testing Decisions

### Modules to be unit tested

- **`cone-mask.coneMaskForDaemon`** — given a `GameState` fixture and an `AiId`, returns the correct set of `"r,c"` keys for the Daemon's cone (including OOB wall cells inside the cone). Prior art: `src/spa/game/__tests__/cone-projector.test.ts`.
- **Inspector renderers (`daemon-footer`, `world-map`, `game-strip`, `pending-strip`)** — pure DOM tests: given a fixture state, asserted output DOM contains the expected fields/glyphs/tooltips. Use jsdom (existing vitest setup). Verify sticky-per-element behaviour: open a `<details>`, dispatch a round-update event, assert `<details>.open === true`.
- **`BrowserLLMProvider` lifecycle edges** — given a mock `streamCompletion`, assert `onLifecycle` fires with `started` before the first delta, `first-token` on the first delta, `completed` on resolve, `errored` on reject. Prior art: existing browser-llm-provider tests.
- **`MockRoundLLMProvider` lifecycle edges** — synchronous edges fire in correct order for the existing mock-result shapes.

### Modules not unit tested at this level

- **Inspector layout integration** — covered by an e2e smoke test asserting the three inspector regions exist in the DOM under a `__DEV__` build with a mock session.
- **Tooltip hover positioning** — visual only; tested manually in dev.
- **Cone tint colour application** — visual; the focus-mask test verifies the *cell set*, not the CSS.
- **In-flight pip transitions visually** — covered transitively by the lifecycle-edge unit tests plus a smoke e2e.

### Build-time gating

- **A new test in `src/spa/__tests__/build.test.ts`** that asserts a `__DEV__=false` build of the SPA bundle does *not* contain inspector-specific identifiers (e.g. `renderInspector`, `dev-daemon-footer`). This is the test that proves the gating works — if it ever passes when it shouldn't, the inspector has leaked into prod. Prior art: existing `build.test.ts` already exercises esbuild output.

### Existing test impact

The vitest `test-setup.ts` stubs `__DEV__ = true` (`src/spa/test-setup.ts:9`), so all existing tests will run with the inspector active. Existing assertions that count DOM elements, query selectors, or screenshot snapshots may break when the inspector adds containers. Mitigation: inspector containers default `hidden`; the inspector reveals them only when there's a session/pending-bootstrap to render against. Tests that mount the game route with a populated session will need a sweep to confirm no spurious matches.

## Implementation Order

Recommended build seams, each independently shippable and testable:

1. **`RoundLLMProvider` lifecycle edges.** Add `onLifecycle` to the interface and both implementations. Unit tests prove the edges fire. No inspector code yet — this is the foundation that the in-flight pip will hook into later.
2. **Inspector skeleton + `__DEV__` gating.** Add the three container divs to `index.html`, create `src/spa/dev-inspector/index.ts` with `renderInspector` as a no-op-in-prod. The build-time gating test goes in at this step and stays green for the rest of the work.
3. **Game-global strip.** Smallest renderer; mostly read-from-`getState`. Validates the read-from-getState pattern end-to-end.
4. **Per-Daemon footer summary (no `<details>`).** Wire to the round event loop and to lifecycle edges. Validates the per-element in-place update pattern.
5. **Per-Daemon footer `<details>` disclosures.** Five disclosures, sticky-per-element. Includes per-Daemon round labelling.
6. **God-view map (no cone focus).** 5×5 grid, glyphs, persona-colour Daemons, walls, hover tooltips.
7. **Cone focus.** `[ focus cone ]` button per footer, persona-colour tint, clear-on-second-click or Escape.
8. **Pending-bootstrap strip.** Separate render path for pending state; reads from `getPendingBootstrap()`.
9. **Cleanup pass.** Delete `#action-log` aside, its toggle, its event handler, its CSS, its session-change clear, its game-ended hide. Delete `?debug=1` read. Delete the two `console.log` lines in `browser-llm-provider.ts`. Verify no existing test depends on `#action-log`'s DOM presence.

Each step can be its own PR (and each is a natural issue if the work is broken up via `/to-issues`). Steps 1–8 are additive — the existing UI continues to work; the inspector just adds surface. Step 9 is the only removal step and depends on 1–8 landing.

## Out of Scope

- **Live-ops diagnostics in production.** The inspector is `__DEV__`-only and explicitly does not solve "a player reports weird behaviour on the live site". A separate live-ops surface (auth-gated, read-only against another user's session, audit-logged) is a different design and is not on this PRD's roadmap. See ADR 0013.
- **Scrubbing back through round history.** The inspector always shows "last round" for each Daemon; there's no prev/next button. The conversation log in each transcript is the history channel.
- **Editable inspector fields.** The inspector is strictly read-only. No "force a complication", no "edit budget", no "advance round" buttons. Mutation belongs in a different tool.
- **Persistent open-state across page reloads.** `<details>` open-state is sticky within a session but reset on reload. Persisting to localStorage is overkill for a dev tool.
- **Mobile or narrow-viewport layouts.** Inspector targets desktop dev workflows. No responsive design work for sub-768px viewports.
- **Replacing the on-screen `.panel-budget` chip** in each `.ai-panel` header. That's player-facing; inspector duplicates the data in the footer summary's LLM line, which is fine — the two surfaces serve different audiences.
- **Persona card editability.** Showing persona blurb / temperaments / persona goal is read-only display; no "regenerate persona" or "edit blurb" actions.
- **Renaming `src/spa/routes/`.** Tracked separately as [#435](https://github.com/CorVous/hi-blue/issues/435) so it doesn't bloat this work's diff.

## Further Notes

- **Branch:** `claude/daemon-state-gui-d9VXJ`. ADR 0013 is already committed on this branch.
- **Companion ADR:** [`docs/adr/0013-dev-inspector-build-time-only.md`](../adr/0013-dev-inspector-build-time-only.md) records the gating decision.
- **Companion issue:** [#435](https://github.com/CorVous/hi-blue/issues/435) for the `src/spa/routes/` rename — separate work, queued for after this lands.
- **The grilling session that produced this PRD** worked through 17 design decisions (gating, scope, layout, footer placement, map presence, focus mechanic, click-conflict, footer real-estate, mid-round vs end-of-round updates, summary fields, `<details>` sections, cell size, cone visualisation, hover interactivity, global-strip placement, lifecycle visibility, sticky-open `<details>`, wall rendering, pending-strip contents). The Design Decisions and User Stories sections above are the canonical record of those calls; the conversation is recoverable from git log around the ADR commit.
- **CONTEXT.md is not updated** by this work — the inspector reuses existing domain language (Daemon, Cone, Conversation log, Persona) without introducing player-meaningful terms. The inspector itself is an implementation feature, not a domain concept.
- **The inspector's per-Daemon footer round labelling** (each footer shows its Daemon's most recent completed turn, which may be a different round number across the three footers) is the right honest representation but may look unfamiliar at first. Worth a comment in the renderer.
- **The new `onLifecycle` callback** is the only interface change that ships into prod (the signature lives in `round-llm-provider.ts`, which is non-`__DEV__`-gated). The callback is optional and no production caller invokes it, so the prod runtime cost is zero, but the type surface area does grow slightly.
- **Build seam #1 (lifecycle edges) is the only step that touches production code paths.** Steps 2–8 add `__DEV__`-only modules; step 9 deletes already-`__DEV__`-only or `?debug=1`-only code. Production behaviour is unchanged by everything except step 1, and step 1 only adds an optional callback.
