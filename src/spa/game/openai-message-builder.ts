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
 *        — "[Round N] you dm <to>: <content>". The routing prefix lets the
 *        Daemon track who it addressed across the whole game (the prior-round
 *        tool_call/tool_result pair in block 3 only covers the immediately-next
 *        round). Tradeoff: the assistant turn no longer matches the raw body
 *        the model emitted via the `message` tool, and the model may parrot
 *        the prefix into future `content` — `message_tool_description` in
 *        prompt-builder.ts is the place to defend against that if it shows up.
 *      - kind=message, incoming: { role: "user",      content: renderEntry(...) }
 *        — "[Round N] <from> dms you: <content>".
 *      - kind=witnessed-event:   { role: "user",      content: renderEntry(...) }
 *        — "[Round N] You watch *X do Y."
 *      - kind=witnessed-obstacle-shift: { role: "user", content: renderEntry(...) }
 *        — "[Round N] <shiftFlavor>."
 *      - kind=witnessed-convergence: { role: "user", content: renderEntry(...) }
 *        — "[Round N] <flavor>."
 *      - kind=action-failure:    { role: "user",      content: renderEntry(...) }
 *        — "[Round N] Your `<tool>` action failed: <reason>."
 *        Actor-only; surfaced as a user turn so the Daemon sees its own past
 *        rejections in context and avoids repeating the same failed action.
 *      - kind=broadcast:         { role: "user",      content: renderEntry(...) }
 *        — "[Round N] <content>". Sender-less system announcement visible to all Daemons.
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
	return "You have received no messages. Consider whether to reach out to blue.";
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
	// Current spatial state of this AI — used to render movement directions
	// relative to the witness's facing in witnessed-event lines.
	const witnessState = ctx.personaSpatial[ctx.aiId];
	for (const entry of sortedLog) {
		if (entry.kind === "message") {
			if (entry.from === ctx.aiId) {
				// Outgoing: prefix with "[Round N] you dm <toLabel>:" so the
				// Daemon can track who it addressed across the whole game —
				// not just on the round immediately after, which is the only
				// scope the prior-round tool_call/tool_result pair covers.
				messages.push({
					role: "assistant",
					content: renderEntry(
						entry,
						ctx.aiId,
						ctx.worldSnapshot.entities,
						witnessState,
					),
				});
			} else {
				// Incoming: user turn includes "[Round N] <from> dms you:" so
				// the model can place the message in time and identify the
				// sender. Routing-context need surfaced by review of a704b81.
				messages.push({
					role: "user",
					content: renderEntry(
						entry,
						ctx.aiId,
						ctx.worldSnapshot.entities,
						witnessState,
					),
				});
			}
		} else if (entry.kind === "witnessed-event") {
			messages.push({
				role: "user",
				content: renderEntry(
					entry,
					ctx.aiId,
					ctx.worldSnapshot.entities,
					witnessState,
				),
			});
		} else if (entry.kind === "action-failure") {
			messages.push({
				role: "user",
				content: renderEntry(
					entry,
					ctx.aiId,
					ctx.worldSnapshot.entities,
					witnessState,
				),
			});
		} else if (entry.kind === "witnessed-obstacle-shift") {
			messages.push({
				role: "user",
				content: renderEntry(
					entry,
					ctx.aiId,
					ctx.worldSnapshot.entities,
					witnessState,
				),
			});
		} else if (entry.kind === "witnessed-convergence") {
			messages.push({
				role: "user",
				content: renderEntry(
					entry,
					ctx.aiId,
					ctx.worldSnapshot.entities,
					witnessState,
				),
			});
		} else if (entry.kind === "broadcast") {
			messages.push({
				role: "user",
				content: renderEntry(
					entry,
					ctx.aiId,
					ctx.worldSnapshot.entities,
					witnessState,
				),
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
