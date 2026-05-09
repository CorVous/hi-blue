/**
 * OpenAI Message Builder
 *
 * Converts an AiContext (the game's view of one AI's state) plus any prior-round
 * tool roundtrip data into an OpenAI-spec `messages` array ready for the LLM API.
 *
 * Message ordering:
 *   1. { role: "system", content: ctx.toSystemPrompt() }
 *   2. One { role: "user" | "assistant", content } pair per chat entry in ctx.conversationLog
 *   3. If priorToolRoundtrip is provided and non-empty:
 *      - { role: "assistant", content: null, tool_calls: [...] }
 *      - { role: "tool", tool_call_id, content } for each result
 *   4. If `addressed` is provided and is not this AI: a synthetic
 *      { role: "user", content: SILENT_BLUE_TURN } anchoring the current
 *      round so the model does not re-respond to its prior user turn.
 *
 * Note: the system prompt already encodes world state, action log, whispers etc.
 * The OpenAI `tools` field (not messages) teaches the model about available tools.
 */

import type { AiContext } from "./prompt-builder.js";
import type { OpenAiMessage } from "./round-llm-provider.js";
import type { AiId, ToolRoundtripMessage } from "./types.js";

export const SILENT_BLUE_TURN = "Blue: ";

export function buildOpenAiMessages(
	ctx: AiContext,
	priorToolRoundtrip?: ToolRoundtripMessage,
	addressed?: AiId,
): OpenAiMessage[] {
	const messages: OpenAiMessage[] = [];

	messages.push({ role: "system", content: ctx.toSystemPrompt() });

	for (const entry of ctx.conversationLog) {
		if (entry.kind !== "chat") continue;
		if (entry.role === "player") {
			messages.push({ role: "user", content: entry.content });
		} else {
			messages.push({ role: "assistant", content: entry.content });
		}
	}

	if (priorToolRoundtrip && priorToolRoundtrip.assistantToolCalls.length > 0) {
		messages.push({
			role: "assistant",
			content: null,
			tool_calls: priorToolRoundtrip.assistantToolCalls.map((tc) => ({
				id: tc.id,
				type: "function" as const,
				function: { name: tc.name, arguments: tc.argumentsJson },
			})),
		});

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

	// Anchor the current round for non-addressed AIs. Without this, the model's
	// last user turn is the prior round's player message, and it tends to
	// re-respond to it as if it had just been sent again.
	if (addressed !== undefined && addressed !== ctx.aiId) {
		messages.push({ role: "user", content: SILENT_BLUE_TURN });
	}

	return messages;
}
