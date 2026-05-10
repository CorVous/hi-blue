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
 *   4. If `currentRound` is provided and this AI received zero `message` ConversationEntries
 *      with `to === ctx.aiId` in that round: a synthetic
 *      { role: "user", content: buildSilentTurn(ctx) } anchoring the current
 *      round so the model does not re-respond to its prior user turn.
 *
 * Note: the system prompt already encodes world state, action log, whispers etc.
 * The OpenAI `tools` field (not messages) teaches the model about available tools.
 */

import type { AiContext } from "./prompt-builder.js";
import type { OpenAiMessage } from "./round-llm-provider.js";
import type { ToolRoundtripMessage } from "./types.js";

/**
 * Synthetic anchor for the current round when no incoming messages arrived for this AI.
 * Fires iff the Daemon received zero `message` ConversationEntries with
 * `to === ctx.aiId` in the current round.
 * Lists every potential sender (peer daemons + blue) so the model reads
 * "nobody addressed me this round" rather than treating the prior round's
 * user turn as fresh stimulus.
 */
export function buildSilentTurn(ctx: AiContext): string {
	const otherDaemons = Object.keys(ctx.personas)
		.filter((id) => id !== ctx.aiId)
		.map((id) => `*${id}`);
	const senders = [...otherDaemons, "blue"];
	if (senders.length === 1) return `No messages from ${senders[0]}.`;
	if (senders.length === 2) {
		return `No messages from ${senders[0]} or ${senders[1]}.`;
	}
	const last = senders[senders.length - 1];
	const rest = senders.slice(0, -1).join(", ");
	return `No messages from ${rest}, or ${last}.`;
}

export function buildOpenAiMessages(
	ctx: AiContext,
	priorToolRoundtrip?: ToolRoundtripMessage,
	currentRound?: number,
): OpenAiMessage[] {
	const messages: OpenAiMessage[] = [];

	messages.push({ role: "system", content: ctx.toSystemPrompt() });

	for (const entry of ctx.conversationLog) {
		if (entry.kind !== "message") continue;
		if (entry.from === ctx.aiId) {
			// Outgoing: this daemon sent the message → assistant turn
			messages.push({ role: "assistant", content: entry.content });
		} else {
			// Incoming: message was sent to this daemon → user turn with sender prefix
			const senderPrefix = entry.from === "blue" ? "blue" : `*${entry.from}`;
			messages.push({
				role: "user",
				content: `${senderPrefix}: ${entry.content}`,
			});
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

	// Anchor the current round for AIs that received no incoming messages.
	// Without this, the model's last user turn is the prior round's player
	// message, and it tends to re-respond to it as if it had just been sent again.
	if (currentRound !== undefined) {
		const incomingThisRound = ctx.conversationLog.some(
			(e) => e.kind === "message" && e.to === ctx.aiId && e.round === currentRound,
		);
		if (!incomingThisRound) {
			messages.push({ role: "user", content: buildSilentTurn(ctx) });
		}
	}

	return messages;
}
