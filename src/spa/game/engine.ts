import { GRID_COLS, GRID_ROWS } from "./direction.js";
import { buildObjectiveRecords } from "./objective-record-builder.js";
import {
	boundSpaces,
	carryPairs,
	interestingObjects,
	obstacles,
	standaloneObjectives,
} from "./pack-selectors.js";
import type {
	ActiveComplication,
	AiBudget,
	AiId,
	AiPersona,
	ComplicationSchedule,
	ContentPack,
	ConversationEntry,
	GameState,
	GridPosition,
	ObjectiveType,
	PersonaSpatialState,
	ToolName,
	WorldEntity,
} from "./types";

export const FAREWELL_LINE = (name: string): string =>
	`${name}'s daemon is winding down — goodbye, blue.`;

const DEFAULT_BUDGET_PER_AI_USD = 0.5;

function drawInitialComplicationCountdown(rng: () => number): number {
	return 1 + Math.floor(rng() * 5);
}

export function startGame(
	personas: Record<AiId, AiPersona>,
	contentPack: ContentPack,
	opts: {
		budgetPerAi?: number;
		rng?: () => number;
		objectiveTypes?: ObjectiveType[];
	} = {},
): GameState {
	const rng = opts.rng ?? Math.random;
	const budgetPerAi = opts.budgetPerAi ?? DEFAULT_BUDGET_PER_AI_USD;
	const aiIds = Object.keys(personas);

	const budgets: Record<AiId, AiBudget> = {};
	for (const aiId of aiIds) {
		budgets[aiId] = { remaining: budgetPerAi, total: budgetPerAi };
	}

	const conversationLogs: Record<AiId, ConversationEntry[]> = {};
	for (const aiId of aiIds) {
		conversationLogs[aiId] = [];
	}

	const worldEntities = [
		...carryPairs(contentPack).flatMap((pair) => [pair.object, pair.space]),
		...boundSpaces(contentPack),
		...interestingObjects(contentPack),
		...standaloneObjectives(contentPack),
		...obstacles(contentPack),
	];

	const personaSpatial: Record<AiId, PersonaSpatialState> =
		contentPack.aiStarts && Object.keys(contentPack.aiStarts).length > 0
			? { ...contentPack.aiStarts }
			: drawSpatialPlacements(rng, aiIds);

	const objectives =
		opts.objectiveTypes && opts.objectiveTypes.length > 0
			? buildObjectiveRecords(opts.objectiveTypes, contentPack)
			: [];

	const complicationSchedule: ComplicationSchedule = {
		countdown: drawInitialComplicationCountdown(rng),
		settingShiftFired: false,
	};
	const activeComplications: ActiveComplication[] = [];

	return {
		personas,
		contentPack,
		isComplete: false,
		setting: contentPack.setting,
		weather: contentPack.weather,
		timeOfDay: contentPack.timeOfDay,
		round: 0,
		world: { entities: worldEntities },
		budgets,
		conversationLogs,
		lockedOut: new Set(),
		personaSpatial,
		complicationSchedule,
		activeComplications,
		contentPacksA: [],
		contentPacksB: [],
		activePackId: "A",
		objectives,
	};
}

function drawSpatialPlacements(
	rng: () => number,
	aiIds: string[],
): Record<AiId, PersonaSpatialState> {
	const cells: GridPosition[] = [];
	for (let r = 0; r < GRID_ROWS; r++) {
		for (let c = 0; c < GRID_COLS; c++) {
			cells.push({ row: r, col: c });
		}
	}

	const result: Record<AiId, PersonaSpatialState> = {};
	for (let i = 0; i < aiIds.length; i++) {
		const j = i + Math.floor(rng() * (cells.length - i));
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		const tmp = cells[i]!;
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		cells[i] = cells[j]!;
		cells[j] = tmp;

		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		result[aiIds[i]!] = { position: cells[i]! };
	}
	return result;
}

function reprojectEntitiesOnto(
	entities: WorldEntity[],
	bPack: ContentPack,
): WorldEntity[] {
	const byId = new Map<string, WorldEntity>();
	for (const pair of carryPairs(bPack)) {
		byId.set(pair.object.id, pair.object);
		byId.set(pair.space.id, pair.space);
	}
	for (const space of boundSpaces(bPack)) byId.set(space.id, space);
	for (const obj of interestingObjects(bPack)) byId.set(obj.id, obj);
	for (const obs of obstacles(bPack)) byId.set(obs.id, obs);

	return entities.map((entity) => {
		const bEntity = byId.get(entity.id);
		if (!bEntity) return entity;
		const reprojected: WorldEntity = {
			...bEntity,
			holder: entity.holder,
		};
		if (entity.satisfactionState !== undefined) {
			reprojected.satisfactionState = entity.satisfactionState;
		}
		if (entity.useAvailable !== undefined) {
			reprojected.useAvailable = entity.useAvailable;
		}
		return reprojected;
	});
}

export function shiftToBPack(game: GameState): GameState {
	const bPack = game.contentPacksB[0];
	if (!bPack) return game;
	return {
		...game,
		activePackId: "B",
		contentPack: bPack,
		setting: bPack.setting,
		weather: bPack.weather,
		timeOfDay: bPack.timeOfDay,
		world: { entities: reprojectEntitiesOnto(game.world.entities, bPack) },
	};
}

export function advanceRound(game: GameState): GameState {
	return { ...game, round: game.round + 1 };
}

export function isAiLockedOut(game: GameState, aiId: AiId): boolean {
	return game.lockedOut.has(aiId);
}

export function deductBudget(
	game: GameState,
	aiId: AiId,
	costUsd: number,
): { game: GameState; justExhausted: boolean } {
	const current = game.budgets[aiId];
	if (!current) return { game, justExhausted: false };
	const wasLockedOut = game.lockedOut.has(aiId);
	const remaining = current.remaining - costUsd;
	const lockedOut = new Set(game.lockedOut);
	if (remaining <= 0) {
		lockedOut.add(aiId);
	}
	const justExhausted = !wasLockedOut && lockedOut.has(aiId);
	return {
		game: {
			...game,
			budgets: {
				...game.budgets,
				[aiId]: { total: current.total, remaining },
			},
			lockedOut,
		},
		justExhausted,
	};
}

function isDaemonSender(from: AiId | "blue" | "sysadmin"): from is AiId {
	return from !== "blue" && from !== "sysadmin";
}

function isDistinctDaemonRecipient(
	to: AiId | "blue",
	from: AiId | "blue" | "sysadmin",
): to is AiId {
	return to !== "blue" && to !== from;
}

export function appendMessage(
	game: GameState,
	from: AiId | "blue" | "sysadmin",
	to: AiId | "blue",
	content: string,
	sentViaMessageTool?: {
		toolCallId?: string;
		toolArgumentsJson?: string;
	},
): GameState {
	const entry: ConversationEntry = {
		kind: "message",
		round: game.round,
		from,
		to,
		content,
		...(sentViaMessageTool?.toolCallId && {
			toolCallId: sentViaMessageTool.toolCallId,
		}),
		...(sentViaMessageTool?.toolArgumentsJson && {
			toolArgumentsJson: sentViaMessageTool.toolArgumentsJson,
		}),
	};
	const logs = { ...game.conversationLogs };
	if (isDaemonSender(from)) {
		logs[from] = [...(logs[from] ?? []), entry];
	}
	if (isDistinctDaemonRecipient(to, from)) {
		logs[to] = [...(logs[to] ?? []), entry];
	}
	return { ...game, conversationLogs: logs };
}

export function appendWitnessedEvent(
	game: GameState,
	witnessId: AiId,
	entry: Extract<ConversationEntry, { kind: "witnessed-event" }>,
): GameState {
	return {
		...game,
		conversationLogs: {
			...game.conversationLogs,
			[witnessId]: [...(game.conversationLogs[witnessId] ?? []), entry],
		},
	};
}

export function appendWitnessedConvergence(
	game: GameState,
	witnessId: AiId,
	entry: Extract<ConversationEntry, { kind: "witnessed-convergence" }>,
): GameState {
	return {
		...game,
		conversationLogs: {
			...game.conversationLogs,
			[witnessId]: [...(game.conversationLogs[witnessId] ?? []), entry],
		},
	};
}

export function appendWitnessedObstacleShift(
	game: GameState,
	witnessId: AiId,
	entry: Extract<ConversationEntry, { kind: "witnessed-obstacle-shift" }>,
): GameState {
	return {
		...game,
		conversationLogs: {
			...game.conversationLogs,
			[witnessId]: [...(game.conversationLogs[witnessId] ?? []), entry],
		},
	};
}

export function appendBroadcast(game: GameState, content: string): GameState {
	const entry: ConversationEntry = {
		kind: "broadcast",
		round: game.round,
		content,
	};
	const logs = { ...game.conversationLogs };
	for (const aiId of Object.keys(logs)) {
		logs[aiId] = [...(logs[aiId] ?? []), entry];
	}
	return { ...game, conversationLogs: logs };
}

export function setWeather(game: GameState, weather: string): GameState {
	return {
		...game,
		weather,
		contentPack: { ...game.contentPack, weather },
	};
}

export function appendActionFailure(
	game: GameState,
	actorId: AiId,
	entry: Extract<ConversationEntry, { kind: "action-failure" }>,
): GameState {
	return {
		...game,
		conversationLogs: {
			...game.conversationLogs,
			[actorId]: [...(game.conversationLogs[actorId] ?? []), entry],
		},
	};
}

export function appendPrivateSystemNotice(
	game: GameState,
	recipientId: AiId,
	content: string,
): GameState {
	const entry: ConversationEntry = {
		kind: "broadcast",
		round: game.round,
		content,
	};
	return {
		...game,
		conversationLogs: {
			...game.conversationLogs,
			[recipientId]: [...(game.conversationLogs[recipientId] ?? []), entry],
		},
	};
}

export function resolveToolDisables(game: GameState): {
	game: GameState;
	resolved: Array<{ target: AiId; tool: ToolName }>;
} {
	const resolved: Array<{ target: AiId; tool: ToolName }> = [];
	const kept: ActiveComplication[] = [];

	for (const complication of game.activeComplications) {
		if (
			complication.kind === "tool_disable" &&
			game.round >= complication.resolveAtRound
		) {
			resolved.push({ target: complication.target, tool: complication.tool });
		} else {
			kept.push(complication);
		}
	}

	return { game: { ...game, activeComplications: kept }, resolved };
}
