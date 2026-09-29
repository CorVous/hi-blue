# Testing

Three test surfaces. Each has a different role; pick the right one when you change code.

## Vitest workers (`src/proxy/**/*.test.ts`)

Cloudflare Worker logic — routing, CORS, the chat-completions proxy and its SSE usage scanning, KV, rate-guard, pricing. Runs under `@cloudflare/vitest-pool-workers` with Miniflare bindings (see `vitest.config.ts`). Use this when you change anything under `src/proxy/`.

## Vitest jsdom (`src/**/*.test.ts` outside `src/proxy/`)

The `browser` project in `vitest.config.ts`. Unit-level coverage for SPA and content modules — pure logic, encoder/decoder round-trips, persistence, view selection (`current-view.ts`), streaming math. Fast, but jsdom is **not a real browser**: it does not catch real layout, real-DOM event timing, real-browser API gaps, or build-pipeline regressions.

The same `browser` project also runs `scripts/__tests__/**` and `evals/__tests__/**` (unit tests for the eval scoring modules, next to the evals they cover). `src/spa/__tests__/build.test.ts` is the exception: it runs in its own node-environment `build` project.

Shared fixtures: `src/spa/__tests__/fixtures/` (`local-storage.ts` with `makeLocalStorageStub` / `seedSessionInStub`, `await-ignoring-rejection.ts`, plus the static personas and content packs) and `src/spa/game/__tests__/fixtures/` (`make-test-pack.ts`, `make-game-state.ts`, and `prompt-sections.ts` for pulling the cardinal clause out of a prompt). Reuse them before writing a local builder.

### Round fuzz (`src/spa/game/__tests__/round-fuzz.test.ts`)

A seeded fuzz test that plays 20 games of up to 40 rounds through `GameSession.submitMessage`, on real packs from `generateDualContentPacks` (with `MockContentPackProvider`) and `TEST_PERSONAS`. Its mock LLM answers each turn with a random mix of calls built from the offered `availableTools` enums, junk calls (malformed JSON, retired or unknown tools, bad arguments, empty and reused ids), text-only turns and empty turns. `Math.random` is replaced by a seeded generator for the game's own draws. Every other game is "stormy": before most rounds it restores the session with the complication countdown at 1, so complications (and their collisions) happen every round instead of every 5–15.

After every round it checks: positions in bounds, nothing resting on an obstacle, every item held by one valid holder, the open grid connected, exhausted Daemons never prompted and never acting, satisfied Objectives staying satisfied, every tool call id in each request unique and followed by exactly one result, every offered call succeeding, and the composer lockout state rebuilt from `encodeRoundResult` events matching `isPlayerChatLockedOut`. Every fifth round it saves through `saveActiveSession`, loads through `loadSession` and deep-compares the whole state.

It runs in about two seconds and is deterministic. A failure names the seed and round; `BASE_SEED + n` reproduces game `n`. When the game gains a rule that one of these invariants should cover, add it here. If a change legitimately breaks one, fix the invariant, not the seed.

## Playwright e2e (`e2e/**/*.spec.ts`)

Live browser end-to-end against the built SPA on `http://localhost:8787`. Run with `pnpm smoke`; `playwright.config.ts` starts `pnpm build` followed by local Wrangler with a test API key, so no Cloudflare login or manual server is needed. Install the browser once with `pnpm exec playwright install chromium`. Outside CI an existing server may be reused: ensure port 8787 is not serving an unrelated or differently configured build. Use this when:

- You change anything under `src/spa/` that affects rendered DOM, user interaction, or the loaded-page experience — panel rendering, form behaviour, SSE streaming, round transitions, endgame overlay, lockouts, cap-hit handling.
- You touch the `assets` block in `wrangler.jsonc` or `scripts/build-spa.mjs` (the build/serve surface the e2e exercises).

**Vitest jsdom does not substitute for Playwright on these changes** — add or update a spec under `e2e/`.

### Stubbing gotcha: `page.route` vs `page.request.*`

Playwright has two HTTP contexts that share a cookie jar but route differently:

- **Page context** — requests originating from the browser (navigation, form submits, `fetch()` called from page JS, XHR). `page.route()` intercepts these.
- **API request context** (`page.request.*`, `context.request.*`) — a Node-side HTTP client that bypasses the browser entirely. **`page.route` does NOT see these.**

#### Stubbing LLM calls: use `stubChatCompletions`

The SPA's `BrowserLLMProvider` (via `src/spa/llm-client.ts`) calls
`${__WORKER_BASE_URL__}/v1/chat/completions`. Use
`stubChatCompletions` from `e2e/helpers` to intercept these:

```ts
import { stubChatCompletions } from "./helpers";

// Static word array — same reply for every AI call:
await stubChatCompletions(page, ["hello ", "world"]);

// Request-aware factory — distinct reply per successive call:
let callIndex = 0;
await stubChatCompletions(page, (_request) => {
  return COMPLETIONS[callIndex++ % COMPLETIONS.length].split(" ");
});
```

`stubChatCompletions` answers JSON-mode calls (persona synthesis and content
packs) with canned JSON built from the request, and answers every gameplay
turn with an SSE stream holding one `message` tool call to `blue` that
carries the joined words, then a usage chunk. The SPA paints each daemon
message whole, with no client-side pacing, so the stub does **not** need to
throttle delivery. `docs/design/e2e.md` ("Helpers") has the details and the
other stubs (`stubNewGameLLM`, `toolCallSseBody`).

`stubChatCompletions` only intercepts requests the SPA itself fires. If a spec
needs lower-level control, use `page.evaluate(() => fetch(...))` so the fetch
runs inside the page's runtime. Calling `page.request.post("/v1/chat/completions", …)`
will silently miss the stub and hit the real worker.
