/**
 * cone-projector.ts
 *
 * Projects a 9-cell wedge cone from an AI's position and facing direction.
 * The cone describes the cells the AI can currently see:
 *   - Own cell
 *   - Directly in front, left diagonal (1 step)
 *   - Directly in front (1 step)
 *   - Directly in front, right diagonal (1 step)
 *   - Two steps ahead, far-left
 *   - Two steps ahead, front-left
 *   - Two steps ahead (straight)
 *   - Two steps ahead, front-right
 *   - Two steps ahead, far-right
 *
 * Out-of-bounds cells are omitted from the result.
 */

import {
	type CardinalDirection,
	directionDelta,
	type GridPosition,
	inBounds,
} from "./direction.js";

export type ConePhrasing =
	| "your cell"
	| "directly in front, left"
	| "directly in front"
	| "directly in front, right"
	| "two steps ahead, far-left"
	| "two steps ahead, front-left"
	| "two steps ahead"
	| "two steps ahead, front-right"
	| "two steps ahead, far-right";

export interface ConeCell {
	position: GridPosition;
	phrasing: ConePhrasing;
	isOwnCell: boolean;
}

/**
 * Project a 9-cell wedge cone from the given position and facing.
 *
 * Returns an array of ConeCell objects in canonical order:
 *   1. own cell
 *   2. directly in front, left
 *   3. directly in front
 *   4. directly in front, right
 *   5. two steps ahead, far-left
 *   6. two steps ahead, front-left
 *   7. two steps ahead
 *   8. two steps ahead, front-right
 *   9. two steps ahead, far-right
 *
 * Out-of-bounds cells are omitted. Own cell is always included.
 */
export function projectCone(
	position: GridPosition,
	facing: CardinalDirection,
): ConeCell[] {
	const fwd = directionDelta(facing);
	const lft = { drow: -fwd.dcol, dcol: fwd.drow };

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
		// Distance 1 — front arc
		{
			row: position.row + fwd.drow + lft.drow,
			col: position.col + fwd.dcol + lft.dcol,
			phrasing: "directly in front, left",
			isOwnCell: false,
		},
		{
			row: position.row + fwd.drow,
			col: position.col + fwd.dcol,
			phrasing: "directly in front",
			isOwnCell: false,
		},
		{
			row: position.row + fwd.drow - lft.drow,
			col: position.col + fwd.dcol - lft.dcol,
			phrasing: "directly in front, right",
			isOwnCell: false,
		},
		// Distance 2 — wide fan
		{
			row: position.row + 2 * fwd.drow + 2 * lft.drow,
			col: position.col + 2 * fwd.dcol + 2 * lft.dcol,
			phrasing: "two steps ahead, far-left",
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
		{
			row: position.row + 2 * fwd.drow - 2 * lft.drow,
			col: position.col + 2 * fwd.dcol - 2 * lft.dcol,
			phrasing: "two steps ahead, far-right",
			isOwnCell: false,
		},
	];

	const result: ConeCell[] = [];
	for (const c of candidates) {
		const pos: GridPosition = { row: c.row, col: c.col };
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
