# Testing

Three test surfaces. Each has a different role; pick the right one when you change code.

## Vitest workers (`src/proxy/**/*.test.ts`)

Cloudflare Worker logic — request/response, KV, SSE encoders, rate-guard. Runs under `@cloudflare/vitest-pool-workers` with Miniflare bindings (see `vitest.config.ts`). Use this when you change anything under `src/proxy/`.

## Vitest jsdom (`src/spa/__tests__/**/*.test.ts` and other `src/**/*.test.ts` outside proxy)

Unit-level coverage for SPA modules — pure logic, encoder/decoder round-trips, persistence, router, streaming math. Fast, but jsdom is **not a real browser**: it does not catch real layout, real-DOM event timing, real-browser API gaps, or build-pipeline regressions.

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

`stubChatCompletions` fulfils with `Content-Type: text/event-stream` and
OpenAI-format delta chunks (`choices[0].delta.content`), matching what the
SPA's streaming parser expects. The SPA's own token-pacing loop
(`TOKEN_PACE_MS × AI_TYPING_SPEED` in `src/spa/views/game.ts`) drives the
observable inter-token animation after the fetch resolves — the stub does
**not** need to throttle delivery.

`stubChatCompletions` only intercepts requests the SPA itself fires. If a spec
needs lower-level control, use `page.evaluate(() => fetch(...))` so the fetch
runs inside the page's runtime. Calling `page.request.post("/v1/chat/completions", …)`
will silently miss the stub and hit the real worker.
