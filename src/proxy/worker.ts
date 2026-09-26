import {
	buildPreflightResponse,
	parseAllowedOrigins,
	withCorsHeaders,
} from "./cors";
import { handleChatCompletions } from "./openai-proxy";

interface Env {
	RATE_GUARD_KV: KVNamespace;
	OPENROUTER_API_KEY?: string;
	PER_IP_DAILY_MICRO_USD_MAX?: string;
	GLOBAL_DAILY_MICRO_USD_MAX?: string;
	PRE_CHARGE_MICRO_USD?: string;
	ALLOWED_ORIGINS?: string;
	ASSETS: Fetcher;
}

const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (
			url.pathname === CHAT_COMPLETIONS_PATH &&
			request.method === "OPTIONS"
		) {
			return buildPreflightResponse(request, parseAllowedOrigins(env));
		}

		if (url.pathname === CHAT_COMPLETIONS_PATH && request.method === "POST") {
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
			return handleDiagnostics(request);
		}

		return withAssetCacheHeaders(url, await env.ASSETS.fetch(request));
	},
} satisfies ExportedHandler<Env>;

async function handleDiagnostics(request: Request): Promise<Response> {
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

	console.log(
		`[diagnostics] downloaded=${payload.downloaded} summary=${payload.summary}`,
	);

	return new Response(null, { status: 200 });
}

const ASSET_CACHE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const ALWAYS_REVALIDATE = "no-cache, must-revalidate";

function withAssetCacheHeaders(url: URL, response: Response): Response {
	if (!response.ok) return response;
	const isHashedAssetPath = url.pathname.startsWith("/assets/");
	const isHtml = (response.headers.get("Content-Type") ?? "").includes(
		"text/html",
	);
	const isSpaFallbackForMissingAsset = isHashedAssetPath && isHtml;
	if (isSpaFallbackForMissingAsset) {
		return new Response("Asset not found", {
			status: 404,
			headers: { "Cache-Control": ALWAYS_REVALIDATE },
		});
	}
	const headers = new Headers(response.headers);
	if (isHashedAssetPath) {
		headers.set(
			"Cache-Control",
			`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
		);
	} else {
		headers.set("Cache-Control", ALWAYS_REVALIDATE);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
