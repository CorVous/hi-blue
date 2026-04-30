import type { LLMProvider } from "./provider";

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

/**
 * Handle a POST /chat request.
 * Expects JSON body: { message: string }
 * Returns SSE stream of tokens.
 */
export async function handleChat(
	request: Request,
	provider: LLMProvider,
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 });
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
