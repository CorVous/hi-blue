import type { LLMProvider } from "./provider";
import type { RateLimiter } from "./rate-limiter";

/**
 * In-character "AIs are sleeping" message returned when a rate or cap limit is
 * exceeded. Sent as an SSE event so the browser client can render it in-world.
 */
const SLEEPING_MESSAGE =
	"The AIs are resting right now. They need a moment to recover their thoughts. Please come back a little later.";

/**
 * Build a single-event SSE response for the cap-hit case.
 * Returns HTTP 429 with a typed SSE event `event: cap-hit`.
 */
function buildCapHitResponse(): Response {
	const body = `event: cap-hit\ndata: ${SLEEPING_MESSAGE}\n\n`;
	return new Response(body, {
		status: 429,
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}

/**
 * Build an SSE ReadableStream that streams LLM tokens.
 * Each token is sent as `data: <token>\n\n`.
 * Completion is signalled with `data: [DONE]\n\n`.
 */
function buildSseStream(provider: LLMProvider, prompt: string): ReadableStream {
	const encoder = new TextEncoder();
	return new ReadableStream({
		async start(controller) {
			try {
				for await (const token of provider.streamCompletion(prompt)) {
					controller.enqueue(encoder.encode(`data: ${token}\n\n`));
				}
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			} finally {
				controller.close();
			}
		},
	});
}

export interface HandleChatOptions {
	provider: LLMProvider;
	/** Rate limiter; when omitted, rate limiting is skipped (e.g. unit tests). */
	rateLimiter?: RateLimiter;
}

/**
 * Validated diagnostics payload.
 * v1 taxonomy is intentionally minimal (TBD); the plumbing ships now.
 */
export interface DiagnosticsPayload {
	/** Whether the player downloaded the AI save file. */
	downloaded: boolean;
	/**
	 * One-word player-engagement summary (max 32 chars).
	 * Taxonomy is TBD; v1 accepts any non-empty string within the length limit.
	 */
	summary: string;
}

/**
 * Handle a POST /diagnostics request.
 *
 * Accepts JSON body: { downloaded: boolean, summary: string }
 * - `summary` must be non-empty and at most 32 characters.
 *
 * v1 storage: logs the payload to console (minimal; KV persistence is deferred
 * until the diagnostics taxonomy and retention policy are defined).
 *
 * Returns 200 on success, 400 for validation errors, 405 for wrong method.
 */
export async function handleDiagnostics(request: Request): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response("Bad Request: invalid JSON", { status: 400 });
	}

	if (typeof body !== "object" || body === null) {
		return new Response("Bad Request: expected JSON object", { status: 400 });
	}

	const parsed = body as Record<string, unknown>;

	if (typeof parsed.downloaded !== "boolean") {
		return new Response("Bad Request: downloaded must be a boolean", {
			status: 400,
		});
	}

	if (typeof parsed.summary !== "string") {
		return new Response("Bad Request: summary must be a string", {
			status: 400,
		});
	}

	const summary = parsed.summary;

	if (summary.trim() === "") {
		return new Response("Bad Request: summary must not be empty", {
			status: 400,
		});
	}

	if (summary.length > 32) {
		return new Response("Bad Request: summary must be 32 characters or fewer", {
			status: 400,
		});
	}

	const payload: DiagnosticsPayload = {
		downloaded: parsed.downloaded,
		summary,
	};

	// v1: log to console. KV/DB persistence deferred pending taxonomy decision.
	console.log("[diagnostics]", JSON.stringify(payload));

	return new Response(JSON.stringify({ received: true }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Handle a POST /chat request.
 * Expects JSON body: { message: string }
 * Returns SSE stream of tokens, or HTTP 429 with an in-character SSE event
 * when a rate or daily-cap limit is exceeded.
 */
export async function handleChat(
	request: Request,
	providerOrOpts: LLMProvider | HandleChatOptions,
): Promise<Response> {
	// Support both the legacy (provider-only) call signature and the new options
	// object so existing proxy.test.ts tests continue to work unchanged.
	const opts: HandleChatOptions =
		"streamCompletion" in providerOrOpts
			? { provider: providerOrOpts }
			: providerOrOpts;

	const { provider, rateLimiter } = opts;

	if (request.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	// ---- Rate-limit check (before parsing body to fail fast) ----
	if (rateLimiter !== undefined) {
		const ip =
			request.headers.get("CF-Connecting-IP") ??
			request.headers.get("X-Forwarded-For") ??
			"unknown";

		const check = await rateLimiter.check(ip);
		if (!check.allowed) {
			return buildCapHitResponse();
		}
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response("Bad Request: invalid JSON", { status: 400 });
	}

	const parsed = body as Record<string, unknown>;
	if (
		typeof body !== "object" ||
		body === null ||
		!("message" in body) ||
		typeof parsed.message !== "string" ||
		(parsed.message as string).trim() === ""
	) {
		return new Response("Bad Request: missing message", { status: 400 });
	}

	const message = parsed.message as string;
	const stream = buildSseStream(provider, message);

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}
