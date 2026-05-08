/**
 * BrowserLLMProvider
 *
 * Implements `RoundLLMProvider` for the browser, bridging `streamCompletion`
 * (fetch + SSE) into the `streamRound` interface expected by `runRound`.
 *
 * Collects the full assistant text and all tool calls from the SSE stream
 * and returns them together as a `RoundTurnResult`.
 *
 * Reasoning is disabled by default for routine daemon turns — GLM-4.7's
 * thinking trace adds 1–4K tokens of latency per turn for little roleplay
 * benefit (see `docs/prompting/glm-4.7-guide.md`). Construct with
 * `{ disableReasoning: false }` to opt back into the thinking step.
 */

import { streamCompletion } from "../llm-client.js";
import type {
	OpenAiMessage,
	RoundLLMProvider,
	RoundTurnResult,
} from "./round-llm-provider.js";
import type { OpenAiTool } from "./tool-registry.js";

export class BrowserLLMProvider implements RoundLLMProvider {
	private readonly disableReasoning: boolean;

	constructor(opts: { disableReasoning?: boolean } = {}) {
		this.disableReasoning = opts.disableReasoning ?? true;
	}

	async streamRound(
		messages: OpenAiMessage[],
		tools: OpenAiTool[],
		onDelta?: (text: string) => void,
	): Promise<RoundTurnResult> {
		const textParts: string[] = [];
		const reasoningParts: string[] = [];
		const toolCalls: RoundTurnResult["toolCalls"] = [];
		let costUsd: number | undefined;

		await streamCompletion({
			messages,
			tools,
			onDelta: (text) => {
				textParts.push(text);
				onDelta?.(text);
			},
			onReasoning: (text) => {
				reasoningParts.push(text);
			},
			onToolCall: (call) => {
				toolCalls.push(call);
			},
			onUsage: (usage) => {
				if (typeof usage.cost === "number") costUsd = usage.cost;
			},
			disableReasoning: this.disableReasoning,
		});

		const assistantText = textParts.join("") || reasoningParts.join("");
		return {
			assistantText,
			toolCalls,
			...(costUsd !== undefined ? { costUsd } : {}),
		};
	}
}
