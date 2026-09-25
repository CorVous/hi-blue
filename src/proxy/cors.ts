const PREFLIGHT_CACHE_SECONDS = 24 * 60 * 60;

export interface CorsEnv {
	ALLOWED_ORIGINS?: string;
}

export function parseAllowedOrigins(env: CorsEnv): readonly string[] {
	if (!env.ALLOWED_ORIGINS) return [];
	return env.ALLOWED_ORIGINS.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export function isOriginAllowed(
	origin: string | null,
	allowed: readonly string[],
): boolean {
	if (origin === null) return false;
	return allowed.includes(origin);
}

export function buildPreflightResponse(
	request: Request,
	allowed: readonly string[],
): Response {
	const origin = request.headers.get("Origin");
	const headers = new Headers({ Vary: "Origin" });

	if (isOriginAllowed(origin, allowed)) {
		headers.set("Access-Control-Allow-Origin", origin as string);
		headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
		const requestedHeaders = request.headers.get(
			"Access-Control-Request-Headers",
		);
		headers.set(
			"Access-Control-Allow-Headers",
			requestedHeaders ?? "Content-Type",
		);
		headers.set("Access-Control-Max-Age", String(PREFLIGHT_CACHE_SECONDS));
	}

	return new Response(null, { status: 204, headers });
}

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
