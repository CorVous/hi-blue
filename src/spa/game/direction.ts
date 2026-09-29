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

function directionDelta(dir: CardinalDirection): {
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

export function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

export function isGridPosition(holder: unknown): holder is GridPosition {
	return typeof holder === "object" && holder !== null;
}

export const TOTAL_CELLS = GRID_ROWS * GRID_COLS;

export function cellIndex(pos: GridPosition): number {
	return pos.row * GRID_COLS + pos.col;
}

export function cellAtIndex(index: number): GridPosition {
	return { row: Math.floor(index / GRID_COLS), col: index % GRID_COLS };
}

function reachableCellIndices(
	start: GridPosition,
	blocked: ReadonlySet<number>,
): Set<number> {
	const startIndex = cellIndex(start);
	const visited = new Set<number>([startIndex]);
	const queue: number[] = [startIndex];
	while (queue.length > 0) {
		const current = cellAtIndex(queue.shift() as number);
		for (const dir of CARDINAL_DIRECTIONS) {
			const neighbor = applyDirection(current, dir);
			if (!inBounds(neighbor)) continue;
			const neighborIndex = cellIndex(neighbor);
			if (blocked.has(neighborIndex) || visited.has(neighborIndex)) continue;
			visited.add(neighborIndex);
			queue.push(neighborIndex);
		}
	}
	return visited;
}

export function everyOpenCellReachable(
	starts: readonly GridPosition[],
	blocked: ReadonlySet<number>,
): boolean {
	const openCells: number[] = [];
	for (let index = 0; index < TOTAL_CELLS; index++) {
		if (!blocked.has(index)) openCells.push(index);
	}
	return starts.every((start) => {
		const reachable = reachableCellIndices(start, blocked);
		return openCells.every((index) => reachable.has(index));
	});
}
