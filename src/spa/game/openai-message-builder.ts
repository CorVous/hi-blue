import { renderEntry } from "./conversation-log.js";
import type { AiContext } from "./prompt-builder.js";
import type { OpenAiMessage } from "./round-llm-provider.js";
import type { ConversationEntry, ToolRoundtripMessage } from "./types.js";

const SILENT_TURN = "You have received no messages.";

function storedToolCallId(
	entry: ConversationEntry,
	aiId: string,
): string | undefined {
	if (entry.kind === "tool-call") return entry.toolCallId;
	if (
		entry.kind === "message" &&
		entry.from === aiId &&
		entry.toolArgumentsJson
	) {
		return entry.toolCallId;
	}
	return undefined;
}

function uniqueReplayIds(
	log: readonly ConversationEntry[],
	aiId: string,
	priorToolRoundtrip: ToolRoundtripMessage | undefined,
): Map<ConversationEntry, string> {
	const reserved = new Set<string>();
	for (const entry of log) {
		const id = storedToolCallId(entry, aiId);
		if (id) reserved.add(id);
	}
	for (const tc of priorToolRoundtrip?.assistantToolCalls ?? []) {
		reserved.add(tc.id);
	}
	const replayIds = new Map<ConversationEntry, string>();
	const used = new Set<string>();
	log.forEach((entry, index) => {
		const stored = storedToolCallId(entry, aiId);
		if (stored === undefined) return;
		let id = stored;
		for (let attempt = 0; id === "" || used.has(id); attempt++) {
			id = `replay-${index}${attempt === 0 ? "" : `-${attempt}`}`;
			if (reserved.has(id)) id = "";
		}
		used.add(id);
		replayIds.set(entry, id);
	});
	return replayIds;
}

export function buildOpenAiMessages(
	ctx: AiContext,
	priorToolRoundtrip?: ToolRoundtripMessage,
	currentRound?: number,
): OpenAiMessage[] {
	const messages: OpenAiMessage[] = [];

	messages.push({ role: "system", content: ctx.toSystemPrompt() });

	const sortedLog = [...ctx.conversationLog].sort((a, b) => a.round - b.round);
	const replayIds = uniqueReplayIds(sortedLog, ctx.aiId, priorToolRoundtrip);
	for (const entry of sortedLog) {
		if (entry.kind === "message" && entry.from === ctx.aiId) {
			const { toolArgumentsJson } = entry;
			const toolCallId = replayIds.get(entry);
			const rendered = renderEntry(entry, ctx.aiId, ctx.worldSnapshot.entities);
			if (toolCallId !== undefined && toolArgumentsJson) {
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
			const toolCallId = replayIds.get(entry) ?? entry.toolCallId;
			messages.push({
				role: "assistant",
				content: null,
				tool_calls: [
					{
						type: "function" as const,
						id: toolCallId,
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
				tool_call_id: toolCallId,
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
