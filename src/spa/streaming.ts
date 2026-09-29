import { UpstreamErrorBodyError } from "./llm-errors.js";

export interface ToolCallResult {
	id: string;
	name: string;
	argumentsJson: string;
}

export interface UsageInfo {
	cost?: number;
	total_tokens?: number;
	prompt_tokens?: number;
	completion_tokens?: number;
	cached_tokens?: number;
}

const SSE_EVENT_DELIMITER = "\n\n";

// biome-ignore lint/suspicious/noExplicitAny: SSE JSON shape is dynamic
function parseChunkOrUndefined(data: string): any {
	try {
		return JSON.parse(data);
	} catch {
		return undefined;
	}
}

// biome-ignore lint/suspicious/noExplicitAny: SSE JSON shape is dynamic
function upstreamErrorFromChunk(chunk: any): UpstreamErrorBodyError | null {
	const error = chunk?.error;
	if (error == null || typeof error !== "object") return null;
	const upstreamMessage =
		typeof error.message === "string"
			? error.message
			: "stream finished with an error";
	const code = error.code;
	return new UpstreamErrorBodyError(
		typeof code === "string" || typeof code === "number"
			? { upstreamMessage, upstreamCode: String(code) }
			: { upstreamMessage },
	);
}
const LINE_BREAK_PATTERN = /\r\n?/g;

// biome-ignore lint/suspicious/noExplicitAny: SSE JSON shape is dynamic
function usageFromChunk(chunk: any): UsageInfo | undefined {
	const usage = chunk?.usage;
	if (!usage || typeof usage !== "object") return undefined;
	const cost = typeof usage.cost === "number" ? usage.cost : undefined;
	const total_tokens =
		typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
	const prompt_tokens =
		typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
	const completion_tokens =
		typeof usage.completion_tokens === "number"
			? usage.completion_tokens
			: undefined;
	const cachedFromOpenAi =
		typeof usage.prompt_tokens_details?.cached_tokens === "number"
			? usage.prompt_tokens_details.cached_tokens
			: undefined;
	const cachedFromAnthropic =
		typeof usage.cache_read_input_tokens === "number"
			? usage.cache_read_input_tokens
			: undefined;
	const cached_tokens = cachedFromOpenAi ?? cachedFromAnthropic;
	if (
		cost === undefined &&
		total_tokens === undefined &&
		prompt_tokens === undefined &&
		completion_tokens === undefined &&
		cached_tokens === undefined
	) {
		return undefined;
	}
	return {
		cost,
		total_tokens,
		prompt_tokens,
		completion_tokens,
		cached_tokens,
	};
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

	const toolCallAccumulator: Map<
		number,
		{ id: string; name: string; argumentsJson: string }
	> = new Map();
	let finishReasonSeen = false;
	let receivedUsableOutput = false;

	function flushToolCalls(): void {
		if (!onToolCall) return;
		for (const [, call] of toolCallAccumulator) {
			onToolCall(call);
		}
		toolCallAccumulator.clear();
	}

	function handleEvent(event: string): boolean {
		for (const line of event.split("\n")) {
			if (!line.startsWith("data:")) continue;
			const data = line.slice("data:".length).trim();
			if (data === "[DONE]") {
				flushToolCalls();
				return true;
			}
			const parsed = parseChunkOrUndefined(data);
			if (parsed === undefined) continue;
			try {
				const usage = usageFromChunk(parsed);
				if (usage) onUsage?.(usage);
			} catch {}
			try {
				const content = parsed?.choices?.[0]?.delta?.content;
				if (typeof content === "string" && content.length > 0) {
					receivedUsableOutput = true;
					onDelta(content);
				}
				const reasoning = parsed?.choices?.[0]?.delta?.reasoning;
				if (typeof reasoning === "string" && reasoning.length > 0) {
					onReasoning?.(reasoning);
				}

				const toolCallDeltas = parsed?.choices?.[0]?.delta?.tool_calls;
				if (Array.isArray(toolCallDeltas)) {
					for (const delta of toolCallDeltas) {
						if (typeof delta?.index !== "number") continue;
						receivedUsableOutput = true;
						const idx: number = delta.index;
						const accumulated = toolCallAccumulator.get(idx);
						if (!accumulated) {
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
							if (typeof delta.function?.arguments === "string") {
								accumulated.argumentsJson += delta.function.arguments;
							}
							if (typeof delta.id === "string" && delta.id) {
								accumulated.id = delta.id;
							}
							if (
								typeof delta.function?.name === "string" &&
								delta.function.name
							) {
								accumulated.name = delta.function.name;
							}
						}
					}
				}

				const finishReason = parsed?.choices?.[0]?.finish_reason;
				if (typeof finishReason === "string" && finishReason.length > 0) {
					finishReasonSeen = true;
				}
				if (finishReason === "tool_calls") {
					flushToolCalls();
				}
			} catch {}
			const upstreamError = upstreamErrorFromChunk(parsed);
			if (upstreamError) {
				if (!receivedUsableOutput) throw upstreamError;
				flushToolCalls();
				return true;
			}
		}
		return false;
	}

	function takeCompleteEvents(streamEnded: boolean): string[] {
		const holdBackCarriageReturn = !streamEnded && buffer.endsWith("\r");
		const settled = holdBackCarriageReturn ? buffer.slice(0, -1) : buffer;
		const events = settled
			.replace(LINE_BREAK_PATTERN, "\n")
			.split(SSE_EVENT_DELIMITER);
		const unfinishedTrailingEvent = streamEnded ? "" : (events.pop() ?? "");
		buffer = holdBackCarriageReturn
			? `${unfinishedTrailingEvent}\r`
			: unfinishedTrailingEvent;
		return events;
	}

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				buffer += decoder.decode();
			} else {
				buffer += decoder.decode(value, { stream: true });
			}
			for (const event of takeCompleteEvents(done)) {
				if (handleEvent(event)) return;
			}
			if (done) {
				if (finishReasonSeen) flushToolCalls();
				return;
			}
		}
	} finally {
		reader.releaseLock();
	}
}
