/**
 * BrowserLLMProvider
 *
 * Implements `RoundLLMProvider` for the browser, bridging `streamCompletion`
 * (fetch + SSE) into the `streamRound` interface expected by `runRound`.
 *
 * Collects the full assistant text and all tool calls from the SSE stream
 * and returns them together as a `RoundTurnResult`.
 */

import { streamCompletion } from "../llm-client.js";
import type {
	OpenAiMessage,
	RoundLLMProvider,
	RoundTurnResult,
} from "./round-llm-provider.js";
import type { OpenAiTool } from "./tool-registry.js";

export class BrowserLLMProvider implements RoundLLMProvider {
	async streamRound(
		messages: OpenAiMessage[],
		tools: OpenAiTool[],
	): Promise<RoundTurnResult> {
		const textParts: string[] = [];
		const toolCalls: RoundTurnResult["toolCalls"] = [];

		await streamCompletion({
			messages,
			tools,
			onDelta: (text) => {
				textParts.push(text);
			},
			onToolCall: (call) => {
				toolCalls.push(call);
			},
		});

		return {
			assistantText: textParts.join(""),
			toolCalls,
		};
	}
}
