/**
 * vista-mask.ts
 *
 * Computes the set of in-bounds visual cells covered by a Daemon's Vista, for
 * the dev inspector's per-Daemon focus highlight (ADR 0015).
 *
 * The region comes from the shared Vista geometry (`projectVista`) rather than
 * an independent disk approximation, so the inspector and the runtime can
 * never disagree about what a Vista contains. The Vista is position-only:
 * this module reads only the observer's position, so two Daemons standing on
 * the same cell highlight exactly the same cells.
 *
 * Out-of-bounds Vista cells — the Walls the Daemon perceives there — are
 * excluded: the grid is the 5×5 room, so those cells have no display cell.
 */

import type { AiId, GameState, GridPosition } from "../game/types.js";
import { projectVista } from "../game/vista-projector.js";

/**
 * Compute the Vista highlight for a position, in room coordinates. The
 * inspector grid is room-only (5×5), so a room position is also its display
 * cell. Returns a Set of cell coordinate strings ("row,col"). The mask depends
 * on the observer's position and nothing else; out-of-bounds cells are omitted.
 *
 * @param position The observer's room position
 * @returns Set of display cell coordinate strings ("row,col")
 */
export function vistaMaskForPosition(position: GridPosition): Set<string> {
	const mask = new Set<string>();

	for (const cell of projectVista(position)) {
		if (cell.isWall) continue;
		mask.add(`${cell.position.row},${cell.position.col}`);
	}

	return mask;
}

/**
 * Compute the Vista highlight for a Daemon: the in-bounds Vista cells of its
 * current position.
 *
 * @param state The current game state
 * @param aiId The daemon's AI ID
 * @returns Set of display cell coordinate strings ("row,col"), empty if the
 *   Daemon has no spatial state
 */
export function vistaMaskForDaemon(state: GameState, aiId: AiId): Set<string> {
	const spatial = state.personaSpatial[aiId];
	if (!spatial) return new Set();

	return vistaMaskForPosition(spatial.position);
}
