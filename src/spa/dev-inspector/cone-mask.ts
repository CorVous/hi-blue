/**
 * cone-mask.ts
 *
 * Computes the set of visual cells that form a cone from an AI's position and facing direction.
 * Used for rendering cone-focus tinting on the world map.
 */

import { projectCone } from "../game/cone-projector.js";
import type { AiId, GameState } from "../game/types.js";

/**
 * Compute the cone mask for a daemon in visual coordinates (7×7 grid with wall ring).
 * Returns a Set of visual cell coordinates ("row,col") that represent the visible cone.
 * Out-of-bounds cells (walls) are excluded from the mask.
 *
 * @param state The current game state
 * @param aiId The daemon's AI ID
 * @returns Set of visual cell coordinate strings ("row,col")
 */
export function coneMaskForDaemon(state: GameState, aiId: AiId): Set<string> {
	const spatial = state.personaSpatial[aiId];
	if (!spatial) return new Set();

	const cells = projectCone(spatial.position, spatial.facing);
	const mask = new Set<string>();

	for (const cell of cells) {
		// Skip out-of-bounds walls
		if (cell.isWall) continue;

		// Map inner coordinates to visual coordinates (+1 for wall ring)
		const vRow = cell.position.row + 1;
		const vCol = cell.position.col + 1;
		mask.add(`${vRow},${vCol}`);
	}

	return mask;
}
