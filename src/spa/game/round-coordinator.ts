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
	appendMessage,
	appendPrivateSystemNotice,
	appendWitnessedConvergence,
	appendWitnessedObstacleShift,
	FAREWELL_LINE,
	isAiLockedOut,
	resolveToolDisables,
} from "./engine";
import { buildOpenAiMessages } from "./openai-message-builder";
import {
	buildAiContext,
	buildDiskEntityState,
	buildDiskSnapshot,
	renderPerceptionDelta,
} from "./prompt-builder";
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
	checkConvergenceTier,
	checkLoseCondition,
	checkWinCondition,
} from "./win-condition";

function isDevHost(): boolean {
	return (
		typeof __WORKER_BASE_URL__ !== "undefined" &&
		__WORKER_BASE_URL__ === "http://localhost:8787" &&
		typeof location !== "undefined" &&
		location.origin === __WORKER_BASE_URL__
	);
}

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
	completionSink?: ((aiId: AiId, text: string) => void) | undefined;
	onAiDelta?: ((aiId: AiId, text: string) => void) | undefined;
	priorDiskSnapshots?: Partial<Record<AiId, string>> | undefined;
	onAiTurnComplete?: ((aiId: AiId) => void) | undefined;
	onLifecycle?: ((event: LifecyclePhase) => void) | undefined;
	priorDiskEntities?: Partial<Record<AiId, DiskEntityStates>> | undefined;
}

const DRIFT_TO_SILENCE_NUDGE =
	"You produced text but did not emit a tool call, so no one received it. Re-emit your previous reply now as a `message({to: <recipient>, content: ...})` tool call, addressed to whoever you originally intended to speak to.";

const ONE_ACTION_PER_TURN_REASON = "only one action tool call per turn";

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
		completionSink,
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
		if (isAiLockedOut(state, aiId)) {
			state = appendMessage(state, aiId, "blue", unresponsiveLine(state, aiId));
			roundActions.push({
				round: state.round,
				actor: aiId,
				kind: "lockout",
				description: `${state.personas[aiId]?.name ?? aiId} is locked out`,
			});
			completionSink?.(aiId, "");
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
		newDiskSnapshots[aiId] = buildDiskSnapshot(ctx);
		newDiskEntities[aiId] = buildDiskEntityState(ctx);
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

		completionSink?.(aiId, assistantText);

		const action: AiTurnAction = { aiId };

		type PendingEntry =
			| {
					kind: "parseFail";
					tc: { id: string; name: string; argumentsJson: string };
					description: string;
					reason: string;
			  }
			| {
					kind: "message";
					tc: { id: string; name: string; argumentsJson: string };
			  }
			| {
					kind: "actionAccepted";
					tc: { id: string; name: string; argumentsJson: string };
			  }
			| {
					kind: "actionRejected";
					tc: { id: string; name: string; argumentsJson: string };
					description: string;
					reason: string;
			  };
		const toolCallsInEmissionOrder: PendingEntry[] = [];

		let actionAssigned = false;

		const round = state.round;
		const actorName = state.personas[aiId]?.name ?? aiId;

		for (const tc of toolCalls) {
			const parseResult = parseToolCallArguments(
				tc.name as ToolName,
				tc.argumentsJson,
			);
			const tcTriple = {
				id: tc.id,
				name: tc.name,
				argumentsJson: tc.argumentsJson,
			};

			if (!parseResult.ok) {
				const failDesc = `${actorName} tried to ${tc.name} but failed: ${parseResult.reason}`;
				roundActions.push({
					round,
					actor: aiId,
					kind: "tool_failure",
					description: failDesc,
				});
				toolCallsInEmissionOrder.push({
					kind: "parseFail",
					tc: tcTriple,
					description: failDesc,
					reason: parseResult.reason,
				});
			} else if (tc.name === "message") {
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
				roundActions.push({
					round,
					actor: aiId,
					kind: "tool_failure",
					description: dupDesc,
				});
				toolCallsInEmissionOrder.push({
					kind: "actionRejected",
					tc: tcTriple,
					description: dupDesc,
					reason: ONE_ACTION_PER_TURN_REASON,
				});
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

		const lockedOutBeforeDispatch = new Set(state.lockedOut);

		const dispatchResult = dispatchAiTurn(
			state,
			action,
			costUsd !== undefined ? { costUsd } : {},
		);
		state = dispatchResult.game;

		const budgetJustExhausted =
			!lockedOutBeforeDispatch.has(aiId) && state.lockedOut.has(aiId);
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

		const perceptionDeltaLines = renderPerceptionDelta(ctx, priorEntities);

		const recordedAssistantToolCalls: Array<{
			id: string;
			name: string;
			argumentsJson: string;
		}> = [];
		const recordedToolResults: Array<{
			tool_call_id: string;
			success: boolean;
			description: string;
			reason?: string;
		}> = [];

		let perceptionDeltaMerged = false;

		function appendToolCallEntry(
			entry: PendingEntry,
			success: boolean,
			description: string,
			diskDelta?: string,
		) {
			const toolCallEntry: ConversationEntry = {
				kind: "tool-call",
				round: state.round,
				aiId: aiId,
				toolCallId: entry.tc.id,
				toolArgumentsJson: entry.tc.argumentsJson,
				toolName: entry.tc.name,
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

		let nextMessageIdx = 0;
		for (const entry of toolCallsInEmissionOrder) {
			if (entry.kind === "parseFail") {
				recordedAssistantToolCalls.push(entry.tc);
				recordedToolResults.push({
					tool_call_id: entry.tc.id,
					success: false,
					description: entry.description,
					reason: entry.reason,
				});
				appendToolCallEntry(entry, false, entry.description);
			} else if (entry.kind === "actionRejected") {
				recordedAssistantToolCalls.push(entry.tc);
				recordedToolResults.push({
					tool_call_id: entry.tc.id,
					success: false,
					description: entry.description,
					reason: entry.reason,
				});
				appendToolCallEntry(entry, false, entry.description);
			} else if (entry.kind === "message") {
				const rec = messageRecords[nextMessageIdx++];
				const messageFailed = rec?.kind === "tool_failure";
				if (messageFailed) {
					recordedAssistantToolCalls.push(entry.tc);
					recordedToolResults.push({
						tool_call_id: entry.tc.id,
						success: false,
						description: rec.description,
					});
				}
			} else {
				recordedAssistantToolCalls.push(entry.tc);
				const pickUpAutoExamine = dispatchResult.actorPrivateToolResult;
				if (pickUpAutoExamine !== undefined) {
					const { description, success } = pickUpAutoExamine;
					recordedToolResults.push({
						tool_call_id: entry.tc.id,
						success,
						description,
					});
					appendToolCallEntry(entry, success, description);
				} else {
					const success = actionRecord?.kind === "tool_success";
					const description = actionRecord?.description ?? "";
					recordedToolResults.push({
						tool_call_id: entry.tc.id,
						success,
						description,
					});
					let diskDelta = dispatchResult.actorDiskDelta;
					if (!perceptionDeltaMerged && perceptionDeltaLines.length > 0) {
						const perceptionDeltaText = perceptionDeltaLines.join("\n");
						diskDelta = diskDelta
							? `${diskDelta}\n${perceptionDeltaText}`
							: perceptionDeltaText;
						perceptionDeltaMerged = true;
					}
					appendToolCallEntry(entry, success, description, diskDelta);
				}
			}
		}

		if (recordedAssistantToolCalls.length > 0) {
			newToolRoundtrip[aiId] = {
				assistantToolCalls: recordedAssistantToolCalls,
				toolResults: recordedToolResults,
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
	} else if (checkLoseCondition(state.lockedOut, Object.keys(state.personas))) {
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
		state = appendWitnessedObstacleShift(state, daemonId, entry);
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
			state = appendWitnessedConvergence(state, daemonId, entry);
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
