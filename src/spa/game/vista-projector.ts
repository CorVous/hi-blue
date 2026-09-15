/**
 * vista-projector.ts
 *
 * Projects the position-only 13-cell proximity disk (the **Vista**) centered
 * on a Daemon's position (ADR 0015).
 *
 * The Vista is the region a Daemon perceives: it contains exactly the integer
 * offsets satisfying `dx² + dy² ≤ 4`, where `dx`/`dy` denote offsets along
 * the east–west and north–south directions. Unlike the retired Cone, it takes
 * no orientation and no occluder input: obstacles never remove cells from the
 * footprint, and out-of-bounds cells are perceived as **Wall**s
 * (`isWall: true`), the sentinel CONTEXT.md's **Wall** entry describes.
 *
 * This module is a geometry primitive for the runtime perception,
 * **Witnessed event** eligibility, and dev inspector consumers (map #535,
 * ticket #537). It decides nothing about movement: step legality remains the
 * dispatcher's job (bounds + obstacle checks), and Vista cells are
 * perception, not a movement authority. **Interaction range**
 * (`max(|dx|, |dy|) ≤ 1`) is the separate, shorter region for pickup, Carry
 * placement, and Use-Space. Witness eligibility (`vistaContains`) and the
 * prompt's sight listing both read this disk (ticket #539).
 */

import type { CardinalDirection, GridPosition } from "./direction.js";
import { COMPASS_ORDER, GRID_COLS, GRID_ROWS, inBounds } from "./direction.js";

/**
 * One step of the cardinal-direction-and-distance description ADR 0015
 * specifies (e.g. "one step north and one step east"). Deterministic:
 * consumers choose the prose, the offsets only. `VistaAxisStep` is internal
 * naming, not a glossary term — CONTEXT.md's **Cardinal directions** entry
 * already covers this vocabulary.
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
	 * Axis steps locating this cell for the ADR 0015
	 * cardinal-direction-and-distance descriptions. The own cell has none,
	 * and the array is shared with the exported table, so it is frozen.
	 */
	steps: readonly VistaAxisStep[];
}

/**
 * Decompose an offset into axis steps: one step per non-zero axis, ordered
 * by `COMPASS_ORDER` (north, east, south, west). The ADR's "one step north
 * and one step east" example is the north-east diagonal; every diagonal
 * reads by compass rotation, not by the order the axes are pushed.
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
	return steps.sort(
		(a, b) =>
			COMPASS_ORDER.indexOf(a.direction) - COMPASS_ORDER.indexOf(b.direction),
	);
}

/**
 * Build one frozen Vista offset. The table is exported, so every level is
 * frozen: a consumer that mutated a projected cell's `steps` would otherwise
 * corrupt the shared table for every other consumer.
 */
function defineOffset(dx: number, dy: number): VistaOffset {
	return Object.freeze({
		dx,
		dy,
		steps: Object.freeze(stepsFor(dx, dy)),
	});
}

/**
 * The 13 Vista offsets in canonical order: own cell first, then the ADR
 * 0015 diagram read north-to-south, west-to-east within a row. Frozen, as
 * are each offset and each `steps` array.
 */
export const VISTA_OFFSETS: readonly VistaOffset[] = Object.freeze([
	defineOffset(0, 0),
	defineOffset(0, 2),
	defineOffset(-1, 1),
	defineOffset(0, 1),
	defineOffset(1, 1),
	defineOffset(-2, 0),
	defineOffset(-1, 0),
	defineOffset(1, 0),
	defineOffset(2, 0),
	defineOffset(-1, -1),
	defineOffset(0, -1),
	defineOffset(1, -1),
	defineOffset(0, -2),
]);

/**
 * True when the offset (dx, dy) falls inside the Vista disk:
 * `dx² + dy² ≤ 4`. Includes the own cell and excludes offsets such as
 * `(2, 1)`.
 */
export function inVista(dx: number, dy: number): boolean {
	return dx * dx + dy * dy <= 4;
}

/**
 * True when `cell` falls inside the Vista centered on `observer` — the
 * position-only witness gate for **Witnessed event**, Obstacle Shift, and
 * Convergence eligibility (ADR 0015). Offsets such as `(2, 1)` are outside;
 * the four cardinal distance-2 cells are inside. Obstacles never occlude
 * membership: only the two positions are read, and the observer may be
 * out-of-bounds for callers that hold one (unlike {@link projectVista},
 * which rejects that case because its own-cell guarantee depends on it).
 */
export function vistaContains(
	observer: GridPosition,
	cell: GridPosition,
): boolean {
	// Row 0 is the north edge, so a cell `dy` steps north of the observer has
	// a smaller row: dy = observer.row − cell.row.
	return inVista(cell.col - observer.col, observer.row - cell.row);
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
 * Out-of-bounds cells are Wall sentinels (`isWall: true`); the observer's own
 * cell is always in-bounds, so it is never a Wall. No orientation and no
 * obstacle information enters the projection, so the footprint is position-only and
 * never occluded.
 *
 * @throws RangeError when `position` lies outside the room bounds. An
 * observer is a Daemon's own position, which the dispatcher keeps in-bounds,
 * so an out-of-bounds observer is a caller bug rather than a legal input:
 * rejecting it keeps the "own cell is never a Wall" guarantee unconditional.
 */
export function projectVista(position: GridPosition): VistaCell[] {
	if (!inBounds(position)) {
		throw new RangeError(
			`projectVista: observer (${position.row}, ${position.col}) is outside the ` +
				`${GRID_ROWS}×${GRID_COLS} room`,
		);
	}
	return VISTA_OFFSETS.map((offset) => {
		// Row 0 is the north edge, so north offsets (dy > 0) decrease the
		// row; columns increase eastward, so dx maps straight onto col.
		const pos: GridPosition = {
			row: position.row - offset.dy,
			col: position.col + offset.dx,
		};
		return {
			position: pos,
			isOwnCell: offset.dx === 0 && offset.dy === 0,
			isWall: !inBounds(pos),
			steps: offset.steps,
		};
	});
}
