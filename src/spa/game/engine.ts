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

export function personaName(
	game: Pick<GameState, "personas">,
	aiId: AiId,
): string {
	return game.personas[aiId]?.name ?? aiId;
}

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
		exhausted: new Set(),
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
	for (const obj of standaloneObjectives(bPack)) byId.set(obj.id, obj);
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

export function isDaemonExhausted(game: GameState, aiId: AiId): boolean {
	return game.exhausted.has(aiId);
}

export function deductBudget(
	game: GameState,
	aiId: AiId,
	costUsd: number,
): { game: GameState; justExhausted: boolean } {
	const current = game.budgets[aiId];
	if (!current) return { game, justExhausted: false };
	const wasExhausted = game.exhausted.has(aiId);
	const remaining = current.remaining - costUsd;
	const exhausted = new Set(game.exhausted);
	if (remaining <= 0) {
		exhausted.add(aiId);
	}
	const justExhausted = !wasExhausted && exhausted.has(aiId);
	return {
		game: {
			...game,
			budgets: {
				...game.budgets,
				[aiId]: { total: current.total, remaining },
			},
			exhausted,
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

export function appendLogEntry(
	game: GameState,
	aiId: AiId,
	entry: ConversationEntry,
): GameState {
	return {
		...game,
		conversationLogs: {
			...game.conversationLogs,
			[aiId]: [...(game.conversationLogs[aiId] ?? []), entry],
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

export function appendPrivateSystemNotice(
	game: GameState,
	recipientId: AiId,
	content: string,
): GameState {
	return appendLogEntry(game, recipientId, {
		kind: "broadcast",
		round: game.round,
		content,
	});
}

export function partitionExpired<K extends ActiveComplication["kind"]>(
	game: GameState,
	kind: K,
): {
	game: GameState;
	expired: Array<Extract<ActiveComplication, { kind: K }>>;
} {
	const expired: Array<Extract<ActiveComplication, { kind: K }>> = [];
	const kept: ActiveComplication[] = [];
	for (const complication of game.activeComplications) {
		if (
			complication.kind === kind &&
			game.round >= complication.resolveAtRound
		) {
			expired.push(complication as Extract<ActiveComplication, { kind: K }>);
		} else {
			kept.push(complication);
		}
	}
	if (expired.length === 0) return { game, expired };
	return { game: { ...game, activeComplications: kept }, expired };
}

export function resolveToolDisables(game: GameState): {
	game: GameState;
	resolved: Array<{ target: AiId; tool: ToolName }>;
} {
	const { game: nextGame, expired } = partitionExpired(game, "tool_disable");
	return {
		game: nextGame,
		resolved: expired.map(({ target, tool }) => ({ target, tool })),
	};
}
