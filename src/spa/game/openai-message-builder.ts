import { renderEntry } from "./conversation-log.js";
import type { AiContext } from "./prompt-builder.js";
import type { OpenAiMessage } from "./round-llm-provider.js";
import type { ToolRoundtripMessage } from "./types.js";

const SILENT_TURN = "You have received no messages.";

export function buildOpenAiMessages(
	ctx: AiContext,
	priorToolRoundtrip?: ToolRoundtripMessage,
	currentRound?: number,
): OpenAiMessage[] {
	const messages: OpenAiMessage[] = [];

	messages.push({ role: "system", content: ctx.toSystemPrompt() });

	const sortedLog = [...ctx.conversationLog].sort((a, b) => a.round - b.round);
	for (const entry of sortedLog) {
		if (entry.kind === "message" && entry.from === ctx.aiId) {
			const { toolCallId, toolArgumentsJson } = entry;
			const rendered = renderEntry(entry, ctx.aiId, ctx.worldSnapshot.entities);
			if (toolCallId && toolArgumentsJson) {
				messages.push({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							type: "function" as const,
							id: toolCallId,
							function: { name: "message", arguments: toolArgumentsJson },
						},
					],
				});
				messages.push({
					role: "tool",
					tool_call_id: toolCallId,
					content: rendered,
				});
			} else {
				messages.push({ role: "assistant", content: rendered });
			}
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
		} else {
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
			messages.push({ role: "user", content: SILENT_TURN });
		}
	}

	messages.push({ role: "user", content: ctx.toCurrentStateUserMessage() });

	return messages;
}
