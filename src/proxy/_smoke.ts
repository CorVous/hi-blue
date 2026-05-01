import type { LLMProvider } from "./llm-provider";
import { MockLLMProvider } from "./llm-provider";
import {
	incrementAndCheckDailyCap,
	incrementAndCheckIpRate,
} from "./rate-limit";
import { renderChatPage } from "./ui";

/**
 * Environment bindings for the proxy worker.
 *
 * Configurable limits (env vars):
 *   IP_RATE_LIMIT        – max requests per IP per window  (default 100)
 *   IP_RATE_WINDOW_SECS  – window duration in seconds       (default 60)
 *   DAILY_CAP            – max cost units per day           (default 10000)
 */
export interface Env {
	RATE_LIMIT_KV: KVNamespace;
	LLM_PROVIDER?: string;
	ANTHROPIC_API_KEY?: string;
	IP_RATE_LIMIT?: string;
	IP_RATE_WINDOW_SECS?: string;
	DAILY_CAP?: string;
}

function createProvider(env: Env): LLMProvider {
	if (env.LLM_PROVIDER === "anthropic") {
		// Dynamic import so tests never pull in the real provider path
		throw new Error(
			"Anthropic provider requires ANTHROPIC_API_KEY; import AnthropicProvider from ./llm-provider",
		);
	}
	return new MockLLMProvider(
		"Hello! I am an AI assistant. How can I help you?",
	);
}

function sseStream(provider: LLMProvider, message: string): ReadableStream {
	return new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			try {
				for await (const token of provider.streamCompletion(message)) {
					const escaped = token.replace(/\n/g, "\\n");
					controller.enqueue(encoder.encode(`data: ${escaped}\n\n`));
				}
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			} finally {
				controller.close();
			}
		},
	});
}

/**
 * Return a fixed SSE response that surfaces an in-character cap-hit message
 * to the browser client.
 *
 * HTTP 200 is used deliberately so the client SSE reader doesn't error out —
 * it just receives the cap-hit SSE event and renders it in the chat panel.
 * The [CAP_HIT] sentinel lets the client distinguish this from a normal stream.
 *
 * In-character copy: "The AIs are sleeping. Come back tomorrow."
 */
function capHitSseResponse(): Response {
	const body =
		"data: The AIs are sleeping. Come back tomorrow.\n\n" +
		"data: [CAP_HIT]\n\n";

	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

/** Extract the client IP from standard Cloudflare / proxy headers. */
function getClientIp(request: Request): string {
	return (
		request.headers.get("CF-Connecting-IP") ??
		request.headers.get("X-Forwarded-For") ??
		"unknown"
	);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/") {
			return new Response(renderChatPage(), {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		if (url.pathname === "/chat" && request.method === "POST") {
			let body: { message?: string };
			try {
				body = (await request.json()) as { message?: string };
			} catch {
				return new Response("Invalid JSON", { status: 400 });
			}

			const { message } = body;
			if (!message || typeof message !== "string") {
				return new Response("Missing message", { status: 400 });
			}

			// ── Rate-limit and daily-cap checks ──────────────────────────────
			// Both checks run before the provider is called.  If either trips,
			// we return an in-character cap-hit SSE response immediately.

			const ip = getClientIp(request);

			const ipRateLimit = parseInt(env.IP_RATE_LIMIT ?? "100", 10);
			const ipWindowSecs = parseInt(env.IP_RATE_WINDOW_SECS ?? "60", 10);

			const ipResult = await incrementAndCheckIpRate(env.RATE_LIMIT_KV, ip, {
				limitPerWindow: ipRateLimit,
				windowSecs: ipWindowSecs,
			});
			if (!ipResult.allowed) {
				return capHitSseResponse();
			}

			const dailyCap = parseInt(env.DAILY_CAP ?? "10000", 10);
			// Date key is UTC date for consistent daily windowing.
			const dateKey = new Date().toISOString().slice(0, 10);
			const capResult = await incrementAndCheckDailyCap(
				env.RATE_LIMIT_KV,
				dateKey,
				1,
				dailyCap,
			);
			if (!capResult.allowed) {
				return capHitSseResponse();
			}
			// ─────────────────────────────────────────────────────────────────

			const provider = createProvider(env);
			const stream = sseStream(provider, message);

			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"X-Content-Type-Options": "nosniff",
				},
			});
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
