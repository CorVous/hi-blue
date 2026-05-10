/**
 * OpenAI Message Builder
 *
 * Converts an AiContext (the game's view of one AI's state) plus any prior-round
 * tool roundtrip data into an OpenAI-spec `messages` array ready for the LLM API.
 *
 * Message ordering:
 *   1. { role: "system", content: ctx.toSystemPrompt() }
 *      Stable per (persona × phase) — OpenRouter's prefix cache reuses it round-to-round.
 *   2. One turn per ConversationEntry, sorted by round ascending (stable):
 *      - kind=message, outgoing: { role: "assistant", content: renderEntry(...) }
 *        — "[Round N] you dm <to>: <content>" so the model retains routing context.
 *      - kind=message, incoming: { role: "user",      content: renderEntry(...) }
 *        — "[Round N] <from> dms you: <content>".
 *      - kind=witnessed-event:   { role: "user",      content: renderEntry(...) }
 *        — "[Round N] You watch *X do Y."
 *      Append-only across rounds, so the cached prefix grows with the game.
 *   3. If priorToolRoundtrip is provided and non-empty:
 *      - { role: "assistant", content: null, tool_calls: [...] }
 *      - { role: "tool", tool_call_id, content } for each result
 *   4. If `currentRound` is provided and this AI received zero `message` ConversationEntries
 *      with `to === ctx.aiId` in that round: a synthetic
 *      { role: "user", content: buildSilentTurn() } anchoring the current
 *      round so the model does not re-respond to its prior user turn.
 *   5. A trailing { role: "user", content: ctx.toCurrentStateUserMessage() } turn
 *      carrying `<where_you_are>` + `<what_you_see>`. Always fresh, only the
 *      current snapshot is retained (no historical spatial state) — keeps the
 *      cache prefix above stable while putting the most action-relevant info
 *      adjacent to the model's response.
 */

import { renderEntry } from "./conversation-log.js";
import type { AiContext } from "./prompt-builder.js";
import type { OpenAiMessage } from "./round-llm-provider.js";
import type { ToolRoundtripMessage } from "./types.js";

/**
 * Synthetic anchor for the current round when no incoming messages arrived for this AI.
 * Fires iff the Daemon received zero `message` ConversationEntries with
 * `to === ctx.aiId` in the current round, anchoring the round so the model
 * does not treat the prior round's user turn as fresh stimulus.
 */
export function buildSilentTurn(): string {
	return "You have received no messages.";
}

export function buildOpenAiMessages(
	ctx: AiContext,
	priorToolRoundtrip?: ToolRoundtripMessage,
	currentRound?: number,
): OpenAiMessage[] {
	const messages: OpenAiMessage[] = [];

	messages.push({ role: "system", content: ctx.toSystemPrompt() });

	// Sort by round ascending — stable, so ties preserve append order.
	const sortedLog = [...ctx.conversationLog].sort((a, b) => a.round - b.round);
	for (const entry of sortedLog) {
		if (entry.kind === "message") {
			const content = renderEntry(entry, ctx.aiId, ctx.worldSnapshot.entities);
			// Outgoing → assistant role; incoming → user role. The "[Round N]
			// you dm <to>" / "[Round N] <from> dms you" prefix on both sides
			// preserves routing context the model needs for multi-recipient
			// reasoning (issue surfaced by code review of a704b81).
			const role = entry.from === ctx.aiId ? "assistant" : "user";
			messages.push({ role, content });
		} else if (entry.kind === "witnessed-event") {
			messages.push({
				role: "user",
				content: renderEntry(entry, ctx.aiId, ctx.worldSnapshot.entities),
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
			(e) =>
				e.kind === "message" && e.to === ctx.aiId && e.round === currentRound,
		);
		if (!incomingThisRound) {
			messages.push({ role: "user", content: buildSilentTurn() });
		}
	}

	// Trailing current-state user turn — always emitted, always last. Carries
	// the volatile `<where_you_are>` + `<what_you_see>` snapshot so the system
	// prompt above stays byte-stable for the prefix cache.
	messages.push({ role: "user", content: ctx.toCurrentStateUserMessage() });

	return messages;
}
