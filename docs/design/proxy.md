# Proxy design notes

The Cloudflare Worker in `src/proxy/` carries the built SPA as static assets
(players load the game from GitHub Pages; the Worker serving it matters for
`wrangler dev` and the Playwright suite) and exposes an OpenAI-compatible `POST /v1/chat/completions` that forwards to OpenRouter with
the model pinned to `PINNED_MODEL` (`src/model.ts`). These notes cover the
rules and tradeoffs the code cannot state by itself.

## Routing (`worker.ts`)

- `OPTIONS` and `POST` on `/v1/chat/completions` are the API. `/diagnostics`
  takes the endgame "Save the AIs to USB" report (#19). Every other request
  goes to the `ASSETS` binding.
- There is no Worker-level 404. Unmatched paths go to `env.ASSETS.fetch` so the
  binding's `not_found_handling: single-page-application` can serve
  `dist/index.html` for client-side routes (#48). Non-POST verbs on the chat
  path fall through the same way.
- `/diagnostics` only validates and logs the payload. The v1 taxonomy is
  deliberately minimal; persisting to KV is left for a later iteration.

### Asset cache headers (`withAssetCacheHeaders`)

- `/assets/*` files are content-hashed by esbuild, so they get
  `public, max-age=<1 year>, immutable`. A new build produces new URLs, and
  clients holding old URLs can keep using them.
- Everything else (index.html and SPA fallbacks) gets
  `no-cache, must-revalidate`, so it always names the latest hashed bundles.
- An HTML response under `/assets/*` becomes a hard 404. It can only be the SPA
  fallback for a missing asset. Serving index.html with status 200 there makes a
  `<script>` or `<link>` load fail with an obscure `SyntaxError` as the browser
  parses HTML as JS or CSS. A real 404 fails fast.
- Non-2xx responses from the binding pass through untouched and keep whatever
  caching the binding chose.

## Bindings and configuration

- `OPENROUTER_API_KEY` is a secret (`wrangler secret put OPENROUTER_API_KEY`)
  and is never committed in `vars`. Without it the proxy answers 502.
- `ALLOWED_ORIGINS` is a comma-separated allow-list. Production lists only the
  deployed origin. For local dev, add ports in `.dev.vars` or with
  `wrangler dev --var ALLOWED_ORIGINS=...` rather than committing them.
- `RATE_GUARD_KV` holds the cost counters. It is bound in remote mode; see
  `AGENTS.md` "Local development" for `pnpm dev:local`.
- `PER_IP_DAILY_MICRO_USD_MAX`, `GLOBAL_DAILY_MICRO_USD_MAX`,
  `PRE_CHARGE_MICRO_USD` are optional. `configFromEnv` falls back to $1.00 per
  IP per day, $10.00 globally per day, and a $0.005 pre-charge.
- Every money value in `wrangler.jsonc` is an integer in micro-USD
  (1e-6 USD): `1000000` is $1.00. Production sets $1.00 per IP per day,
  $10.00 globally, and a $0.005 pre-charge.
- `RATE_GUARD_KV` is created in production with
  `wrangler kv namespace create RATE_GUARD_KV`; under Vitest the workers pool
  provides an in-process KV, so tests never touch the real namespace.

### `wrangler.jsonc` layout

- `build.command` runs `pnpm build` before Wrangler bundles the Worker, on
  every `wrangler dev` and `wrangler deploy`, so `dist/` always exists when
  the assets binding loads. `watch_dir: src/spa` re-runs it when SPA sources
  change during `wrangler dev`.
- `assets.run_worker_first: true` makes the fetch handler run for every
  request: it serves the API routes itself and delegates the rest to the
  `ASSETS` binding. Running first is what lets `withAssetCacheHeaders` attach
  `Cache-Control` to `/assets/*` (long, immutable, content-hashed) and to
  `index.html` (no-cache, since it pins the current hashed bundle).
- `assets.binding: "ASSETS"` exposes the binding as `env.ASSETS` so the
  Worker can call `env.ASSETS.fetch(request)` for unmatched paths; without it
  the `not_found_handling: single-page-application` fallback never fires for
  client-side routes such as `/endgame`.

## CORS (`cors.ts`)

- Origins must match exactly: no wildcards and no scheme or host
  normalisation. The env value is the source of truth.
- Unlisted or missing origins still get their normal response (204 for a
  preflight, the upstream status for a POST), with `Vary: Origin` and no
  `Access-Control-Allow-Origin`. The browser then blocks it.
- A preflight echoes `Access-Control-Request-Headers` back (falling back to
  `Content-Type`) and is cacheable for a day.
- `withCorsHeaders` rewraps `response.body` rather than reading the text, so
  streaming responses keep streaming.

## Chat completions pipeline (`openai-proxy.ts`)

`handleChatCompletions` runs its steps in order: require the key, parse, validate,
pre-charge, forward, then relay the whole or streamed response. Each failure
after the pre-charge refunds it.

- **Pricing lookup runs in parallel.** `getModelPricing` starts right after
  the pre-charge, alongside the upstream call, so reconciliation adds no
  latency. It is memoised per isolate, so after the first request it
  usually resolves immediately.
- **`stream_options.include_usage` is forced on for streams.** Without it
  OpenRouter sends no usage chunk and the pre-charge could never be
  reconciled. Caller-supplied `stream_options` fields are kept.
- **`usage.cost` wins over token-count pricing.** When OpenRouter reports
  `usage.cost` (USD), it already includes any prompt-cache discount the
  provider applied, so `resolveCostMicroUsd` uses it. Only without it does
  the proxy re-derive cost from token counts and `/models` pricing.
- **Cached-token counts are diagnostics only.** They are read from either
  the OpenAI shape (`prompt_tokens_details.cached_tokens`) or the Anthropic
  shape (`cache_read_input_tokens`) and logged as `[cache] ...`. They are
  never priced directly.
- **Missing or unparseable usage means a full refund**, not keeping the
  estimate.
- **Streaming settlement uses `ctx.waitUntil`.** The response is teed through
  a `TransformStream` that scans SSE `data:` lines for the usage chunk. Both
  the end-of-stream reconcile and the refund on a mid-stream upstream failure
  are handed to `ctx.waitUntil`, or the KV write can be lost once the
  response finishes. A regression test covers the refund.

## Cost guard (`rate-guard.ts`)

All accounting is in integer micro-USD (1 USD = 1e6). Two KV counters per UTC
day:

| Counter | Key | Default cap |
| --- | --- | --- |
| Per IP | `cost:ip:<YYYY-MM-DD>:<ip>` | $1.00 |
| Global | `cost:global:<YYYY-MM-DD>` | $10.00 |

- **Flow:** `preCharge` deducts a fixed estimate from both counters at
  request start. `reconcile` refunds the unused part once the actual cost is
  known. `refundFull` rolls the pre-charge back on failure.
- **Strict ceiling:** a request is denied when `current + preCharge > cap`.
  Landing exactly on the cap is allowed.
- **Over-charge is kept.** When the actual cost exceeds the pre-charge the
  counters are left alone. That is the accepted cost of defence; only
  unused pre-charge is ever refunded.
- **No atomic compare-and-swap.** Workers KV has none, so concurrent
  requests can briefly over- or under-count. This is accepted: the caps are
  a wallet guard, not billing.
- **Refunds hit the request-start day.** Keys are derived from the
  request's start time, so a stream that straddles midnight UTC refunds
  the day it was charged against.
- **25-hour TTL** keeps a counter alive for its whole UTC day with margin.
- A denial is a 429 with an OpenAI-shaped error (`code` is `per-ip-daily` or
  `global-daily`) and `Retry-After` set to the seconds until the next UTC
  midnight.

## Pricing (`pricing.ts`)

- Per-token prices come from OpenRouter's public `/models` endpoint as USD
  decimal strings and are scaled to micro-USD per token. Per-token values may
  be fractional. `computeCostMicroUsd` always rounds a request total **up**, so
  the caps are never silently under-charged.
- The result is memoised per isolate for 24 hours, and the fetch times out
  after 3 s.
- On fetch failure, stale cached pricing wins. On a cold start with no cache,
  `OVERESTIMATED_COLD_START_PRICING` (1 and 5 micro-USD per prompt and
  completion token, roughly $0.001 and $0.005 per 1k) is deliberately above
  typical GLM-4.7 pricing. The rate limit then fails closed rather than open.

## Tests

- Worker tests run in `@cloudflare/vitest-pool-workers`, so `RATE_GUARD_KV`
  is a real in-process KV. The cap and origin bindings the integration tests
  rely on (`20000` / `1000000` / `4000` micro-USD,
  `https://app.example,http://localhost:5173`) live in `vitest.config.ts`.
  The constants in `openai-proxy.test.ts` must match them.
- The outbound OpenRouter fetch is stubbed with `vi.stubGlobal("fetch")`.
  This works because the worker isolate shares `globalThis` with the test
  runner. Pricing is seeded through `_setPricingCacheForTests` so `/models`
  is never hit.
- KV writes made under `ctx.waitUntil` are awaited by polling
  (`waitForCounter`), not by fixed sleeps. Sleeps raced KV write visibility in
  Miniflare.
- The pool provides no `ASSETS` binding, so asset delegation (unknown routes,
  non-POST verbs on the chat path) is not covered in Vitest. The `wrangler
  dev` smoke probe covers it.
