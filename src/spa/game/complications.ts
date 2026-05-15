/**
 * complications.ts
 *
 * Mid-phase complication registry. Each Complication has a name and an
 * `apply` function that mutates game state (pure — returns a new GameState).
 *
 * Currently registered:
 *   - weatherChangeComplication: draws a new weather string (different from
 *     the current one) and broadcasts the change to all Daemon logs.
 *   - toolDisableComplication: disables a random (daemon, tool) pair for 3–5 rounds.
 *   - obstacleShiftComplication: moves one obstacle to an adjacent empty cell;
 *     Daemons with the origin cell in their cone receive a witnessed-obstacle-shift
 *     entry.
 */

import { WEATHER_POOL } from "../../content/index.js";
import {
	DISABLABLE_TOOLS,
	validObstacleShiftTuples,
} from "./complication-engine.js";
import { projectCone } from "./cone-projector.js";
import {
	appendBroadcast,
	appendPrivateSystemNotice,
	appendWitnessedObstacleShift,
	getActivePhase,
	setWeather,
	updateActivePhase,
} from "./engine.js";
import type {
	ActiveComplication,
	AiId,
	ConversationEntry,
	GameState,
	GridPosition,
	ToolName,
} from "./types.js";

/** Return true iff two GridPositions refer to the same cell. */
function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

/**
 * A mid-phase complication: a named handler that receives the current game
 * state plus a seeded rng and returns an updated game state.
 *
 * Optional `isAvailable` guard: when present, the round coordinator calls it
 * before drawing. Complications that return `false` are excluded from the pool
 * for that draw. When absent, the complication is always eligible.
 */
export interface Complication {
	name: string;
	apply(game: GameState, rng: () => number): GameState;
	isAvailable?(game: GameState): boolean;
}

/**
 * Weather Change complication.
 *
 * Draws a new weather string from WEATHER_POOL that is different from the
 * active phase's current `phase.weather`, updates `phase.weather` and
 * `phase.contentPack.weather`, then appends a broadcast entry to every
 * Daemon's conversation log.
 */
export const weatherChangeComplication: Complication = {
	name: "weatherChange",
	apply(game: GameState, rng: () => number): GameState {
		const currentWeather = game.weather;

		// Filter out the current weather so the draw always produces a change.
		const candidates = (WEATHER_POOL as readonly string[]).filter(
			(w) => w !== currentWeather,
		);

		// If somehow the pool is empty, fall back to the full pool so we never throw.
		const pool =
			candidates.length > 0 ? candidates : (WEATHER_POOL as readonly string[]);
		const idx = Math.floor(rng() * pool.length);
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		const newWeather = pool[idx]!;

		let state = setWeather(game, newWeather);
		state = appendBroadcast(state, `The weather has changed to ${newWeather}`);
		return state;
	},
};

/**
 * Tool Disable complication.
 *
 * Picks a random (daemon, tool) pair from the cross-product of daemon IDs ×
 * DISABLABLE_TOOLS, excluding pairs that are already actively disabled.
 * Appends a `tool_disable` ActiveComplication for a duration in [3, 5] rounds
 * and sends a private Sysadmin notice to the target daemon.
 *
 * If no valid (daemon, tool) pairs remain (all are already disabled), the
 * complication is a no-op.
 */
export const toolDisableComplication: Complication = {
	name: "toolDisable",
	apply(game: GameState, rng: () => number): GameState {
		const aiIds = Object.keys(game.personaSpatial) as AiId[];

		// Build set of already-disabled (daemon, tool) pairs
		const existingDisables = new Set<string>(
			game.activeComplications
				.filter(
					(c): c is Extract<ActiveComplication, { kind: "tool_disable" }> =>
						c.kind === "tool_disable",
				)
				.map((c) => `${c.target}:${c.tool}`),
		);

		// Build valid cross-product pairs
		const validPairs: Array<{ target: AiId; tool: ToolName }> = [];
		for (const aiId of aiIds) {
			for (const tool of DISABLABLE_TOOLS) {
				if (!existingDisables.has(`${aiId}:${tool}`)) {
					validPairs.push({ target: aiId, tool });
				}
			}
		}

		// Safety net: no valid pairs → no-op
		if (validPairs.length === 0) {
			return game;
		}

		// Pick a random pair
		const pairIdx = Math.floor(rng() * validPairs.length);
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		const pair = validPairs[pairIdx]!;

		// Draw duration in [3, 5]
		const duration = 3 + Math.floor(rng() * 3);
		const resolveAtRound = game.round + duration;

		// Append the active complication
		const entry: ActiveComplication = {
			kind: "tool_disable",
			target: pair.target,
			tool: pair.tool,
			resolveAtRound,
		};

		let state: GameState = {
			...game,
			activeComplications: [...game.activeComplications, entry],
		};

		// Notify the target daemon
		state = appendPrivateSystemNotice(
			state,
			pair.target,
			`Sysadmin: Your ${pair.tool} tool has been disabled for ${duration} rounds.`,
		);

		return state;
	},
};

/**
 * Obstacle Shift complication.
 *
 * Picks one valid (obstacle, fromCell, toCell) tuple at random, moves the
 * obstacle's `holder` to `toCell`, and appends a `witnessed-obstacle-shift`
 * ConversationEntry to every Daemon whose cone contains `fromCell` at the
 * moment of the shift. If no valid tuples exist, returns game unchanged.
 */
export const obstacleShiftComplication: Complication = {
	name: "obstacleShift",
	isAvailable(game: GameState): boolean {
		const phase = getActivePhase(game);
		return (
			validObstacleShiftTuples(phase.world, phase.personaSpatial).length > 0
		);
	},
	apply(game: GameState, rng: () => number): GameState {
		const phase = getActivePhase(game);
		const tuples = validObstacleShiftTuples(phase.world, phase.personaSpatial);

		if (tuples.length === 0) {
			return game;
		}

		const idx = Math.floor(rng() * tuples.length);
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		const { obstacleId, fromCell, toCell } = tuples[idx]!;

		// Move the obstacle: update its holder from fromCell to toCell (immutable)
		const updatedEntities = phase.world.entities.map((entity) => {
			if (entity.id !== obstacleId) return entity;
			return { ...entity, holder: toCell };
		});

		let state = updateActivePhase(game, (p) => ({
			...p,
			world: { ...p.world, entities: updatedEntities },
		}));

		// Compute which Daemons have fromCell in their cone at the moment of shift
		const entry: Extract<
			ConversationEntry,
			{ kind: "witnessed-obstacle-shift" }
		> = {
			kind: "witnessed-obstacle-shift",
			round: phase.round,
			obstacleId,
			fromCell,
			toCell,
			flavor:
				phase.world.entities.find((e) => e.id === obstacleId)?.shiftFlavor ??
				"Something shifts.",
		};

		for (const [daemonId, spatial] of Object.entries(phase.personaSpatial)) {
			const cone = projectCone(spatial.position, spatial.facing);
			const witnessesShift = cone.some((cell) =>
				positionsEqual(cell.position, fromCell),
			);
			if (witnessesShift) {
				state = appendWitnessedObstacleShift(state, daemonId, entry);
			}
		}

		return state;
	},
};

/**
 * Registry of all available complications. The round coordinator draws one
 * entry from this list when a `complicationConfig.triggerRound` fires.
 */
export const COMPLICATIONS: Complication[] = [
	weatherChangeComplication,
	toolDisableComplication,
	obstacleShiftComplication,
];
