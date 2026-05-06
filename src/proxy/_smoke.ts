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
	/** Token-guard configuration knobs (all optional; defaults in configFromEnv). */
	PER_IP_DAILY_TOKEN_MAX?: string;
	GLOBAL_DAILY_TOKEN_MAX?: string;
	PRE_CHARGE_ESTIMATE?: string;
	/**
	 * Comma-separated list of allowed CORS origins for POST /v1/chat/completions.
	 * Example (wrangler.jsonc): "https://corvous.github.io"
	 * For local dev, set additional origins in .dev.vars or via:
	 *   wrangler dev --var ALLOWED_ORIGINS=http://localhost:5173
	 * without committing local ports to the production config.
	 */
	ALLOWED_ORIGINS?: string;
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

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
