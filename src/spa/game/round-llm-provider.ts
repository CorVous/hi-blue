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
export interface OpenAiToolCall {
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
}

export interface RoundLLMProvider {
	streamRound(
		messages: OpenAiMessage[],
		tools: OpenAiTool[],
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
	): Promise<RoundTurnResult> {
		this.calls.push({ messages, tools });
		const raw =
			this.results[this.index % this.results.length] ??
			({ assistantText: "", toolCalls: [] } satisfies RoundTurnResult);
		this.index++;

		if (typeof raw === "string") {
			return { assistantText: raw, toolCalls: [] };
		}
		if ("toolCall" in raw) {
			return {
				assistantText: raw.assistantText ?? "",
				toolCalls: [raw.toolCall],
			};
		}
		return raw;
	}
}
