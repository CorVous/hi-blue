import { WEATHER_POOL } from "../../content/pools.js";
import {
	applyDirection,
	CARDINAL_DIRECTIONS,
	cellIndex,
	everyOpenCellReachable,
	inBounds,
	isGridPosition,
} from "./direction.js";
import {
	appendBroadcast,
	partitionExpired,
	setWeather,
	shiftToBPack,
} from "./engine.js";
import {
	type ActiveComplication,
	type AiId,
	type ComplicationResult,
	type ComplicationVariant,
	type GameState,
	type GridPosition,
	PENDING_DIRECTIVE_TEXT,
	type ToolName,
	type WorldState,
} from "./types.js";

const DISABLABLE_TOOLS: ToolName[] = [
	"pick_up",
	"put_down",
	"use",
	"go",
	"message",
];

function drawIntegerInclusive(
	rng: () => number,
	min: number,
	max: number,
): number {
	return min + Math.floor(rng() * (max - min + 1));
}

function drawComplicationDuration(rng: () => number): number {
	return drawIntegerInclusive(rng, 3, 5);
}

function drawNextCountdown(rng: () => number): number {
	return drawIntegerInclusive(rng, 5, 15);
}

function occupiedCellKeys(
	world: WorldState,
	personaSpatial: GameState["personaSpatial"],
): Set<number> {
	const occupied = new Set<number>();
	for (const entity of world.entities) {
		if (isGridPosition(entity.holder)) occupied.add(cellIndex(entity.holder));
	}
	for (const spatial of Object.values(personaSpatial)) {
		occupied.add(cellIndex(spatial.position));
	}
	return occupied;
}

function drawNewWeather(current: string, rng: () => number): string {
	const candidates = WEATHER_POOL.filter((w) => w !== current);
	const idx = Math.floor(rng() * candidates.length);
	// biome-ignore lint/style/noNonNullAssertion: candidates is non-empty (WEATHER_POOL has 12 entries)
	return candidates[idx]!;
}

function obstacleCellIndices(world: WorldState): Set<number> {
	const cells = new Set<number>();
	for (const entity of world.entities) {
		if (entity.kind === "obstacle" && isGridPosition(entity.holder)) {
			cells.add(cellIndex(entity.holder));
		}
	}
	return cells;
}

function shiftKeepsEveryOpenCellReachable(
	obstacleCells: ReadonlySet<number>,
	fromCell: GridPosition,
	toCell: GridPosition,
): boolean {
	const blockedAfterShift = new Set(obstacleCells);
	blockedAfterShift.delete(cellIndex(fromCell));
	blockedAfterShift.add(cellIndex(toCell));
	return everyOpenCellReachable([fromCell], blockedAfterShift);
}

function validObstacleShiftTuples(
	world: WorldState,
	personaSpatial: GameState["personaSpatial"],
): Array<{ obstacleId: string; fromCell: GridPosition; toCell: GridPosition }> {
	const occupied = occupiedCellKeys(world, personaSpatial);
	const obstacleCells = obstacleCellIndices(world);

	const tuples: Array<{
		obstacleId: string;
		fromCell: GridPosition;
		toCell: GridPosition;
	}> = [];

	for (const entity of world.entities) {
		if (entity.kind !== "obstacle") continue;
		const fromCell = entity.holder;
		if (!isGridPosition(fromCell)) continue;

		for (const dir of CARDINAL_DIRECTIONS) {
			const toCell = applyDirection(fromCell, dir);
			if (!inBounds(toCell) || occupied.has(cellIndex(toCell))) continue;
			if (!shiftKeepsEveryOpenCellReachable(obstacleCells, fromCell, toCell))
				continue;
			tuples.push({ obstacleId: entity.id, fromCell, toCell });
		}
	}

	return tuples;
}

function activeDaemonIds(phase: GameState): AiId[] {
	return Object.keys(phase.personaSpatial).filter(
		(aiId) => !phase.exhausted.has(aiId),
	);
}

function drawTargetAndDuration(
	targets: readonly AiId[],
	rng: () => number,
): { target: AiId; duration: number } {
	const target = targets[Math.floor(rng() * targets.length)] as AiId;
	const duration = drawComplicationDuration(rng);
	return { target, duration };
}

function availableComplicationTypes(
	phase: GameState,
	excludeToolDisable = false,
): string[] {
	const { complicationSchedule, world, personaSpatial } = phase;
	const hasActiveTarget = activeDaemonIds(phase).length > 0;
	const pool: string[] = ["weather_change"];

	if (hasActiveTarget) {
		pool.push("sysadmin_directive");
	}

	if (hasActiveTarget && !excludeToolDisable) {
		pool.push("tool_disable");
	}

	if (validObstacleShiftTuples(world, personaSpatial).length > 0) {
		pool.push("obstacle_shift");
	}

	if (hasActiveTarget) {
		pool.push("chat_lockout");
	}

	if (!complicationSchedule.settingShiftFired && phase.contentPacksB[0]) {
		pool.push("setting_shift");
	}

	return pool;
}

function pickFrom<T>(items: readonly T[], rng: () => number): T {
	// biome-ignore lint/style/noNonNullAssertion: bounded index into a non-empty list
	return items[Math.floor(rng() * items.length)]!;
}

function drawComplication(
	phase: GameState,
	rng: () => number,
): ComplicationVariant {
	const kind = pickFrom(availableComplicationTypes(phase), rng);

	if (kind !== "tool_disable") {
		return buildSimpleComplication(kind, phase, rng);
	}

	const aiIds = activeDaemonIds(phase);
	const existingDisables = new Set<string>(
		phase.activeComplications
			.filter(
				(c): c is Extract<ActiveComplication, { kind: "tool_disable" }> =>
					c.kind === "tool_disable",
			)
			.map((c) => `${c.target}:${c.tool}`),
	);

	const validPairs: Array<{ target: AiId; tool: ToolName }> = [];
	for (const aiId of aiIds) {
		for (const tool of DISABLABLE_TOOLS) {
			if (!existingDisables.has(`${aiId}:${tool}`)) {
				validPairs.push({ target: aiId as AiId, tool });
			}
		}
	}

	const everyToolAlreadyDisabled = validPairs.length === 0;
	if (everyToolAlreadyDisabled) {
		const fallbackKind = pickFrom(availableComplicationTypes(phase, true), rng);
		return buildSimpleComplication(fallbackKind, phase, rng);
	}

	const pair = pickFrom(validPairs, rng);
	const duration = drawComplicationDuration(rng);
	return {
		kind: "tool_disable",
		target: pair.target,
		tool: pair.tool,
		duration,
	};
}

function buildSimpleComplication(
	kind: string,
	phase: GameState,
	rng: () => number,
): ComplicationVariant {
	switch (kind) {
		case "weather_change":
			return {
				kind: "weather_change",
				weather: drawNewWeather(phase.weather, rng),
			};

		case "sysadmin_directive":
			return {
				kind: "sysadmin_directive",
				...drawTargetAndDuration(activeDaemonIds(phase), rng),
			};

		case "obstacle_shift": {
			const tuples = validObstacleShiftTuples(
				phase.world,
				phase.personaSpatial,
			);
			const tupleIdx = Math.floor(rng() * tuples.length);
			// biome-ignore lint/style/noNonNullAssertion: bounded
			const tuple = tuples[tupleIdx]!;
			return {
				kind: "obstacle_shift",
				obstacleId: tuple.obstacleId,
				fromCell: tuple.fromCell,
				toCell: tuple.toCell,
			};
		}

		case "chat_lockout":
			return {
				kind: "chat_lockout",
				...drawTargetAndDuration(activeDaemonIds(phase), rng),
			};

		case "setting_shift":
			return { kind: "setting_shift" };

		default:
			return {
				kind: "weather_change",
				weather: drawNewWeather(phase.weather, rng),
			};
	}
}

export function tickComplication(
	game: GameState,
	rng: () => number,
): ComplicationResult | null {
	const roundsUntilNextComplication = game.complicationSchedule.countdown;

	if (roundsUntilNextComplication > 1) {
		return null;
	}

	const fired = drawComplication(game, rng);
	return { fired };
}

export function decrementComplicationCountdown(game: GameState): GameState {
	return {
		...game,
		complicationSchedule: {
			...game.complicationSchedule,
			countdown: game.complicationSchedule.countdown - 1,
		},
	};
}

export function isPlayerChatLockedOut(phase: GameState, aiId: AiId): boolean {
	return phase.activeComplications.some(
		(c) => c.kind === "chat_lockout" && c.target === aiId,
	);
}

export function resolveExpiredChatLockouts(game: GameState): {
	nextState: GameState;
	resolvedAiIds: AiId[];
} {
	const { game: nextState, expired } = partitionExpired(game, "chat_lockout");
	return { nextState, resolvedAiIds: expired.map((c) => c.target) };
}

export function resolveExpiredDirectives(game: GameState): {
	nextState: GameState;
	resolved: Array<{ target: AiId; directive: string }>;
} {
	const { game: nextState, expired } = partitionExpired(
		game,
		"sysadmin_directive",
	);
	return {
		nextState,
		resolved: expired.map(({ target, directive }) => ({ target, directive })),
	};
}

export function applyComplicationResult(
	game: GameState,
	result: ComplicationResult,
	rng: () => number,
): GameState {
	const newCountdown = drawNextCountdown(rng);
	const { fired } = result;

	const settingShiftFired =
		game.complicationSchedule.settingShiftFired ||
		fired.kind === "setting_shift";

	const complicationSchedule = {
		...game.complicationSchedule,
		countdown: newCountdown,
		settingShiftFired,
	};

	const activeComplications = [...game.activeComplications];
	if (fired.kind === "sysadmin_directive") {
		activeComplications.push({
			kind: "sysadmin_directive",
			target: fired.target,
			directive: PENDING_DIRECTIVE_TEXT,
			resolveAtRound: game.round + fired.duration,
		});
	} else if (fired.kind === "tool_disable") {
		activeComplications.push({
			kind: "tool_disable",
			target: fired.target,
			tool: fired.tool,
			resolveAtRound: game.round + fired.duration,
		});
	} else if (fired.kind === "chat_lockout") {
		activeComplications.push({
			kind: "chat_lockout",
			target: fired.target,
			resolveAtRound: game.round + fired.duration,
		});
	}

	let state: GameState = {
		...game,
		complicationSchedule,
		activeComplications,
	};

	if (fired.kind === "setting_shift") {
		state = shiftToBPack(state);
		state = appendBroadcast(
			state,
			`[SYSTEM] The setting has shifted. You are now in: ${state.setting}.`,
		);
	}

	if (fired.kind === "weather_change") {
		state = setWeather(state, fired.weather);
		state = appendBroadcast(
			state,
			`[SYSTEM] The weather has changed. ${fired.weather}`,
		);
	}

	return state;
}
