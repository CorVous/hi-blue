/**
 * vista-projector.ts
 *
 * Projects the position-only 13-cell proximity disk (the **Vista**) centered
 * on a Daemon's position (ADR 0015).
 *
 * The Vista is the game's sight region: it contains exactly the integer
 * offsets satisfying `dx² + dy² ≤ 4`, where `dx`/`dy` denote offsets along
 * the east–west and north–south directions. Unlike the retired Cone, it
 * takes no facing and no occluder input: obstacles never remove cells from
 * the footprint, and out-of-bounds cells are returned as wall sentinels
 * (`isWall: true`) so consumers can render Wall perception.
 *
 * This module is a geometry primitive for the runtime, witness, reach, and
 * inspector consumers (map #535, ticket #537). It decides nothing about
 * movement: step legality remains the dispatcher's job (bounds + obstacle
 * checks), and Vista cells are perception, not a movement authority. The
 * live runtime keeps using the Cone until the coordinated cutover (#539).
 */

import type { CardinalDirection, GridPosition } from "./direction.js";
import { inBounds } from "./direction.js";

/**
 * One step along a cardinal direction, used by position-plus-distance
 * descriptions (e.g. "one step north and one step east"). Deterministic:
 * consumers choose the prose, the offsets only.
 */
export interface VistaAxisStep {
	/** The cardinal direction from the observer toward this cell. */
	direction: CardinalDirection;
	/** Number of cells along that direction. */
	distance: number;
}

/**
 * A single cell of the Vista, expressed as an offset from the observer's
 * position. `dx` runs east–west (+1 = east, −1 = west); `dy` runs
 * north–south (+1 = north, −1 = south) — the ADR's axis convention, not an
 * engine row/column convention.
 */
export interface VistaOffset {
	dx: number;
	dy: number;
	/**
	 * Axis steps locating this cell for position-plus-distance
	 * descriptions. The own cell has none.
	 */
	steps: readonly VistaAxisStep[];
}

/**
 * Decompose an offset into axis steps: one step per non-zero axis. Steps
 * run in compass rotation order (north, east, south, west), so the ADR's
 * "one step north and one step east" example holds for every diagonal.
 */
function stepsFor(dx: number, dy: number): VistaAxisStep[] {
	const steps: VistaAxisStep[] = [];
	if (dy !== 0) {
		steps.push({
			direction: dy > 0 ? "north" : "south",
			distance: Math.abs(dy),
		});
	}
	if (dx !== 0) {
		steps.push({
			direction: dx > 0 ? "east" : "west",
			distance: Math.abs(dx),
		});
	}
	const compass: Record<CardinalDirection, number> = {
		north: 0,
		east: 1,
		south: 2,
		west: 3,
	};
	return steps.sort((a, b) => compass[a.direction] - compass[b.direction]);
}

/**
 * The 13 Vista offsets in canonical order: own cell first, then the ADR
 * 0015 diagram read north-to-south, west-to-east within a row.
 */
export const VISTA_OFFSETS: readonly VistaOffset[] = [
	{ dx: 0, dy: 0, steps: stepsFor(0, 0) },
	{ dx: 0, dy: 2, steps: stepsFor(0, 2) },
	{ dx: -1, dy: 1, steps: stepsFor(-1, 1) },
	{ dx: 0, dy: 1, steps: stepsFor(0, 1) },
	{ dx: 1, dy: 1, steps: stepsFor(1, 1) },
	{ dx: -2, dy: 0, steps: stepsFor(-2, 0) },
	{ dx: -1, dy: 0, steps: stepsFor(-1, 0) },
	{ dx: 1, dy: 0, steps: stepsFor(1, 0) },
	{ dx: 2, dy: 0, steps: stepsFor(2, 0) },
	{ dx: -1, dy: -1, steps: stepsFor(-1, -1) },
	{ dx: 0, dy: -1, steps: stepsFor(0, -1) },
	{ dx: 1, dy: -1, steps: stepsFor(1, -1) },
	{ dx: 0, dy: -2, steps: stepsFor(0, -2) },
];

/**
 * True when the offset (dx, dy) falls inside the Vista disk:
 * `dx² + dy² ≤ 4`. Includes the own cell and excludes offsets such as
 * `(2, 1)`.
 */
export function inVista(dx: number, dy: number): boolean {
	return dx * dx + dy * dy <= 4;
}

/**
 * A projected Vista cell: an absolute room position (or out-of-bounds
 * position to be perceived as a Wall) plus the axis steps that locate it
 * relative to the observer.
 */
export interface VistaCell {
	/** The room position of this cell (may be out-of-bounds for Walls). */
	position: GridPosition;
	/** True for the observer's own cell. */
	isOwnCell: boolean;
	/**
	 * True when this cell is out-of-bounds — the impassable grid-edge Wall
	 * the observer perceives there.
	 */
	isWall: boolean;
	/** Axis steps locating this cell relative to the observer. */
	steps: readonly VistaAxisStep[];
}

/**
 * Project the 13-cell Vista from the given position.
 *
 * Returns exactly 13 cells in canonical order (see `VISTA_OFFSETS`).
 * Out-of-bounds cells are wall sentinels (`isWall: true`); the own cell is
 * never a wall. No facing and no obstacle information enters the
 * projection, so the footprint is position-only and never occluded.
 */
export function projectVista(position: GridPosition): VistaCell[] {
	return VISTA_OFFSETS.map((offset) => {
		// Row 0 is the north edge, so north offsets (dy > 0) decrease the
		// row; columns increase eastward, so dx maps straight onto col.
		const pos: GridPosition = {
			row: position.row - offset.dy,
			col: position.col + offset.dx,
		};
		const isOwnCell = offset.dx === 0 && offset.dy === 0;
		return {
			position: pos,
			isOwnCell,
			isWall: !isOwnCell && !inBounds(pos),
			steps: offset.steps,
		};
	});
}
