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
  deliberately minimal; persisting to KV is left for a later iteration. The
  logged summary is cut to 2,000 characters, since the endpoint is
  unauthenticated and anyone can post to it.

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
  IP per day, $10.00 globally per day, and a $0.005 pre-charge. A value that
  is empty, not a finite number, or negative also falls back to its default
  (`numOr`). Without that guard a typo becomes `NaN`, every `>` comparison
  with `NaN` is false, and the cap silently stops denying anything. The defaults
  are integer literals (`1_000_000`, `10_000_000`, `5_000`) rather than
  products of `USD_TO_MICRO_USD`, because the counters are written to KV as
  `String(counter + preCharge)` and a fractional default would corrupt them.
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
pre-charge, forward, then relay the whole or streamed response. A failure
before the upstream has produced anything (network error, non-2xx status,
unreadable whole body) refunds the pre-charge. A stream that breaks part-way
does not; see "Streaming settlement" below.

- **`stream` must be a boolean when present.** Anything else is a 400 before
  the pre-charge. The proxy decides between the whole and streamed relay with
  `stream === true`, but forwards the caller's value unchanged, so a truthy
  non-boolean such as `"true"` could make OpenRouter stream while the proxy
  read the SSE text as one JSON body, found no usage, and refunded in full.
- **Upstream status mapping.** A 4xx from OpenRouter (bad request, auth,
  payment, provider rate limit) is passed through with its status, body and
  `Retry-After`, so the client sees the real cause and can honour the retry
  hint. A 5xx, or any other non-2xx, becomes a 502 `upstream_error`. A
  network failure is also a 502, with a fixed message: the underlying error
  is logged, not echoed, because it can name internal hosts. The SPA only
  treats a 429 as the spend cap when its body carries the proxy's own
  `rate_limit_exceeded` type and a `per-ip-daily` or `global-daily` code
  (`parseCapHitFromResponse`), so a passed-through provider 429 is an
  ordinary, retryable failure rather than the cap-hit screen.

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
- **Missing or unparseable usage on a completed response means a full
  refund**, not keeping the estimate. A body or SSE `data:` line that parses
  to JSON but not to an object (`null`, a number, a string) counts as having
  no usage; reading `.usage` off it would throw, turning the whole-response
  path into a 500 with no CORS headers and no refund, and erroring the
  stream.
- **Streaming settlement uses `ctx.waitUntil`.** The response is teed through
  a `TransformStream` that scans SSE `data:` lines for the usage chunk, with
  one streaming `TextDecoder` so a multi-byte character split across chunks
  decodes correctly. Both the end-of-stream reconcile and the settlement of a
  broken stream are handed to `ctx.waitUntil`, or the KV write can be lost
  once the response finishes.
- **A broken stream is never refunded.** When the pipe errors (the upstream
  drops, or the client disconnects), OpenRouter has usually already billed
  for the tokens generated so far. If the usage chunk was already seen, the
  stream settles on it like a completed one. Otherwise the pre-charge is kept
  as the estimate. Refunding here would let a client get generations for free
  by aborting each request just before the end. Regression tests cover both
  cases.

## Cost guard (`rate-guard.ts`)

All accounting is in integer micro-USD (1 USD = 1e6). Two KV counters per UTC
day:

| Counter | Key | Default cap |
| --- | --- | --- |
| Per IP | `cost:ip:<YYYY-MM-DD>:<ip>` | $1.00 |
| Global | `cost:global:<YYYY-MM-DD>` | $10.00 |

- **Flow:** `preCharge` adds a fixed estimate to both counters at request
  start. `reconcile` then moves both counters by the signed difference
  between the actual cost and the pre-charge, through `adjustCharge`: unused
  pre-charge is refunded and any overage is added. `refundFull` is
  `adjustCharge` by minus the pre-charge. Counters never go below zero.
- **Strict ceiling:** a request is denied when `current + preCharge > cap`.
  Landing exactly on the cap is allowed. An overage can push a counter past
  the cap; the next request is then denied.
- **Overage is charged.** The caps are in dollars, so the counters must track
  what was actually spent. If only the pre-charge were kept, each request
  would count as at most $0.005 whatever it cost, and the caps would limit
  request counts instead of spend.
- **Per-IP key.** The `CF-Connecting-IP` value is keyed by
  `ipRateLimitSubject`: IPv4 as-is, IPv6 by its /64 prefix (for example
  `2001:db8:1:2::/64`), and an IPv4-mapped IPv6 address by its IPv4 part. A
  single IPv6 host usually controls a whole /64, so keying the full address
  would let one client rotate through fresh per-IP budgets.
- **Corrupt counters deny.** A counter value in KV that is not a finite
  number reads as infinite: `preCharge` denies with that counter's reason,
  and `adjustCharge` never writes a non-finite value back, so the bad value
  is not replaced by `NaN`. This fails closed, like the cold-start pricing
  below; the cost is that the affected IP (or, for the global counter,
  everyone) is denied until the 25-hour TTL expires or someone deletes the
  key. The proxy itself never writes such a value, so this only guards
  against manual edits.
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
  the pinned model's pricing. The rate limit then fails closed rather than open.

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
