/**
 * complication-engine.ts
 *
 * Pure, deterministic Complication Engine for issue #296.
 *
 * Entry point: tickComplication(game, rng) → ComplicationResult | null
 *
 * Companion helpers (to be called by the Round Coordinator):
 *   decrementComplicationCountdown(game) → GameState
 *   applyComplicationResult(game, result, rng) → GameState
 *
 * No LLM calls, no browser APIs. All randomness is injected via `rng`.
 */

import { applyDirection, CARDINAL_DIRECTIONS, inBounds } from "./direction.js";
import {
	appendBroadcast,
	getActivePhase,
	swapActivePack,
	updateActivePhase,
} from "./engine.js";
import type {
	ActiveComplication,
	AiId,
	ComplicationResult,
	ComplicationVariant,
	GameState,
	GridPosition,
	PhaseState,
	ToolName,
	WorldState,
} from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * All tools that can be disabled by a Tool Disable complication.
 * Covers every ToolName in the discriminated union.
 */
export const DISABLABLE_TOOLS: ToolName[] = [
	"pick_up",
	"put_down",
	"give",
	"use",
	"go",
	"look",
	"examine",
	"message",
];

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Draw a uniform integer in [min, max] inclusive using the provided rng.
 * rng() must return a value in [0, 1).
 */
function drawCountdown(rng: () => number, min: number, max: number): number {
	return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Returns true iff at least one entity of kind "obstacle" has at least one
 * in-bounds, non-occupied adjacent cell (4-cardinal neighbours).
 *
 * "Occupied" means:
 *   - Another entity (obstacle, objective_object, objective_space,
 *     interesting_object) is resting on that cell as a GridPosition.
 *   - A persona is standing on that cell.
 */
function isObstacleShiftAvailable(
	world: WorldState,
	personaSpatial: PhaseState["personaSpatial"],
): boolean {
	// Collect all occupied cells (grid-resting entities that are NOT the obstacle being examined)
	const entityOccupied = new Set<string>();
	for (const entity of world.entities) {
		const h = entity.holder;
		if (typeof h === "object" && h !== null) {
			entityOccupied.add(`${h.row},${h.col}`);
		}
	}

	// Collect persona positions
	const personaOccupied = new Set<string>();
	for (const spatial of Object.values(personaSpatial)) {
		const p = spatial.position;
		personaOccupied.add(`${p.row},${p.col}`);
	}

	// Check each obstacle
	for (const entity of world.entities) {
		if (entity.kind !== "obstacle") continue;
		const h = entity.holder;
		if (typeof h !== "object" || h === null) continue; // obstacle held by AI (shouldn't happen)

		const obstacleCell: GridPosition = h;

		for (const dir of CARDINAL_DIRECTIONS) {
			const neighbor = applyDirection(obstacleCell, dir);
			if (!inBounds(neighbor)) continue;
			const key = `${neighbor.row},${neighbor.col}`;
			// A neighbor is "empty" if it is not occupied by another entity AND not occupied by a persona.
			// The obstacle's own cell is occupied by the obstacle, but we're checking the neighbor cell.
			if (!entityOccupied.has(key) && !personaOccupied.has(key)) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Build valid (obstacle, direction) tuples for the obstacle_shift draw.
 * Returns an array of { obstacleId, fromCell, toCell } for each valid shift.
 */
function validObstacleShiftTuples(
	world: WorldState,
	personaSpatial: PhaseState["personaSpatial"],
): Array<{ obstacleId: string; fromCell: GridPosition; toCell: GridPosition }> {
	// Same occupied set logic as isObstacleShiftAvailable
	const entityOccupied = new Set<string>();
	for (const entity of world.entities) {
		const h = entity.holder;
		if (typeof h === "object" && h !== null) {
			entityOccupied.add(`${h.row},${h.col}`);
		}
	}

	const personaOccupied = new Set<string>();
	for (const spatial of Object.values(personaSpatial)) {
		const p = spatial.position;
		personaOccupied.add(`${p.row},${p.col}`);
	}

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
			if (!inBounds(toCell)) continue;
			const key = `${toCell.row},${toCell.col}`;
			if (!entityOccupied.has(key) && !personaOccupied.has(key)) {
				tuples.push({ obstacleId: entity.id, fromCell, toCell });
			}
		}
	}

	return tuples;
}

/**
 * Available complication type indices after exclusions.
 * Returns the pool (as string array) from which the type draw picks.
 *
 * Full pool order (indices 0-5):
 *   [weather_change, sysadmin_directive, tool_disable, obstacle_shift, chat_lockout, setting_shift]
 *
 * Exclusions:
 *   - setting_shift excluded when settingShiftFired is true
 *   - obstacle_shift excluded when isObstacleShiftAvailable returns false
 *   - tool_disable is always in the candidate pool here; the sub-draw handles
 *     exhaustion by requesting a re-draw (see drawComplication)
 */
function availableComplicationTypes(
	phase: PhaseState,
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

/**
 * Draw one complication type and its sub-data from the valid pool.
 * Handles the tool_disable exhaustion re-draw.
 */
function drawComplication(
	phase: PhaseState,
	rng: () => number,
): ComplicationVariant {
	const pool = availableComplicationTypes(phase);
	const idx = Math.floor(rng() * pool.length);
	// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty pool
	const kind = pool[idx]!;

	switch (kind) {
		case "weather_change":
			return { kind: "weather_change" };

		case "sysadmin_directive": {
			const aiIds = Object.keys(phase.personaSpatial);
			const target = aiIds[Math.floor(rng() * aiIds.length)] as AiId;
			return { kind: "sysadmin_directive", target };
		}

		case "tool_disable": {
			// Build the cross-product of (daemon, tool) pairs, filtered by already-active disables
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

			if (validPairs.length === 0) {
				// All (daemon, tool) pairs are already disabled — re-draw excluding tool_disable
				const fallbackPool = availableComplicationTypes(phase, true);
				const fallbackIdx = Math.floor(rng() * fallbackPool.length);
				// biome-ignore lint/style/noNonNullAssertion: bounded index
				const fallbackKind = fallbackPool[fallbackIdx]!;
				// Recursive sub-draw with fallback kind (only one level, no unbounded recursion)
				return drawFallbackComplication(fallbackKind, phase, rng);
			}

			const pairIdx = Math.floor(rng() * validPairs.length);
			// biome-ignore lint/style/noNonNullAssertion: bounded index
			const pair = validPairs[pairIdx]!;
			return { kind: "tool_disable", target: pair.target, tool: pair.tool };
		}

		case "obstacle_shift": {
			const tuples = validObstacleShiftTuples(
				phase.world,
				phase.personaSpatial,
			);
			const tupleIdx = Math.floor(rng() * tuples.length);
			// biome-ignore lint/style/noNonNullAssertion: bounded index (obstacle_shift only in pool when tuples non-empty)
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
			const duration = 3 + Math.floor(rng() * 3); // [3, 5]
			return { kind: "chat_lockout", target, duration };
		}

		case "setting_shift":
			return { kind: "setting_shift" };

		default:
			// Unreachable — exhaustive over pool values
			return { kind: "weather_change" };
	}
}

/**
 * Draw a non-tool_disable complication given a pre-selected kind.
 * Used only in the tool_disable exhaustion fallback path.
 */
function drawFallbackComplication(
	kind: string,
	phase: PhaseState,
	rng: () => number,
): ComplicationVariant {
	switch (kind) {
		case "weather_change":
			return { kind: "weather_change" };

		case "sysadmin_directive": {
			const aiIds = Object.keys(phase.personaSpatial);
			const target = aiIds[Math.floor(rng() * aiIds.length)] as AiId;
			return { kind: "sysadmin_directive", target };
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
			const duration = 3 + Math.floor(rng() * 3);
			return { kind: "chat_lockout", target, duration };
		}

		case "setting_shift":
			return { kind: "setting_shift" };

		default:
			return { kind: "weather_change" };
	}
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether a complication fires this round.
 *
 * Returns `ComplicationResult` when countdown has reached 0 (a complication fires).
 * Returns `null` when countdown > 0.
 *
 * The caller MUST:
 *   - Call `decrementComplicationCountdown(game)` when result is null (each round).
 *   - Call `applyComplicationResult(game, result, rng)` when result is non-null.
 */
export function tickComplication(
	game: GameState,
	rng: () => number,
): ComplicationResult | null {
	const phase = getActivePhase(game);
	const { countdown } = phase.complicationSchedule;

	if (countdown > 0) {
		return null;
	}

	// countdown === 0: draw a complication
	const fired = drawComplication(phase, rng);
	return { fired };
}

/**
 * Decrement the complication countdown by 1.
 * Call this every round when `tickComplication` returns null.
 */
export function decrementComplicationCountdown(game: GameState): GameState {
	return updateActivePhase(game, (phase) => ({
		...phase,
		complicationSchedule: {
			...phase.complicationSchedule,
			countdown: phase.complicationSchedule.countdown - 1,
		},
	}));
}

/**
 * Apply a ComplicationResult to the game state:
 *   1. Reset the countdown via drawCountdown(rng, 5, 15).
 *   2. Mark settingShiftFired=true if the result is a setting_shift.
 *   3. For setting_shift: swap the active pack and broadcast the shift.
 *   4. Append to activeComplications for persistent kinds
 *      (sysadmin_directive, tool_disable, chat_lockout).
 *
 * Call this every round when `tickComplication` returns non-null.
 */
export function applyComplicationResult(
	game: GameState,
	result: ComplicationResult,
	rng: () => number,
): GameState {
	const newCountdown = drawCountdown(rng, 5, 15);
	const { fired } = result;

	// Update phase-level complication schedule and persistent complications
	let state = updateActivePhase(game, (phase) => {
		const settingShiftFired =
			phase.complicationSchedule.settingShiftFired ||
			fired.kind === "setting_shift";

		const complicationSchedule = {
			...phase.complicationSchedule,
			countdown: newCountdown,
			settingShiftFired,
		};

		// Append persistent complications
		let activeComplications = [...phase.activeComplications];
		if (fired.kind === "sysadmin_directive") {
			const entry: ActiveComplication = {
				kind: "sysadmin_directive",
				target: fired.target,
				directive: "", // directive text set by the coordinator's content layer
			};
			activeComplications = [...activeComplications, entry];
		} else if (fired.kind === "tool_disable") {
			const entry: ActiveComplication = {
				kind: "tool_disable",
				target: fired.target,
				tool: fired.tool,
			};
			activeComplications = [...activeComplications, entry];
		} else if (fired.kind === "chat_lockout") {
			const entry: ActiveComplication = {
				kind: "chat_lockout",
				target: fired.target,
				resolveAtRound: phase.round + fired.duration,
			};
			activeComplications = [...activeComplications, entry];
		}
		// weather_change, obstacle_shift, setting_shift are transient — not appended here

		return {
			...phase,
			complicationSchedule,
			activeComplications,
		};
	});

	// setting_shift: swap the active pack and broadcast the change to all Daemons
	if (fired.kind === "setting_shift") {
		state = swapActivePack(state);
		const newPhase = getActivePhase(state);
		state = appendBroadcast(
			state,
			`[SYSTEM] The setting has shifted. You are now in: ${newPhase.setting}.`,
		);
	}

	return state;
}
