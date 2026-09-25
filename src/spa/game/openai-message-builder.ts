import { renderEntry } from "./conversation-log.js";
import type { AiContext } from "./prompt-builder.js";
import type { OpenAiMessage } from "./round-llm-provider.js";
import type { ToolRoundtripMessage } from "./types.js";

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

	const sortedLog = [...ctx.conversationLog].sort((a, b) => a.round - b.round);
	for (const entry of sortedLog) {
		if (entry.kind === "message") {
			if (entry.from === ctx.aiId) {
				const outgoingEntry = entry as {
					toolCallId?: string;
					toolArgumentsJson?: string;
				};
				if (outgoingEntry.toolCallId && outgoingEntry.toolArgumentsJson) {
					messages.push({
						role: "assistant",
						content: null,
						tool_calls: [
							{
								type: "function" as const,
								id: outgoingEntry.toolCallId,
								function: {
									name: "message",
									arguments: outgoingEntry.toolArgumentsJson,
								},
							},
						],
					});
					messages.push({
						role: "tool",
						tool_call_id: outgoingEntry.toolCallId,
						content: renderEntry(entry, ctx.aiId, ctx.worldSnapshot.entities),
					});
				} else {
					messages.push({
						role: "assistant",
						content: renderEntry(entry, ctx.aiId, ctx.worldSnapshot.entities),
					});
				}
			} else {
				messages.push({
					role: "user",
					content: renderEntry(entry, ctx.aiId, ctx.worldSnapshot.entities),
				});
			}
		} else if (entry.kind === "witnessed-event") {
			messages.push({
				role: "user",
				content: renderEntry(entry, ctx.aiId, ctx.worldSnapshot.entities),
			});
		} else if (entry.kind === "action-failure") {
			messages.push({
				role: "user",
				content: renderEntry(entry, ctx.aiId, ctx.worldSnapshot.entities),
			});
		} else if (entry.kind === "witnessed-obstacle-shift") {
			messages.push({
				role: "user",
				content: renderEntry(entry, ctx.aiId, ctx.worldSnapshot.entities),
			});
		} else if (entry.kind === "witnessed-convergence") {
			messages.push({
				role: "user",
				content: renderEntry(entry, ctx.aiId, ctx.worldSnapshot.entities),
			});
		} else if (entry.kind === "tool-call") {
			messages.push({
				role: "assistant",
				content: null,
				tool_calls: [
					{
						type: "function" as const,
						id: entry.toolCallId,
						function: {
							name: entry.toolName,
							arguments: entry.toolArgumentsJson,
						},
					},
				],
			});
			const toolContent = entry.diskDelta
				? `${entry.result}\n\n<noticed>\n${entry.diskDelta}\n</noticed>`
				: entry.result;
			messages.push({
				role: "tool",
				tool_call_id: entry.toolCallId,
				content: toolContent,
			});
		} else if (entry.kind === "broadcast") {
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

	if (currentRound !== undefined) {
		const incomingThisRound = ctx.conversationLog.some(
			(e) =>
				e.kind === "message" && e.to === ctx.aiId && e.round === currentRound,
		);
		if (!incomingThisRound) {
			messages.push({ role: "user", content: buildSilentTurn() });
		}
	}

	messages.push({ role: "user", content: ctx.toCurrentStateUserMessage() });

	return messages;
}
