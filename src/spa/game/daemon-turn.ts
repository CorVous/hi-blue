import { availableTools } from "./available-tools";
import { dispatchAiTurn } from "./dispatcher";
import { appendMessage, FAREWELL_LINE, personaName } from "./engine";
import { buildOpenAiMessages } from "./openai-message-builder";
import {
	buildAiContext,
	type DiskEntityState,
	renderPerceptionDelta,
} from "./prompt-builder";
import type { OpenAiMessage } from "./round-llm-provider";
import type { OpenAiTool } from "./tool-registry";
import { parseToolCallArguments } from "./tool-registry";
import type {
	AiId,
	AiTurnAction,
	ConversationEntry,
	GameState,
	RoundActionRecord,
	ToolName,
	ToolRoundtripMessage,
} from "./types";

const ONE_ACTION_PER_TURN_REASON = "only one action tool call per turn";
const ONE_MESSAGE_PER_TURN_REASON = "only one message tool call per turn";

export interface EmittedToolCall {
	id: string;
	name: string;
	argumentsJson: string;
}

export interface DaemonTurnMemory {
	diskSnapshot?: string | undefined;
	diskEntities?: Record<string, DiskEntityState> | undefined;
	toolRoundtrip?: ToolRoundtripMessage | undefined;
}

export interface PreparedDaemonTurn {
	aiId: AiId;
	messages: OpenAiMessage[];
	tools: OpenAiTool[];
	diskSnapshot: string;
	promptEntities: Record<string, DiskEntityState>;
}

export interface DaemonTurnResponse {
	toolCalls: EmittedToolCall[];
	costUsd?: number | undefined;
}

export function prepareDaemonTurn(
	game: GameState,
	aiId: AiId,
	memory: DaemonTurnMemory,
): PreparedDaemonTurn {
	const ctx = buildAiContext(game, aiId, {
		prevDiskSnapshot: memory.diskSnapshot,
		prevDiskEntities: memory.diskEntities,
	});
	return {
		aiId,
		messages: buildOpenAiMessages(ctx, memory.toolRoundtrip, game.round),
		tools: availableTools(game, aiId, game.activeComplications),
		diskSnapshot: ctx.diskSnapshot(),
		promptEntities: ctx.diskEntities(),
	};
}

export interface CarriedDaemonMemory extends DaemonTurnMemory {
	diskSnapshot: string;
	diskEntities: Record<string, DiskEntityState>;
}

export function memoryAfterTurn(
	prepared: PreparedDaemonTurn,
	toolRoundtrip?: ToolRoundtripMessage,
): CarriedDaemonMemory {
	return {
		diskSnapshot: prepared.diskSnapshot,
		diskEntities: prepared.promptEntities,
		toolRoundtrip,
	};
}

export interface SettledDaemonTurn {
	game: GameState;
	records: RoundActionRecord[];
	memory: CarriedDaemonMemory;
	passed: boolean;
}

type PendingEntry =
	| { kind: "message"; tc: EmittedToolCall }
	| { kind: "actionAccepted"; tc: EmittedToolCall }
	| { kind: "rejected"; tc: EmittedToolCall; description: string };

export function settleDaemonTurn(
	game: GameState,
	prepared: PreparedDaemonTurn,
	response: DaemonTurnResponse,
): SettledDaemonTurn {
	const { aiId } = prepared;
	const toolCalls = withUniqueToolCallIds(
		response.toolCalls,
		replayedToolCallIds(prepared.messages),
		`${aiId}-r${game.round}`,
	);

	const records: RoundActionRecord[] = [];
	const action: AiTurnAction = { aiId };
	const toolCallsInEmissionOrder: PendingEntry[] = [];
	let actionAssigned = false;
	let messageAssigned = false;
	const round = game.round;
	const actorName = personaName(game, aiId);

	function rejectToolCall(tc: EmittedToolCall, description: string) {
		records.push({ round, actor: aiId, kind: "tool_failure", description });
		toolCallsInEmissionOrder.push({ kind: "rejected", tc, description });
	}

	for (const tc of toolCalls) {
		const parseResult = parseToolCallArguments(
			tc.name as ToolName,
			tc.argumentsJson,
		);
		const tcTriple: EmittedToolCall = {
			id: tc.id,
			name: tc.name,
			argumentsJson: tc.argumentsJson,
		};

		if (!parseResult.ok) {
			rejectToolCall(
				tcTriple,
				`${actorName} tried to ${tc.name} but failed: ${parseResult.reason}`,
			);
		} else if (tc.name === "message" && messageAssigned) {
			rejectToolCall(
				tcTriple,
				`${actorName} tried to send more than one message in a turn: ${ONE_MESSAGE_PER_TURN_REASON}`,
			);
		} else if (tc.name === "message") {
			messageAssigned = true;
			const msgArgs = parseResult.args as { to: string; content: string };
			action.messages = action.messages ?? [];
			action.messages.push({
				to: msgArgs.to as AiId | "blue",
				content: msgArgs.content,
				toolCallId: tcTriple.id,
				toolArgumentsJson: tcTriple.argumentsJson,
			});
			toolCallsInEmissionOrder.push({ kind: "message", tc: tcTriple });
		} else if (!actionAssigned) {
			action.toolCall = {
				name: tc.name as ToolName,
				args: parseResult.args as Record<string, string>,
			};
			actionAssigned = true;
			toolCallsInEmissionOrder.push({ kind: "actionAccepted", tc: tcTriple });
		} else {
			rejectToolCall(
				tcTriple,
				`${actorName} tried to take more than one action in a turn: ${ONE_ACTION_PER_TURN_REASON}`,
			);
		}
	}

	const passed = !action.toolCall && action.messages === undefined;
	if (passed) action.pass = true;

	const dispatchResult = dispatchAiTurn(
		game,
		action,
		response.costUsd !== undefined ? { costUsd: response.costUsd } : {},
	);
	let state = dispatchResult.game;

	if (dispatchResult.justExhausted) {
		const farewellContent = FAREWELL_LINE(personaName(state, aiId));
		state = appendMessage(state, aiId, "blue", farewellContent);
		records.push({
			round: state.round,
			actor: aiId,
			kind: "message",
			description: farewellContent,
		});
	}

	records.push(...dispatchResult.records);

	const messageRecordCount = action.messages?.length ?? 0;
	const messageRecords = dispatchResult.records.slice(0, messageRecordCount);
	const actionRecord =
		actionAssigned && dispatchResult.actorPrivateToolResult === undefined
			? dispatchResult.records[messageRecordCount]
			: undefined;

	const failedMessageCalls: EmittedToolCall[] = [];
	const failedMessageResults: ToolRoundtripMessage["toolResults"] = [];

	function appendToolCallEntry(
		tc: EmittedToolCall,
		success: boolean,
		description: string,
		diskDelta?: string,
	) {
		const toolCallEntry: ConversationEntry = {
			kind: "tool-call",
			round: state.round,
			aiId,
			toolCallId: tc.id,
			toolArgumentsJson: tc.argumentsJson,
			toolName: tc.name,
			result: description,
			success,
			...(diskDelta !== undefined ? { diskDelta } : {}),
		};
		state = {
			...state,
			conversationLogs: {
				...state.conversationLogs,
				[aiId]: [...(state.conversationLogs[aiId] ?? []), toolCallEntry],
			},
		};
	}

	function actionDiskDelta(): string | undefined {
		const lines = [
			...(dispatchResult.actorDiskDelta !== undefined
				? [dispatchResult.actorDiskDelta]
				: []),
			...renderPerceptionDelta(
				buildAiContext(state, aiId),
				prepared.promptEntities,
			),
		];
		return lines.length > 0 ? lines.join("\n") : undefined;
	}

	let nextMessageIdx = 0;
	for (const entry of toolCallsInEmissionOrder) {
		if (entry.kind === "rejected") {
			appendToolCallEntry(entry.tc, false, entry.description);
		} else if (entry.kind === "message") {
			const rec = messageRecords[nextMessageIdx++];
			if (rec?.kind === "tool_failure") {
				failedMessageCalls.push(entry.tc);
				failedMessageResults.push({
					tool_call_id: entry.tc.id,
					success: false,
					description: rec.description,
				});
			}
		} else {
			const { success, description } =
				dispatchResult.actorPrivateToolResult ?? {
					success: actionRecord?.kind === "tool_success",
					description: actionRecord?.description ?? "",
				};
			appendToolCallEntry(entry.tc, success, description, actionDiskDelta());
		}
	}

	const toolRoundtrip =
		failedMessageCalls.length > 0
			? {
					assistantToolCalls: failedMessageCalls,
					toolResults: failedMessageResults,
				}
			: undefined;

	return {
		game: state,
		records,
		memory: memoryAfterTurn(prepared, toolRoundtrip),
		passed,
	};
}

function replayedToolCallIds(messages: OpenAiMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const toolCall of message.tool_calls ?? []) ids.add(toolCall.id);
	}
	return ids;
}

function withUniqueToolCallIds<T extends { id: string }>(
	toolCalls: T[],
	takenIds: Set<string>,
	fallbackPrefix: string,
): T[] {
	const taken = new Set(takenIds);
	return toolCalls.map((tc, index) => {
		let id = tc.id;
		for (let attempt = 0; !id || taken.has(id); attempt++) {
			id =
				attempt === 0
					? `call-${fallbackPrefix}-${index}`
					: `call-${fallbackPrefix}-${index}-${attempt}`;
		}
		taken.add(id);
		return id === tc.id ? tc : { ...tc, id };
	});
}
