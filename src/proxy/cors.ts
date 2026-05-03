/**
 * CORS helper module for the OpenAI-compatible proxy.
 *
 * Provides:
 *   - parseAllowedOrigins  — parse comma-separated ALLOWED_ORIGINS env var
 *   - isOriginAllowed      — exact-string match against the allow-list
 *   - buildPreflightResponse — 204 response for OPTIONS preflight
 *   - withCorsHeaders      — add CORS headers to a real (POST) response
 *
 * Design notes:
 *   - No wildcard support; the env value is the source of truth.
 *   - No scheme/host normalisation — values must match exactly.
 *   - Unlisted origins receive 204 (OPTIONS) or the original status (POST)
 *     with Vary: Origin only — no ACAO header is emitted.
 */

export interface CorsEnv {
	ALLOWED_ORIGINS?: string;
}

/**
 * Parse a comma-separated ALLOWED_ORIGINS env value into a frozen list of
 * origin strings. Trims whitespace; drops empty entries.
 */
export function parseAllowedOrigins(env: CorsEnv): readonly string[] {
	if (!env.ALLOWED_ORIGINS) return [];
	return env.ALLOWED_ORIGINS.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * Exact-string match — returns true only when origin is in the allow-list.
 */
export function isOriginAllowed(
	origin: string | null,
	allowed: readonly string[],
): boolean {
	if (origin === null) return false;
	return allowed.includes(origin);
}

/**
 * Build a 204 preflight response for an OPTIONS request.
 *
 * When the request origin is allow-listed, full CORS headers are added.
 * When it is not, only Vary: Origin is set (browser sees a blocked preflight).
 */
export function buildPreflightResponse(
	request: Request,
	allowed: readonly string[],
): Response {
	const origin = request.headers.get("Origin");
	const headers = new Headers({ Vary: "Origin" });

	if (isOriginAllowed(origin, allowed)) {
		// Safe to assert non-null: isOriginAllowed returns false for null.
		headers.set("Access-Control-Allow-Origin", origin as string);
		headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
		const requestedHeaders = request.headers.get(
			"Access-Control-Request-Headers",
		);
		headers.set(
			"Access-Control-Allow-Headers",
			requestedHeaders ?? "Content-Type",
		);
		headers.set("Access-Control-Max-Age", "86400");
	}

	return new Response(null, { status: 204, headers });
}

/**
 * Return a new Response with CORS headers injected into the provided response.
 *
 * Preserves original status, statusText, Content-Type, and all other headers.
 * Uses response.body (not await response.text()) to preserve streaming.
 *
 * When the request origin is allow-listed, Access-Control-Allow-Origin is set.
 * When it is missing or not listed, only Vary: Origin is added.
 */
export function withCorsHeaders(
	response: Response,
	request: Request,
	allowed: readonly string[],
): Response {
	const origin = request.headers.get("Origin");
	const newHeaders = new Headers(response.headers);
	newHeaders.set("Vary", "Origin");

	if (isOriginAllowed(origin, allowed)) {
		newHeaders.set("Access-Control-Allow-Origin", origin as string);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	});
}
