import type { OpenAiTool } from "./tool-registry.js";

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
	costUsd?: number;
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
	private nextResultIndex = 0;

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
				this.results[this.nextResultIndex % this.results.length] ??
				({ assistantText: "", toolCalls: [] } satisfies RoundTurnResult);
			this.nextResultIndex++;

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
