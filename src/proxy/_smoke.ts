import type { LLMProvider } from "./llm-provider";
import { MockLLMProvider } from "./llm-provider";
import { capHitStream, checkAndCharge, configFromEnv } from "./rate-guard";
import { renderChatPage } from "./ui";

/** Shape of the bindings/env this Worker expects. */
interface Env {
	/** KV namespace backing the rate-limit and daily-cap guards. */
	RATE_GUARD_KV: KVNamespace;
	/** Optional: set to "anthropic" to use the real provider. */
	LLM_PROVIDER?: string;
	ANTHROPIC_API_KEY?: string;
	/** Rate-guard configuration knobs (all optional; defaults in configFromEnv). */
	RATE_LIMIT_MAX?: string;
	RATE_LIMIT_WINDOW_SEC?: string;
	ESTIMATED_COST_PER_REQUEST?: string;
	DAILY_CAP_MAX?: string;
}

function createProvider(env: Env): LLMProvider {
	if (env.LLM_PROVIDER === "anthropic") {
		// Not yet wired — needs dynamic import + ANTHROPIC_API_KEY before use.
		throw new Error(
			"Anthropic provider not yet wired; set LLM_PROVIDER=mock or wire AnthropicProvider dynamically",
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
				controller.close();
			} catch (err) {
				controller.error(err);
			}
		},
	});
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

			// ── Rate-limit / daily-cap guard ──────────────────────────────
			// Short-circuit BEFORE constructing or calling the LLM provider.
			const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
			const guard = await checkAndCharge(
				env.RATE_GUARD_KV,
				clientIp,
				Date.now(),
				configFromEnv(env),
			);
			if (!guard.allowed) {
				return new Response(capHitStream(guard.reason), {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						"X-Content-Type-Options": "nosniff",
						"X-Cap-Hit": guard.reason,
					},
				});
			}
			// ── End guard ─────────────────────────────────────────────────

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
