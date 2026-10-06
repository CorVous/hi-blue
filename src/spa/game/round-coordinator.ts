import { isDevHost } from "../dev-host";
import {
	applyComplicationResult,
	decrementComplicationCountdown,
	isPlayerChatLockedOut,
	resolveExpiredChatLockouts,
	resolveExpiredDirectives,
	tickComplication,
} from "./complication-engine";
import { prepareDaemonTurn, settleDaemonTurn } from "./daemon-turn";
import { isGridPosition, positionsEqual } from "./direction";
import {
	advanceRound,
	appendLogEntry,
	appendMessage,
	appendPrivateSystemNotice,
	isDaemonExhausted,
	isFirstRoundOfRoom,
	personaName,
	resolveToolDisables,
} from "./engine";
import type { DiskEntityState } from "./prompt-builder";
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
import type {
	AiId,
	ComplicationResult,
	ConversationEntry,
	GameState,
	GridPosition,
	RoundActionRecord,
	RoundResult,
	ToolRoundtripMessage,
} from "./types";
import { vistaContains } from "./vista-projector";
import {
	checkBudgetExhausted,
	checkConvergenceTier,
	checkWinCondition,
} from "./win-condition";

export interface RunRoundResult {
	nextState: GameState;
	result: RoundResult;
	toolRoundtrip: Partial<Record<AiId, ToolRoundtripMessage>>;
	diskSnapshots: Partial<Record<AiId, string>>;
	diskEntities: Partial<Record<AiId, Record<string, DiskEntityState>>>;
}

export interface RunRoundOptions {
	rng?: (() => number) | undefined;
	initiative?: AiId[] | undefined;
	priorToolRoundtrip?: Partial<Record<AiId, ToolRoundtripMessage>> | undefined;
	onAiDelta?: ((aiId: AiId, text: string) => void) | undefined;
	priorDiskSnapshots?: Partial<Record<AiId, string>> | undefined;
	onAiTurnComplete?: ((aiId: AiId) => void) | undefined;
	onLifecycle?: ((event: LifecyclePhase) => void) | undefined;
	priorDiskEntities?:
		| Partial<Record<AiId, Record<string, DiskEntityState>>>
		| undefined;
}

const DRIFT_TO_SILENCE_NUDGE =
	"You produced text but did not emit a tool call, so no one received it. Re-emit your previous reply now as a `message({to: <recipient>, content: ...})` tool call, addressed to whoever you originally intended to speak to.";

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
	return `${personaName(state, aiId)} is unresponsive…`;
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
	const newDiskEntities: Partial<
		Record<AiId, Record<string, DiskEntityState>>
	> = {};

	for (const aiId of turnOrder) {
		if (isDaemonExhausted(state, aiId)) {
			state = appendMessage(state, aiId, "blue", unresponsiveLine(state, aiId));
			roundActions.push({
				round: state.round,
				actor: aiId,
				kind: "lockout",
				description: `${personaName(state, aiId)} has exhausted its budget`,
			});
			onAiTurnComplete?.(aiId);
			continue;
		}

		const prepared = prepareDaemonTurn(state, aiId, {
			diskSnapshot: priorDiskSnapshots?.[aiId],
			diskEntities: priorDiskEntities?.[aiId],
			toolRoundtrip: priorToolRoundtrip?.[aiId],
		});
		newDiskSnapshots[aiId] = prepared.diskSnapshot;
		newDiskEntities[aiId] = prepared.promptEntities;
		const { messages, tools } = prepared;

		const {
			assistantText,
			toolCalls: providerToolCalls,
			costUsd,
		} = await streamTurnWithOffTheRecordRetry(
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
		const settled = settleDaemonTurn(state, prepared, {
			toolCalls: providerToolCalls,
			costUsd,
		});
		state = settled.game;
		roundActions.push(...settled.records);
		if (settled.toolRoundtrip !== undefined) {
			newToolRoundtrip[aiId] = settled.toolRoundtrip;
		}

		if (settled.passed && assistantText && isDevHost()) {
			console.log(
				`[dev] ${aiId} emitted free-form text without a tool call (dropped after retry):`,
				assistantText,
			);
		}

		onAiTurnComplete?.(aiId);
	}

	state = advanceRound(state);

	let chatLockoutTriggered: RoundResult["chatLockoutTriggered"] | undefined;
	let chatLockoutsResolved: AiId[] | undefined;

	state = restoreExpiredToolDisables(state);
	const { nextState: stateAfterChatLockouts, resolvedAiIds } =
		resolveExpiredChatLockouts(state);
	state = stateAfterChatLockouts;
	state = expireSysadminDirectives(state);

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

	const stateAfterComplication = state;
	const unlockedAiIds = [...new Set(resolvedAiIds)].filter(
		(aiId) => !isPlayerChatLockedOut(stateAfterComplication, aiId),
	);
	if (unlockedAiIds.length > 0) {
		chatLockoutsResolved = unlockedAiIds;
	}

	state = evaluateConvergenceObjectives(
		state,
		isFirstRoundOfRoom(game) ? {} : game.personaSpatial,
	);

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

function occupantIdsOf(
	personaSpatial: GameState["personaSpatial"],
	cell: GridPosition,
): string {
	return Object.entries(personaSpatial)
		.filter(([, spatial]) => positionsEqual(spatial.position, cell))
		.map(([daemonId]) => daemonId)
		.sort()
		.join(",");
}

function evaluateConvergenceObjectives(
	game: GameState,
	personaSpatialAlreadyTold: GameState["personaSpatial"],
): GameState {
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
		if (!spaceEntity || !isGridPosition(spaceEntity.holder)) continue;
		const spaceCell = spaceEntity.holder;

		const convergenceComplete = tier === 2;
		const occupantsUnchanged =
			occupantIdsOf(state.personaSpatial, spaceCell) ===
			occupantIdsOf(personaSpatialAlreadyTold, spaceCell);
		if (occupantsUnchanged && !convergenceComplete) continue;

		const witnessFlavor =
			tier === 1
				? (spaceEntity.convergenceTier1Flavor ?? "Something stirs here.")
				: (spaceEntity.convergenceTier2Flavor ?? "Two presences converge.");
		const actorFlavor =
			tier === 1
				? (spaceEntity.convergenceTier1ActorFlavor ??
					"You linger here; the place feels poised for company.")
				: (spaceEntity.convergenceTier2ActorFlavor ??
					"You stand here; another presence shares the place with you.");

		for (const [daemonId, spatial] of Object.entries(state.personaSpatial)) {
			const isOccupant = positionsEqual(spatial.position, spaceCell);
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

		if (convergenceComplete) {
			state = {
				...state,
				world: {
					...state.world,
					entities: state.world.entities.map((e) =>
						e.id === spaceId
							? { ...e, satisfactionState: "satisfied" as const }
							: e,
					),
				},
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
