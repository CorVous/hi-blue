export const CARDINAL_DIRECTIONS = ["north", "south", "east", "west"] as const;

export type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];

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

export function applyDirection(
	pos: GridPosition,
	dir: CardinalDirection,
): GridPosition {
	const { drow, dcol } = directionDelta(dir);
	return { row: pos.row + drow, col: pos.col + dcol };
}

export function inBounds(pos: GridPosition): boolean {
	return (
		pos.row >= 0 && pos.row < GRID_ROWS && pos.col >= 0 && pos.col < GRID_COLS
	);
}

export function manhattan(a: GridPosition, b: GridPosition): number {
	return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

export function areAdjacent4(a: GridPosition, b: GridPosition): boolean {
	return manhattan(a, b) === 1;
}

export function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

export function isGridPosition(holder: unknown): holder is GridPosition {
	return typeof holder === "object" && holder !== null;
}
