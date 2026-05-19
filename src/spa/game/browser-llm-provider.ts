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
	LifecyclePhase,
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
		daemonId?: string,
		onLifecycle?: (event: LifecyclePhase) => void,
	): Promise<RoundTurnResult> {
		try {
			const textParts: string[] = [];
			const reasoningParts: string[] = [];
			const toolCalls: RoundTurnResult["toolCalls"] = [];
			let costUsd: number | undefined;
			let promptTokens: number | undefined;
			let completionTokens: number | undefined;
			let cachedPromptTokens: number | undefined;
			let firstTokenFired = false;

			onLifecycle?.(
				daemonId ? { phase: "started", daemonId } : { phase: "started" },
			);

			await streamCompletion({
				messages,
				tools,
				onDelta: (text) => {
					textParts.push(text);
					onDelta?.(text);
					if (!firstTokenFired) {
						firstTokenFired = true;
						onLifecycle?.(
							daemonId
								? { phase: "first-token", daemonId }
								: { phase: "first-token" },
						);
					}
				},
				onReasoning: (text) => {
					reasoningParts.push(text);
				},
				onToolCall: (call) => {
					toolCalls.push(call);
				},
				onUsage: (usage) => {
					if (typeof usage.cost === "number") costUsd = usage.cost;
					if (typeof usage.prompt_tokens === "number") {
						promptTokens = usage.prompt_tokens;
					}
					if (typeof usage.completion_tokens === "number") {
						completionTokens = usage.completion_tokens;
					}
					if (typeof usage.cached_tokens === "number") {
						cachedPromptTokens = usage.cached_tokens;
					}
				},
				disableReasoning: this.disableReasoning,
			});

			if (promptTokens !== undefined && cachedPromptTokens !== undefined) {
				// Inspector provides visibility into cache behavior; devtools logging removed
			}

			// Inspector provides visibility into tool calling patterns; devtools logging removed

			const assistantText = textParts.join("") || reasoningParts.join("");
			onLifecycle?.(
				daemonId ? { phase: "completed", daemonId } : { phase: "completed" },
			);
			return {
				assistantText,
				toolCalls,
				...(costUsd !== undefined ? { costUsd } : {}),
				...(promptTokens !== undefined ? { promptTokens } : {}),
				...(completionTokens !== undefined ? { completionTokens } : {}),
				...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
			};
		} catch (error) {
			onLifecycle?.(
				daemonId
					? { phase: "errored", daemonId, error }
					: { phase: "errored", error },
			);
			throw error;
		}
	}
}
