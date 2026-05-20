/**
 * RoundLLMProvider
 *
 * The browser-side LLM provider interface used by the round coordinator.
 * Returns a structured result per AI turn: assistant text content + any tool calls.
 *
 * The new interface:
 *   1. Accepts a pre-built OpenAI messages array (not a raw prompt string)
 *   2. Accepts the tools array to send with each request
 *   3. Returns a structured { assistantText, toolCalls } result
 *
 * Tests should use MockRoundLLMProvider (defined in this file).
 */

import type { OpenAiTool } from "./tool-registry.js";

/**
 * OpenAI-spec message types.
 * Defined here (not in llm-client.ts) so this file can be imported by
 * both browser code and the server-side proxy without pulling in browser globals.
 */
interface OpenAiToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export type OpenAiMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

export interface RoundTurnResult {
	assistantText: string;
	toolCalls: Array<{ id: string; name: string; argumentsJson: string }>;
	// USD cost of this LLM request, populated from OpenRouter's usage.cost
	// when available. Absent in mocks/tests that don't model spend.
	costUsd?: number;
	// Token accounting from the provider's final usage chunk. Used for
	// prompt-caching diagnostics; absent in mocks.
	promptTokens?: number;
	completionTokens?: number;
	cachedPromptTokens?: number;
}

export type LifecyclePhase =
	| { phase: "started"; daemonId?: string }
	| { phase: "first-token"; daemonId?: string }
	| { phase: "completed"; daemonId?: string }
	| { phase: "errored"; daemonId?: string; error: unknown };

export interface RoundLLMProvider {
	streamRound(
		messages: OpenAiMessage[],
		tools: OpenAiTool[],
		onDelta?: (text: string) => void,
		daemonId?: string,
		onLifecycle?: (event: LifecyclePhase) => void,
	): Promise<RoundTurnResult>;
}

/**
 * MockRoundLLMProvider for tests.
 *
 * Accepts an array of pre-configured results returned in call order.
 * Each entry is either a full RoundTurnResult or a shorthand:
 *   - string → { assistantText: string, toolCalls: [] }
 *   - { toolCall: ... } → { assistantText: "", toolCalls: [toolCall] }
 */
export type MockRoundResult =
	| string
	| RoundTurnResult
	| {
			assistantText?: string;
			toolCall: { id: string; name: string; argumentsJson: string };
	  };

export class MockRoundLLMProvider implements RoundLLMProvider {
	readonly calls: Array<{
		messages: OpenAiMessage[];
		tools: OpenAiTool[];
	}> = [];

	private results: MockRoundResult[];
	private index = 0;

	constructor(results: MockRoundResult[]) {
		this.results = results;
	}

	async streamRound(
		messages: OpenAiMessage[],
		tools: OpenAiTool[],
		_onDelta?: (text: string) => void,
		daemonId?: string,
		onLifecycle?: (event: LifecyclePhase) => void,
	): Promise<RoundTurnResult> {
		try {
			this.calls.push({ messages, tools });
			onLifecycle?.(
				daemonId ? { phase: "started", daemonId } : { phase: "started" },
			);

			const raw =
				this.results[this.index % this.results.length] ??
				({ assistantText: "", toolCalls: [] } satisfies RoundTurnResult);
			this.index++;

			onLifecycle?.(
				daemonId
					? { phase: "first-token", daemonId }
					: { phase: "first-token" },
			);

			let result: RoundTurnResult;
			if (typeof raw === "string") {
				result = { assistantText: raw, toolCalls: [] };
			} else if ("toolCall" in raw) {
				result = {
					assistantText: raw.assistantText ?? "",
					toolCalls: [raw.toolCall],
				};
			} else {
				result = raw;
			}

			onLifecycle?.(
				daemonId ? { phase: "completed", daemonId } : { phase: "completed" },
			);
			return result;
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
