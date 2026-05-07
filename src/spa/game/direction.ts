/**
 * direction.ts
 *
 * Cardinal direction types, grid constants, and spatial helper functions
 * for the 5×5 gridded world model.
 */

export const CARDINAL_DIRECTIONS = ["north", "south", "east", "west"] as const;

export type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];

export const GRID_ROWS = 5;
export const GRID_COLS = 5;

export interface GridPosition {
	row: number;
	col: number;
}

/** Delta (drow, dcol) for each cardinal direction. Row 0 is the top. */
export function directionDelta(dir: CardinalDirection): {
	drow: number;
	dcol: number;
} {
	switch (dir) {
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

/** Return the new position after moving one step in the given direction. */
export function applyDirection(
	pos: GridPosition,
	dir: CardinalDirection,
): GridPosition {
	const { drow, dcol } = directionDelta(dir);
	return { row: pos.row + drow, col: pos.col + dcol };
}

/** Return true when pos is within the 5×5 grid bounds. */
export function inBounds(pos: GridPosition): boolean {
	return (
		pos.row >= 0 && pos.row < GRID_ROWS && pos.col >= 0 && pos.col < GRID_COLS
	);
}

/** Manhattan distance between two grid positions. */
export function manhattan(a: GridPosition, b: GridPosition): number {
	return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

/** True when a and b are 4-adjacent (share an edge). */
export function areAdjacent4(a: GridPosition, b: GridPosition): boolean {
	return manhattan(a, b) === 1;
}

/** Format a GridPosition as a labeled string for LLM-facing output. */
export function formatPosition(pos: GridPosition): string {
	return `(row ${pos.row}, col ${pos.col})`;
}
