import { isDevHost } from "../dev-host";
import { availableTools } from "./available-tools";
import {
	applyComplicationResult,
	decrementComplicationCountdown,
	resolveExpiredChatLockouts,
	resolveExpiredDirectives,
	tickComplication,
} from "./complication-engine";
import { dispatchAiTurn } from "./dispatcher";
import {
	advanceRound,
	appendLogEntry,
	appendMessage,
	appendPrivateSystemNotice,
	FAREWELL_LINE,
	isDaemonExhausted,
	resolveToolDisables,
} from "./engine";
import { buildOpenAiMessages } from "./openai-message-builder";
import { buildAiContext, renderPerceptionDelta } from "./prompt-builder";
import type {
	LifecyclePhase,
	OpenAiMessage,
	RoundLLMProvider,
	RoundTurnResult,
} from "./round-llm-provider";
import {
	drawDirectiveText,
	formatDirectiveDelivery,
	formatDirectiveExpiry,
	formatDirectiveRevocation,
} from "./sysadmin-directive";
import { parseToolCallArguments } from "./tool-registry";
import type {
	AiId,
	AiTurnAction,
	ComplicationResult,
	ConversationEntry,
	GameState,
	GridPosition,
	RoundActionRecord,
	RoundResult,
	ToolName,
	ToolRoundtripMessage,
} from "./types";
import { vistaContains } from "./vista-projector";
import {
	checkBudgetExhausted,
	checkConvergenceTier,
	checkWinCondition,
} from "./win-condition";

type DiskEntityStates = Record<
	string,
	{ inVista: boolean; satisfied: boolean }
>;

export interface RunRoundResult {
	nextState: GameState;
	result: RoundResult;
	toolRoundtrip: Partial<Record<AiId, ToolRoundtripMessage>>;
	diskSnapshots: Partial<Record<AiId, string>>;
	diskEntities: Partial<Record<AiId, DiskEntityStates>>;
}

export interface RunRoundOptions {
	rng?: (() => number) | undefined;
	initiative?: AiId[] | undefined;
	priorToolRoundtrip?: Partial<Record<AiId, ToolRoundtripMessage>> | undefined;
	onAiDelta?: ((aiId: AiId, text: string) => void) | undefined;
	priorDiskSnapshots?: Partial<Record<AiId, string>> | undefined;
	onAiTurnComplete?: ((aiId: AiId) => void) | undefined;
	onLifecycle?: ((event: LifecyclePhase) => void) | undefined;
	priorDiskEntities?: Partial<Record<AiId, DiskEntityStates>> | undefined;
}

const DRIFT_TO_SILENCE_NUDGE =
	"You produced text but did not emit a tool call, so no one received it. Re-emit your previous reply now as a `message({to: <recipient>, content: ...})` tool call, addressed to whoever you originally intended to speak to.";

const ONE_ACTION_PER_TURN_REASON = "only one action tool call per turn";
const ONE_MESSAGE_PER_TURN_REASON = "only one message tool call per turn";

interface StreamedTurn {
	assistantText: string;
	toolCalls: RoundTurnResult["toolCalls"];
	costUsd: number | undefined;
}

function driftedToSilence(turn: RoundTurnResult): boolean {
	return turn.assistantText !== "" && turn.toolCalls.length === 0;
}

async function streamTurnWithOffTheRecordRetry(
	stream: (messages: OpenAiMessage[]) => Promise<RoundTurnResult>,
	messages: OpenAiMessage[],
): Promise<StreamedTurn> {
	const firstAttempt = await stream(messages);
	if (!driftedToSilence(firstAttempt)) {
		return {
			assistantText: firstAttempt.assistantText,
			toolCalls: firstAttempt.toolCalls,
			costUsd: firstAttempt.costUsd,
		};
	}
	const retry = await stream([
		...messages,
		{ role: "assistant", content: firstAttempt.assistantText },
		{ role: "user", content: DRIFT_TO_SILENCE_NUDGE },
	]);
	return {
		assistantText: retry.assistantText,
		toolCalls: retry.toolCalls,
		costUsd:
			retry.costUsd === undefined
				? firstAttempt.costUsd
				: (firstAttempt.costUsd ?? 0) + retry.costUsd,
	};
}

function assertInitiativePermutes(initiative: AiId[], aiOrder: AiId[]): void {
	const sorted = [...initiative].sort();
	const expected = [...aiOrder].sort();
	if (
		sorted.length !== expected.length ||
		sorted.some((id, i) => id !== expected[i])
	) {
		throw new Error(
			`initiative must be a permutation of ${JSON.stringify(aiOrder)}, got: ${JSON.stringify(initiative)}`,
		);
	}
}

function unresponsiveLine(state: GameState, aiId: AiId): string {
	return `${state.personas[aiId]?.name ?? aiId} is unresponsive…`;
}

export async function runRound(
	game: GameState,
	addressed: AiId,
	playerMessage: string,
	provider: RoundLLMProvider,
	options: RunRoundOptions = {},
): Promise<RunRoundResult> {
	const {
		rng = Math.random,
		initiative,
		priorToolRoundtrip,
		onAiDelta,
		priorDiskSnapshots,
		onAiTurnComplete,
		onLifecycle,
		priorDiskEntities,
	} = options;

	const aiOrder = Object.keys(game.personas);
	if (initiative !== undefined) assertInitiativePermutes(initiative, aiOrder);
	const turnOrder = initiative ?? aiOrder;

	let state = appendMessage(game, "blue", addressed, playerMessage);

	const roundActions: RoundActionRecord[] = [];
	const newToolRoundtrip: Partial<Record<AiId, ToolRoundtripMessage>> = {};
	const newDiskSnapshots: Partial<Record<AiId, string>> = {};
	const newDiskEntities: Partial<Record<AiId, DiskEntityStates>> = {};

	for (const aiId of turnOrder) {
		if (isDaemonExhausted(state, aiId)) {
			state = appendMessage(state, aiId, "blue", unresponsiveLine(state, aiId));
			roundActions.push({
				round: state.round,
				actor: aiId,
				kind: "lockout",
				description: `${state.personas[aiId]?.name ?? aiId} has exhausted its budget`,
			});
			onAiTurnComplete?.(aiId);
			continue;
		}

		const priorSnapshot = priorDiskSnapshots?.[aiId];
		const priorEntities = priorDiskEntities?.[aiId];
		const ctx = buildAiContext(state, aiId, {
			...(priorSnapshot !== undefined
				? { prevDiskSnapshot: priorSnapshot }
				: {}),
			...(priorEntities !== undefined
				? { prevDiskEntities: priorEntities }
				: {}),
		});
		newDiskSnapshots[aiId] = ctx.diskSnapshot();
		const promptEntities = ctx.diskEntities();
		newDiskEntities[aiId] = promptEntities;
		const priorRoundtrip = priorToolRoundtrip?.[aiId];
		const messages = buildOpenAiMessages(ctx, priorRoundtrip, state.round);

		const tools = availableTools(state, aiId, state.activeComplications);

		const { assistantText, toolCalls, costUsd } =
			await streamTurnWithOffTheRecordRetry(
				(turnMessages) =>
					provider.streamRound(
						turnMessages,
						tools,
						onAiDelta ? (text) => onAiDelta(aiId, text) : undefined,
						aiId,
						onLifecycle,
					),
				messages,
			);

		const action: AiTurnAction = { aiId };

		type EmittedToolCall = { id: string; name: string; argumentsJson: string };
		type PendingEntry =
			| { kind: "message"; tc: EmittedToolCall }
			| { kind: "actionAccepted"; tc: EmittedToolCall }
			| {
					kind: "rejected";
					tc: EmittedToolCall;
					description: string;
			  };
		const toolCallsInEmissionOrder: PendingEntry[] = [];

		let actionAssigned = false;
		let messageAssigned = false;

		const round = state.round;
		const actorName = state.personas[aiId]?.name ?? aiId;

		function rejectToolCall(tc: EmittedToolCall, description: string) {
			roundActions.push({
				round,
				actor: aiId,
				kind: "tool_failure",
				description,
			});
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
				const failDesc = `${actorName} tried to ${tc.name} but failed: ${parseResult.reason}`;
				rejectToolCall(tcTriple, failDesc);
			} else if (tc.name === "message" && messageAssigned) {
				const dupDesc = `${actorName} tried to send more than one message in a turn: ${ONE_MESSAGE_PER_TURN_REASON}`;
				rejectToolCall(tcTriple, dupDesc);
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
				const dupDesc = `${actorName} tried to take more than one action in a turn: ${ONE_ACTION_PER_TURN_REASON}`;
				rejectToolCall(tcTriple, dupDesc);
			}
		}

		const emittedNoUsableToolCall =
			!action.toolCall && action.messages === undefined;
		if (emittedNoUsableToolCall) {
			if (assistantText && isDevHost()) {
				console.log(
					`[dev] ${aiId} emitted free-form text without a tool call (dropped after retry):`,
					assistantText,
				);
			}
			action.pass = true;
		}

		const exhaustedBeforeDispatch = new Set(state.exhausted);

		const dispatchResult = dispatchAiTurn(
			state,
			action,
			costUsd !== undefined ? { costUsd } : {},
		);
		state = dispatchResult.game;

		const budgetJustExhausted =
			!exhaustedBeforeDispatch.has(aiId) && state.exhausted.has(aiId);
		if (budgetJustExhausted) {
			const personaName = state.personas[aiId]?.name ?? aiId;
			const farewellContent = FAREWELL_LINE(personaName);
			state = appendMessage(state, aiId, "blue", farewellContent);
			roundActions.push({
				round: state.round,
				actor: aiId,
				kind: "message",
				description: farewellContent,
			});
		}

		for (const record of dispatchResult.records) {
			roundActions.push(record);
		}

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
				aiId: aiId,
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
				...renderPerceptionDelta(buildAiContext(state, aiId), promptEntities),
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

		if (failedMessageCalls.length > 0) {
			newToolRoundtrip[aiId] = {
				assistantToolCalls: failedMessageCalls,
				toolResults: failedMessageResults,
			};
		}

		onAiTurnComplete?.(aiId);
	}

	state = advanceRound(state);

	let chatLockoutTriggered: RoundResult["chatLockoutTriggered"] | undefined;
	let chatLockoutsResolved: AiId[] | undefined;

	const complicationResult = tickComplication(state, rng);
	if (complicationResult !== null) {
		const { fired } = complicationResult;
		if (fired.kind === "sysadmin_directive") {
			state = issueSysadminDirective(
				state,
				complicationResult,
				fired.target,
				rng,
			);
		} else if (fired.kind === "obstacle_shift") {
			state = applyComplicationResult(state, complicationResult, rng);
			state = shiftObstacle(state, fired);
		} else {
			state = applyComplicationResult(state, complicationResult, rng);
			if (fired.kind === "tool_disable") {
				state = appendPrivateSystemNotice(
					state,
					fired.target,
					`Sysadmin: Your ${fired.tool} tool has been disabled.`,
				);
			}
			if (fired.kind === "chat_lockout") {
				chatLockoutTriggered = {
					aiId: fired.target,
					message: unresponsiveLine(state, fired.target),
				};
			}
		}
	} else {
		state = decrementComplicationCountdown(state);
	}

	state = restoreExpiredToolDisables(state);

	const { nextState: stateAfterChatLockouts, resolvedAiIds } =
		resolveExpiredChatLockouts(state);
	state = stateAfterChatLockouts;
	if (resolvedAiIds.length > 0) {
		chatLockoutsResolved = resolvedAiIds;
	}

	state = expireSysadminDirectives(state);
	state = evaluateConvergenceObjectives(state);

	let gameEnded = false;
	if (checkWinCondition(state.world, state.objectives)) {
		state = { ...state, isComplete: true, outcome: "win" };
		gameEnded = true;
	} else if (
		checkBudgetExhausted(state.exhausted, Object.keys(state.personas))
	) {
		state = { ...state, isComplete: true, outcome: "lose" };
		gameEnded = true;
	}

	const result: RoundResult = {
		round: state.round,
		actions: roundActions,
		gameEnded,
		...(chatLockoutTriggered !== undefined ? { chatLockoutTriggered } : {}),
		...(chatLockoutsResolved !== undefined ? { chatLockoutsResolved } : {}),
	};

	return {
		nextState: state,
		result,
		toolRoundtrip: newToolRoundtrip,
		diskSnapshots: newDiskSnapshots,
		diskEntities: newDiskEntities,
	};
}

function issueSysadminDirective(
	game: GameState,
	complicationResult: ComplicationResult,
	target: AiId,
	rng: () => number,
): GameState {
	const directiveText = drawDirectiveText(rng);
	let state = revokeActiveDirective(game, target);
	state = applyComplicationResult(state, complicationResult, rng);
	state = {
		...state,
		activeComplications: state.activeComplications.map((c) =>
			c.kind === "sysadmin_directive" && c.target === target
				? { ...c, directive: directiveText }
				: c,
		),
	};
	return appendMessage(
		state,
		"sysadmin",
		target,
		formatDirectiveDelivery(directiveText),
	);
}

function revokeActiveDirective(game: GameState, target: AiId): GameState {
	const existing = game.activeComplications.find(
		(c): c is Extract<typeof c, { kind: "sysadmin_directive" }> =>
			c.kind === "sysadmin_directive" && c.target === target,
	);
	if (!existing) return game;
	const state = appendMessage(
		game,
		"sysadmin",
		target,
		formatDirectiveRevocation(existing.directive),
	);
	return {
		...state,
		activeComplications: state.activeComplications.filter(
			(c) => !(c.kind === "sysadmin_directive" && c.target === target),
		),
	};
}

function shiftObstacle(
	game: GameState,
	shift: Extract<ComplicationResult["fired"], { kind: "obstacle_shift" }>,
): GameState {
	const obstacle = game.world.entities.find((e) => e.id === shift.obstacleId);
	if (!obstacle) return game;

	let state: GameState = {
		...game,
		world: {
			...game.world,
			entities: game.world.entities.map((e) =>
				e.id === shift.obstacleId ? { ...e, holder: shift.toCell } : e,
			),
		},
	};

	for (const [daemonId, spatial] of Object.entries(state.personaSpatial)) {
		if (!vistaContains(spatial.position, shift.fromCell)) continue;

		const entry: Extract<
			ConversationEntry,
			{ kind: "witnessed-obstacle-shift" }
		> = {
			kind: "witnessed-obstacle-shift",
			round: state.round,
			obstacleId: shift.obstacleId,
			fromCell: shift.fromCell,
			toCell: shift.toCell,
			flavor: obstacle.shiftFlavor ?? "",
		};
		state = appendLogEntry(state, daemonId, entry);
	}
	return state;
}

function restoreExpiredToolDisables(game: GameState): GameState {
	const { game: resolvedGame, resolved } = resolveToolDisables(game);
	let state = resolvedGame;
	for (const { target, tool } of resolved) {
		state = appendPrivateSystemNotice(
			state,
			target,
			`Sysadmin: Your ${tool} tool has been restored.`,
		);
	}
	return state;
}

function expireSysadminDirectives(game: GameState): GameState {
	const { nextState, resolved } = resolveExpiredDirectives(game);
	let state = nextState;
	for (const { target, directive } of resolved) {
		state = appendMessage(
			state,
			"sysadmin",
			target,
			formatDirectiveExpiry(directive),
		);
	}
	return state;
}

function evaluateConvergenceObjectives(game: GameState): GameState {
	let state = game;
	for (const objective of state.objectives) {
		if (objective.kind !== "convergence") continue;
		if (objective.satisfactionState !== "pending") continue;

		const { tier, spaceId } = checkConvergenceTier(
			objective,
			state.world,
			state.personaSpatial,
		);

		if (tier === 0) continue;

		const spaceEntity = state.world.entities.find((e) => e.id === spaceId);
		const spaceCell =
			spaceEntity &&
			typeof spaceEntity.holder === "object" &&
			spaceEntity.holder !== null
				? (spaceEntity.holder as GridPosition)
				: null;

		if (!spaceCell) continue;

		const witnessFlavor =
			tier === 1
				? (spaceEntity?.convergenceTier1Flavor ?? "Something stirs here.")
				: (spaceEntity?.convergenceTier2Flavor ?? "Two presences converge.");
		const actorFlavor =
			tier === 1
				? (spaceEntity?.convergenceTier1ActorFlavor ??
					"You linger here; the place feels poised for company.")
				: (spaceEntity?.convergenceTier2ActorFlavor ??
					"You stand here; another presence shares the place with you.");

		for (const [daemonId, spatial] of Object.entries(state.personaSpatial)) {
			const isOccupant =
				spatial.position.row === spaceCell.row &&
				spatial.position.col === spaceCell.col;
			const witnessesCell = vistaContains(spatial.position, spaceCell);
			if (!isOccupant && !witnessesCell) continue;

			const entry: Extract<
				ConversationEntry,
				{ kind: "witnessed-convergence" }
			> = {
				kind: "witnessed-convergence",
				round: state.round,
				spaceId,
				tier,
				flavor: isOccupant ? actorFlavor : witnessFlavor,
				audience: isOccupant ? "actor" : "witness",
			};
			state = appendLogEntry(state, daemonId, entry);
		}

		const convergenceComplete = tier === 2;
		if (convergenceComplete) {
			state = {
				...state,
				objectives: state.objectives.map((o) =>
					o.id === objective.id
						? { ...o, satisfactionState: "satisfied" as const }
						: o,
				),
			};
		}
	}
	return state;
}
