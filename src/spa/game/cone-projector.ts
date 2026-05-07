/**
 * cone-projector.ts
 *
 * Projects a 5-cell wedge cone from an AI's position and facing direction.
 * The cone describes the cells the AI can currently see:
 *   - Own cell
 *   - Directly in front (1 step in facing direction)
 *   - Two steps ahead, front-left
 *   - Two steps ahead (straight)
 *   - Two steps ahead, front-right
 *
 * Out-of-bounds cells are omitted from the result.
 */

import {
	type CardinalDirection,
	type GridPosition,
	inBounds,
} from "./direction.js";

export type ConePhrasing =
	| "your cell"
	| "directly in front"
	| "two steps ahead, front-left"
	| "two steps ahead"
	| "two steps ahead, front-right";

export interface ConeCell {
	position: GridPosition;
	phrasing: ConePhrasing;
	isOwnCell: boolean;
}

/**
 * Returns the (drow, dcol) delta for one step in the given direction.
 * Row 0 is the top: north = drow -1.
 */
function forwardDelta(facing: CardinalDirection): {
	drow: number;
	dcol: number;
} {
	switch (facing) {
		case "north":
			return { drow: -1, dcol: 0 };
		case "south":
			return { drow: 1, dcol: 0 };
		case "east":
			return { drow: 0, dcol: 1 };
		case "west":
			return { drow: 0, dcol: -1 };
	}
}

/**
 * Returns the (drow, dcol) delta for one step to the "left" relative to facing.
 * Facing-relative left:
 *   north → west (dcol -1), south → east (dcol +1),
 *   east  → north (drow -1), west → south (drow +1)
 */
function leftDelta(facing: CardinalDirection): { drow: number; dcol: number } {
	switch (facing) {
		case "north":
			return { drow: 0, dcol: -1 };
		case "south":
			return { drow: 0, dcol: 1 };
		case "east":
			return { drow: -1, dcol: 0 };
		case "west":
			return { drow: 1, dcol: 0 };
	}
}

/**
 * Project a 5-cell wedge cone from the given position and facing.
 *
 * Returns an array of ConeCell objects in canonical order:
 *   1. own cell
 *   2. directly in front
 *   3. two steps ahead, front-left
 *   4. two steps ahead
 *   5. two steps ahead, front-right
 *
 * Out-of-bounds cells are omitted. Own cell is always included.
 */
export function projectCone(
	position: GridPosition,
	facing: CardinalDirection,
): ConeCell[] {
	const fwd = forwardDelta(facing);
	const lft = leftDelta(facing);

	// Candidate cells in canonical order
	const candidates: Array<{
		row: number;
		col: number;
		phrasing: ConePhrasing;
		isOwnCell: boolean;
	}> = [
		{
			row: position.row,
			col: position.col,
			phrasing: "your cell",
			isOwnCell: true,
		},
		{
			row: position.row + fwd.drow,
			col: position.col + fwd.dcol,
			phrasing: "directly in front",
			isOwnCell: false,
		},
		{
			row: position.row + 2 * fwd.drow + lft.drow,
			col: position.col + 2 * fwd.dcol + lft.dcol,
			phrasing: "two steps ahead, front-left",
			isOwnCell: false,
		},
		{
			row: position.row + 2 * fwd.drow,
			col: position.col + 2 * fwd.dcol,
			phrasing: "two steps ahead",
			isOwnCell: false,
		},
		{
			row: position.row + 2 * fwd.drow - lft.drow,
			col: position.col + 2 * fwd.dcol - lft.dcol,
			phrasing: "two steps ahead, front-right",
			isOwnCell: false,
		},
	];

	const result: ConeCell[] = [];
	for (const c of candidates) {
		const pos: GridPosition = { row: c.row, col: c.col };
		// Own cell is always included; others are filtered by bounds
		if (c.isOwnCell || inBounds(pos)) {
			result.push({
				position: pos,
				phrasing: c.phrasing,
				isOwnCell: c.isOwnCell,
			});
		}
	}
	return result;
}
