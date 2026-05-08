export interface ToolCallResult {
	id: string;
	name: string;
	argumentsJson: string;
}

export interface UsageInfo {
	cost?: number;
	total_tokens?: number;
}

export async function parseSSEStream(
	body: ReadableStream<Uint8Array>,
	onDelta: (text: string) => void,
	onReasoning?: (text: string) => void,
	onToolCall?: (call: ToolCallResult) => void,
	onUsage?: (usage: UsageInfo) => void,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	// Accumulate tool_calls deltas by index
	const toolCallAccumulator: Map<
		number,
		{ id: string; name: string; argumentsJson: string }
	> = new Map();

	function flushToolCalls(): void {
		if (!onToolCall) return;
		for (const [, call] of toolCallAccumulator) {
			onToolCall(call);
		}
		toolCallAccumulator.clear();
	}

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
					if (data === "[DONE]") {
						flushToolCalls();
						return;
					}
					try {
						// biome-ignore lint/suspicious/noExplicitAny: SSE JSON shape is dynamic
						const parsed: any = JSON.parse(data);
						const content = parsed?.choices?.[0]?.delta?.content;
						if (typeof content === "string" && content.length > 0) {
							onDelta(content);
						}
						const reasoning = parsed?.choices?.[0]?.delta?.reasoning;
						if (typeof reasoning === "string" && reasoning.length > 0) {
							onReasoning?.(reasoning);
						}

						// Accumulate tool_calls deltas by index
						const toolCallDeltas = parsed?.choices?.[0]?.delta?.tool_calls;
						if (Array.isArray(toolCallDeltas)) {
							for (const delta of toolCallDeltas) {
								if (typeof delta?.index !== "number") continue;
								const idx: number = delta.index;
								const existing = toolCallAccumulator.get(idx);
								if (!existing) {
									// First fragment: initialise from id, name
									toolCallAccumulator.set(idx, {
										id: typeof delta.id === "string" ? delta.id : "",
										name:
											typeof delta.function?.name === "string"
												? delta.function.name
												: "",
										argumentsJson:
											typeof delta.function?.arguments === "string"
												? delta.function.arguments
												: "",
									});
								} else {
									// Subsequent fragments: concatenate arguments
									if (typeof delta.function?.arguments === "string") {
										existing.argumentsJson += delta.function.arguments;
									}
									// id and name only appear in the first fragment
									if (typeof delta.id === "string" && delta.id) {
										existing.id = delta.id;
									}
									if (
										typeof delta.function?.name === "string" &&
										delta.function.name
									) {
										existing.name = delta.function.name;
									}
								}
							}
						}

						// finish_reason: "tool_calls" signals the calls are complete
						const finishReason = parsed?.choices?.[0]?.finish_reason;
						if (finishReason === "tool_calls") {
							flushToolCalls();
						}

						// Final chunk from OpenRouter (with usage:{include:true})
						// has empty choices and a populated usage object.
						const usage = parsed?.usage;
						if (onUsage && usage && typeof usage === "object") {
							const cost =
								typeof usage.cost === "number" ? usage.cost : undefined;
							const total_tokens =
								typeof usage.total_tokens === "number"
									? usage.total_tokens
									: undefined;
							if (cost !== undefined || total_tokens !== undefined) {
								onUsage({ cost, total_tokens });
							}
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
