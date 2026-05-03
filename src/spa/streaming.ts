export async function parseSSEStream(
	body: ReadableStream<Uint8Array>,
	onDelta: (text: string) => void,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			// Split on double newline (SSE event delimiter)
			const events = buffer.split("\n\n");
			// Last element may be an incomplete event — keep in buffer
			buffer = events.pop() ?? "";

			for (const event of events) {
				for (const line of event.split("\n")) {
					if (!line.startsWith("data:")) continue;
					const data = line.slice("data:".length).trim();
					if (data === "[DONE]") return;
					try {
						// biome-ignore lint/suspicious/noExplicitAny: SSE JSON shape is dynamic
						const parsed: any = JSON.parse(data);
						const content = parsed?.choices?.[0]?.delta?.content;
						if (typeof content === "string" && content.length > 0) {
							onDelta(content);
						}
					} catch {
						// Ignore malformed JSON chunks
					}
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
