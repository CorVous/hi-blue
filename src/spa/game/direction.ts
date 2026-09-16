/**
 * direction.ts
 *
 * Cardinal direction types, grid constants, and spatial helper functions
 * for the 5×5 gridded world model.
 *
 * Movement is cardinal-only (ADR 0015): `go` names `north`, `south`, `east`,
 * or `west`, and a Daemon has no orientation. There is no relative-direction
 * vocabulary anywhere in this module — nothing converts a cardinal into
 * left/right/forward/back, because nothing has a point of view to convert
 * from. Position prose names cardinals and distances.
 */

export const CARDINAL_DIRECTIONS = ["north", "south", "east", "west"] as const;

export type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];

/**
 * The cardinal directions in compass rotation order: north, east, south,
 * west (clockwise). The single source for the ordering of multi-axis spatial
 * descriptions.
 */
export const COMPASS_ORDER: readonly CardinalDirection[] = [
	"north",
	"east",
	"south",
	"west",
];

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

/** True when two GridPositions refer to the same cell. */
export function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

/** True when `holder` is a GridPosition (not an AiId string). */
export function isGridPosition(holder: unknown): holder is GridPosition {
	return typeof holder === "object" && holder !== null;
}
