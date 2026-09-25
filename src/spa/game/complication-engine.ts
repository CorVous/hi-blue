import { WEATHER_POOL } from "../../content/pools.js";
import { applyDirection, CARDINAL_DIRECTIONS, inBounds } from "./direction.js";
import { appendBroadcast, setWeather, shiftToBPack } from "./engine.js";
import type {
	ActiveComplication,
	AiId,
	ComplicationResult,
	ComplicationVariant,
	GameState,
	GridPosition,
	ToolName,
	WorldState,
} from "./types.js";

const DISABLABLE_TOOLS: ToolName[] = [
	"pick_up",
	"put_down",
	"use",
	"go",
	"message",
];

export const PENDING_DIRECTIVE_TEXT = "";

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

function cellKey(cell: GridPosition): string {
	return `${cell.row},${cell.col}`;
}

function occupiedCellKeys(
	world: WorldState,
	personaSpatial: GameState["personaSpatial"],
): Set<string> {
	const occupied = new Set<string>();
	for (const entity of world.entities) {
		const h = entity.holder;
		if (typeof h === "object" && h !== null) occupied.add(cellKey(h));
	}
	for (const spatial of Object.values(personaSpatial)) {
		occupied.add(cellKey(spatial.position));
	}
	return occupied;
}

function isNeighborCellFree(
	neighbor: GridPosition,
	occupied: Set<string>,
): boolean {
	return inBounds(neighbor) && !occupied.has(cellKey(neighbor));
}

function drawNewWeather(current: string, rng: () => number): string {
	const candidates = WEATHER_POOL.filter((w) => w !== current);
	const idx = Math.floor(rng() * candidates.length);
	// biome-ignore lint/style/noNonNullAssertion: candidates is non-empty (WEATHER_POOL has 12 entries)
	return candidates[idx]!;
}

function isObstacleShiftAvailable(
	world: WorldState,
	personaSpatial: GameState["personaSpatial"],
): boolean {
	const occupied = occupiedCellKeys(world, personaSpatial);

	for (const entity of world.entities) {
		if (entity.kind !== "obstacle") continue;
		const h = entity.holder;
		if (typeof h !== "object" || h === null) continue;

		const obstacleCell: GridPosition = h;

		for (const dir of CARDINAL_DIRECTIONS) {
			if (isNeighborCellFree(applyDirection(obstacleCell, dir), occupied)) {
				return true;
			}
		}
	}

	return false;
}

function validObstacleShiftTuples(
	world: WorldState,
	personaSpatial: GameState["personaSpatial"],
): Array<{ obstacleId: string; fromCell: GridPosition; toCell: GridPosition }> {
	const occupied = occupiedCellKeys(world, personaSpatial);

	const tuples: Array<{
		obstacleId: string;
		fromCell: GridPosition;
		toCell: GridPosition;
	}> = [];

	for (const entity of world.entities) {
		if (entity.kind !== "obstacle") continue;
		const h = entity.holder;
		if (typeof h !== "object" || h === null) continue;

		const fromCell: GridPosition = h;

		for (const dir of CARDINAL_DIRECTIONS) {
			const toCell = applyDirection(fromCell, dir);
			if (isNeighborCellFree(toCell, occupied)) {
				tuples.push({ obstacleId: entity.id, fromCell, toCell });
			}
		}
	}

	return tuples;
}

function availableComplicationTypes(
	phase: GameState,
	excludeToolDisable = false,
): string[] {
	const { complicationSchedule, world, personaSpatial } = phase;
	const pool: string[] = ["weather_change", "sysadmin_directive"];

	if (!excludeToolDisable) {
		pool.push("tool_disable");
	}

	if (isObstacleShiftAvailable(world, personaSpatial)) {
		pool.push("obstacle_shift");
	}

	pool.push("chat_lockout");

	if (!complicationSchedule.settingShiftFired) {
		pool.push("setting_shift");
	}

	return pool;
}

function drawComplication(
	phase: GameState,
	rng: () => number,
): ComplicationVariant {
	const pool = availableComplicationTypes(phase);
	const idx = Math.floor(rng() * pool.length);
	// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty pool
	const kind = pool[idx]!;

	if (kind !== "tool_disable") {
		return buildSimpleComplication(kind, phase, rng);
	}

	const aiIds = Object.keys(phase.personaSpatial);
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
		const fallbackPool = availableComplicationTypes(phase, true);
		const fallbackIdx = Math.floor(rng() * fallbackPool.length);
		// biome-ignore lint/style/noNonNullAssertion: bounded index
		const fallbackKind = fallbackPool[fallbackIdx]!;
		return buildSimpleComplication(fallbackKind, phase, rng);
	}

	const pairIdx = Math.floor(rng() * validPairs.length);
	// biome-ignore lint/style/noNonNullAssertion: bounded index
	const pair = validPairs[pairIdx]!;
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

		case "sysadmin_directive": {
			const aiIds = Object.keys(phase.personaSpatial);
			const target = aiIds[Math.floor(rng() * aiIds.length)] as AiId;
			const duration = drawComplicationDuration(rng);
			return { kind: "sysadmin_directive", target, duration };
		}

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

		case "chat_lockout": {
			const aiIds = Object.keys(phase.personaSpatial);
			const target = aiIds[Math.floor(rng() * aiIds.length)] as AiId;
			const duration = drawComplicationDuration(rng);
			return { kind: "chat_lockout", target, duration };
		}

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
	const { countdown } = game.complicationSchedule;

	if (countdown > 0) {
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
	const resolvedAiIds: AiId[] = [];
	const remaining = game.activeComplications.filter((c) => {
		if (c.kind === "chat_lockout" && game.round >= c.resolveAtRound) {
			resolvedAiIds.push(c.target);
			return false;
		}
		return true;
	});

	if (resolvedAiIds.length === 0) {
		return { nextState: game, resolvedAiIds: [] };
	}

	const nextState: GameState = {
		...game,
		activeComplications: remaining,
	};

	return { nextState, resolvedAiIds };
}

export function resolveExpiredDirectives(game: GameState): {
	nextState: GameState;
	resolved: Array<{ target: AiId; directive: string }>;
} {
	const resolved: Array<{ target: AiId; directive: string }> = [];
	const remaining = game.activeComplications.filter((c) => {
		if (c.kind === "sysadmin_directive" && game.round >= c.resolveAtRound) {
			resolved.push({ target: c.target, directive: c.directive });
			return false;
		}
		return true;
	});

	if (resolved.length === 0) {
		return { nextState: game, resolved: [] };
	}

	const nextState: GameState = {
		...game,
		activeComplications: remaining,
	};

	return { nextState, resolved };
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
