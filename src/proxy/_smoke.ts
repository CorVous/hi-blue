import type { LLMProvider } from "./llm-provider";
import { MockLLMProvider } from "./llm-provider";
import { renderChatPage } from "./ui";

function createProvider(env: Record<string, string | undefined>): LLMProvider {
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
	async fetch(
		request: Request,
		env: Record<string, string | undefined>,
	): Promise<Response> {
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
} satisfies ExportedHandler<Record<string, string | undefined>>;
