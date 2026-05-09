import {
	buildPreflightResponse,
	parseAllowedOrigins,
	withCorsHeaders,
} from "./cors";
import { handleChatCompletions } from "./openai-proxy";

/** Shape of the bindings/env this Worker expects. */
interface Env {
	/** KV namespace backing the rate-limit and daily-cap guards. */
	RATE_GUARD_KV: KVNamespace;
	/**
	 * Secret for the OpenRouter API. Provision via:
	 *   wrangler secret put OPENROUTER_API_KEY
	 * Intentionally not committed in vars.
	 */
	OPENROUTER_API_KEY?: string;
	/** Cost-guard configuration knobs in micro-USD; all optional, defaults in configFromEnv. */
	PER_IP_DAILY_MICRO_USD_MAX?: string;
	GLOBAL_DAILY_MICRO_USD_MAX?: string;
	PRE_CHARGE_MICRO_USD?: string;
	/**
	 * Comma-separated list of allowed CORS origins for POST /v1/chat/completions.
	 * Example (wrangler.jsonc): "https://corvous.github.io"
	 * For local dev, set additional origins in .dev.vars or via:
	 *   wrangler dev --var ALLOWED_ORIGINS=http://localhost:5173
	 * without committing local ports to the production config.
	 */
	ALLOWED_ORIGINS?: string;
	/**
	 * Static-assets binding automatically provided by Cloudflare when an
	 * `assets` block is declared in wrangler.jsonc. Used to delegate any
	 * request that is not an API route so that the assets binding can serve
	 * matching static files or fall back to dist/index.html via
	 * not_found_handling: single-page-application.
	 */
	ASSETS: Fetcher;
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// ── OPTIONS /v1/chat/completions — CORS preflight ────────────────────────
		// Handles browser preflight requests before the actual POST.
		// Returns 204 with full CORS headers for allow-listed origins; for
		// unlisted origins, returns 204 with Vary: Origin only (no ACAO).
		if (
			url.pathname === "/v1/chat/completions" &&
			request.method === "OPTIONS"
		) {
			return buildPreflightResponse(request, parseAllowedOrigins(env));
		}

		// ── POST /v1/chat/completions ─────────────────────────────────────────────
		// OpenAI-compatible endpoint: pins model to z-ai/glm-4.7-flash and
		// forwards the request to OpenRouter. Streams the response back unchanged.
		if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
			const allowed = parseAllowedOrigins(env);
			const resp = await handleChatCompletions(
				request,
				env,
				env.RATE_GUARD_KV,
				ctx,
			);
			return withCorsHeaders(resp, request, allowed);
		}

		if (url.pathname === "/diagnostics") {
			if (request.method !== "POST") {
				return new Response("Method Not Allowed", { status: 405 });
			}

			let body: unknown;
			try {
				body = await request.json();
			} catch {
				return new Response("Invalid JSON", { status: 400 });
			}

			const payload = body as Record<string, unknown>;

			if (typeof payload.downloaded !== "boolean") {
				return new Response("Missing or invalid field: downloaded", {
					status: 400,
				});
			}
			if (typeof payload.summary !== "string" || payload.summary.length === 0) {
				return new Response("Missing or invalid field: summary", {
					status: 400,
				});
			}

			// v1 taxonomy is intentionally minimal (TBD per PRD).
			// Log the payload; a future iteration can persist to KV.
			console.log(
				`[diagnostics] downloaded=${payload.downloaded} summary=${payload.summary}`,
			);

			return new Response(null, { status: 200 });
		}

		// Delegate to the assets binding for any unmatched path. This allows
		// the assets binding's not_found_handling: single-page-application to
		// serve dist/index.html for SPA client-side routes (e.g. /endgame)
		// instead of the Worker returning a hard 404. Cache-Control is
		// rewritten so content-hashed bundles can live in CDN/browser caches
		// indefinitely while index.html is always revalidated.
		return withAssetCacheHeaders(url, await env.ASSETS.fetch(request));
	},
} satisfies ExportedHandler<Env>;

/**
 * Rewrite Cache-Control on asset responses based on path:
 *   /assets/*  → public, max-age=31536000, immutable  (filenames are
 *                content-hashed by esbuild, so a new commit produces new URLs
 *                and old URLs remain valid for clients that already hold them)
 *   everything → no-cache, must-revalidate            (index.html and SPA
 *                fallback responses; they must always reflect the latest
 *                hashed bundle names)
 *
 * Only successful (2xx) responses are rewritten so error pages keep whatever
 * caching the asset binding chose.
 */
function withAssetCacheHeaders(url: URL, response: Response): Response {
	if (!response.ok) return response;
	const headers = new Headers(response.headers);
	if (url.pathname.startsWith("/assets/")) {
		headers.set("Cache-Control", "public, max-age=31536000, immutable");
	} else {
		headers.set("Cache-Control", "no-cache, must-revalidate");
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
