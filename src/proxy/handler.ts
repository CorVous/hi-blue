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
