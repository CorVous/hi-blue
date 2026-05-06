# Testing

Three test surfaces. Each has a different role; pick the right one when you change code.

## Vitest workers (`src/proxy/**/*.test.ts`)

Cloudflare Worker logic — request/response, KV, SSE encoders, rate-guard. Runs under `@cloudflare/vitest-pool-workers` with Miniflare bindings (see `vitest.config.ts`). Use this when you change anything under `src/proxy/`.

## Vitest jsdom (`src/spa/__tests__/**/*.test.ts` and other `src/**/*.test.ts` outside proxy)

Unit-level coverage for SPA modules — pure logic, encoder/decoder round-trips, persistence, router, streaming math. Fast, but jsdom is **not a real browser**: it does not catch real layout, real-DOM event timing, real-browser API gaps, or build-pipeline regressions.

## Playwright e2e (`e2e/**/*.spec.ts`)

Live browser end-to-end against `pnpm build` + `wrangler dev` on `:8787` — the production-shaped surface (built SPA from `dist/` served by the same Worker that handles the API). Run with `pnpm test:e2e`. Use this when:

- You change anything under `src/spa/` that affects rendered DOM, user interaction, or the loaded-page experience — panel rendering, form behaviour, SSE streaming, phase transitions, endgame overlay, the `/endgame` route, lockouts, cap-hit handling.
- You touch the `assets` block in `wrangler.jsonc` or `scripts/build-spa.mjs` (the build/serve surface the e2e exercises).

**Vitest jsdom does not substitute for Playwright on these changes** — add or update a spec under `e2e/`.

`RALPH_QA.md` lists manual flows that should migrate to `e2e/` over time. When you automate one, flip its checkbox in `RALPH_QA.md` and link the spec.

### Stubbing gotcha: `page.route` vs `page.request.*`

Playwright has two HTTP contexts that share a cookie jar but route differently:

- **Page context** — requests originating from the browser (navigation, form submits, `fetch()` called from page JS, XHR). `page.route()` intercepts these.
- **API request context** (`page.request.*`, `context.request.*`) — a Node-side HTTP client that bypasses the browser entirely. **`page.route` does NOT see these.**

#### Stubbing LLM calls: use `stubChatCompletions`

The SPA's `BrowserLLMProvider` (via `src/spa/llm-client.ts`) calls
`${__WORKER_BASE_URL__}/v1/chat/completions` — **not** `/game/turn`. Use
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
(`TOKEN_PACE_MS × AI_TYPING_SPEED` in `src/spa/routes/game.ts`) drives the
observable inter-token animation after the fetch resolves — the stub does
**not** need to throttle delivery.

`stubChatCompletions` only intercepts requests the SPA itself fires. If a spec
needs lower-level control, use `page.evaluate(() => fetch(...))` so the fetch
runs inside the page's runtime. Calling `page.request.post("/v1/chat/completions", …)`
will silently miss the stub and hit the real worker.

`newWinImmediatelyGame` (in `e2e/helpers/factories.ts`) uses `page.request.post("/game/new", …)` deliberately — it wants the real worker, not a stub, and only needs the response cookie in the BrowserContext jar.
