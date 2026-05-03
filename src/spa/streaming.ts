export async function streamCompletion(opts: {
	baseUrl: string;
	message: string;
	signal?: AbortSignal;
	onDelta: (text: string) => void;
}): Promise<void> {
	const { baseUrl, message, signal, onDelta } = opts;

	const response = await fetch(`${baseUrl}/v1/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			messages: [{ role: "user", content: message }],
			stream: true,
		}),
		...(signal != null ? { signal } : {}),
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	if (!response.body) {
		throw new Error("Response body is null");
	}

	const reader = response.body.getReader();
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
