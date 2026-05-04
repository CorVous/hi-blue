/**
 * OpenAI Message Builder
 *
 * Converts an AiContext (the game's view of one AI's state) plus any prior-round
 * tool roundtrip data into an OpenAI-spec `messages` array ready for the LLM API.
 *
 * Message ordering:
 *   1. { role: "system", content: ctx.toSystemPrompt() }
 *   2. One { role: "user" | "assistant", content } pair per turn in ctx.chatHistory
 *   3. If priorToolRoundtrip is provided and non-empty:
 *      - { role: "assistant", content: null, tool_calls: [...] }
 *      - { role: "tool", tool_call_id, content } for each result
 *
 * Note: the system prompt already encodes world state, action log, whispers etc.
 * The OpenAI `tools` field (not messages) teaches the model about available tools.
 */

import type { AiContext } from "./prompt-builder.js";
import type { OpenAiMessage } from "./round-llm-provider.js";
import type { ToolRoundtripMessage } from "./types.js";

export function buildOpenAiMessages(
	ctx: AiContext,
	priorToolRoundtrip?: ToolRoundtripMessage,
): OpenAiMessage[] {
	const messages: OpenAiMessage[] = [];

	// 1. System message (contains the full narrative context — world state, action log, etc.)
	messages.push({ role: "system", content: ctx.toSystemPrompt() });

	// 2. Chat history — alternating player (user) / AI (assistant) turns
	for (const msg of ctx.chatHistory) {
		if (msg.role === "player") {
			messages.push({ role: "user", content: msg.content });
		} else {
			messages.push({ role: "assistant", content: msg.content });
		}
	}

	// 3. Prior-round tool roundtrip (assistant tool_calls + tool results)
	//    This re-injects the protocol messages required by OpenAI's tool-use spec:
	//    the assistant message that contained the tool_calls, followed by each
	//    tool result message.
	if (priorToolRoundtrip && priorToolRoundtrip.assistantToolCalls.length > 0) {
		// Re-emit the assistant message with tool_calls
		messages.push({
			role: "assistant",
			content: null,
			tool_calls: priorToolRoundtrip.assistantToolCalls.map((tc) => ({
				id: tc.id,
				type: "function" as const,
				function: { name: tc.name, arguments: tc.argumentsJson },
			})),
		});

		// Re-emit each tool result
		for (const result of priorToolRoundtrip.toolResults) {
			const content = result.success
				? result.description
				: `FAILED: ${result.description}${result.reason ? ` (${result.reason})` : ""}`;
			messages.push({
				role: "tool",
				tool_call_id: result.tool_call_id,
				content,
			});
		}
	}

	return messages;
}
