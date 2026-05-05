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

So `stubGameTurn` (in `e2e/helpers/stubs.ts`) only intercepts requests the SPA itself fires — the natural pattern is "fill `#prompt`, click `#send`", which causes the SPA to `fetch("/game/turn")` from page JS. If a spec needs lower-level control, use `page.evaluate(() => fetch(...))` so the fetch runs inside the page's runtime. Calling `page.request.post("/game/turn", …)` will silently miss the stub and hit the real worker.

`newWinImmediatelyGame` (in `e2e/helpers/factories.ts`) uses `page.request.post("/game/new", …)` deliberately — it wants the real worker, not a stub, and only needs the response cookie in the BrowserContext jar.
