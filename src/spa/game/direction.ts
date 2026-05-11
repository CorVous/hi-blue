/**
 * direction.ts
 *
 * Cardinal direction types, grid constants, and spatial helper functions
 * for the 5×5 gridded world model.
 *
 * Relative direction API: daemons receive/emit "forward|back|left|right".
 * The engine keeps all internal state in cardinal coordinates.
 * Use relativeToCardinal / cardinalToRelative at the tool/prompt boundary.
 */

export const CARDINAL_DIRECTIONS = ["north", "south", "east", "west"] as const;

export type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];

export const RELATIVE_DIRECTIONS = [
	"forward",
	"back",
	"left",
	"right",
] as const;

export type RelativeDirection = (typeof RELATIVE_DIRECTIONS)[number];

/**
 * Convert a relative direction (from the daemon's point of view) to a
 * cardinal direction given the daemon's current facing.
 *
 * Examples (facing="north"):
 *   forward → "north", back → "south", left → "west", right → "east"
 *
 * "go back" means: turn 180° and walk one cell — the daemon ends up facing
 * the direction it walked. This keeps the engine invariant that `go` always
 * sets facing.
 */
export function relativeToCardinal(
	facing: CardinalDirection,
	relative: RelativeDirection,
): CardinalDirection {
	if (relative === "forward") return facing;

	// Cardinal order around the compass: N, E, S, W (clockwise).
	const CW: CardinalDirection[] = ["north", "east", "south", "west"];
	const idx = CW.indexOf(facing);

	switch (relative) {
		case "back":
			return CW[(idx + 2) % 4] as CardinalDirection;
		case "right":
			return CW[(idx + 1) % 4] as CardinalDirection;
		case "left":
			return CW[(idx + 3) % 4] as CardinalDirection;
	}
}

/**
 * Convert an absolute cardinal direction to a relative direction from the
 * daemon's current facing.
 *
 * Examples (facing="north"):
 *   "north" → "forward", "south" → "back", "west" → "left", "east" → "right"
 */
export function cardinalToRelative(
	facing: CardinalDirection,
	absolute: CardinalDirection,
): RelativeDirection {
	const CW: CardinalDirection[] = ["north", "east", "south", "west"];
	const facingIdx = CW.indexOf(facing);
	const absIdx = CW.indexOf(absolute);
	const delta = (absIdx - facingIdx + 4) % 4;
	switch (delta) {
		case 0:
			return "forward";
		case 1:
			return "right";
		case 2:
			return "back";
		case 3:
			return "left";
		default:
			// unreachable; TypeScript exhaustiveness
			return "forward";
	}
}

/**
 * Default fallback landmarks used in tests and backward-compat engine paths.
 * These are minimal placeholder values — real content packs always have richer
 * LLM-generated landmarks.
 */
export const DEFAULT_LANDMARKS = {
	north: {
		shortName: "the distant ridge",
		horizonPhrase: "rises at the edge of the world, grey and unmoving",
	},
	south: {
		shortName: "the far shore",
		horizonPhrase: "curves away behind a low haze",
	},
	east: {
		shortName: "the ruined tower",
		horizonPhrase: "stands alone against the pale sky",
	},
	west: {
		shortName: "the old bridge",
		horizonPhrase: "vanishes into the mist beyond the tree line",
	},
} as const;

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

/**
 * The 3 cells forming the immediate front arc: front-left diagonal, directly
 * in front, and front-right diagonal. Out-of-bounds cells are omitted.
 */
export function frontArc(
	pos: GridPosition,
	facing: CardinalDirection,
): GridPosition[] {
	const fwd = directionDelta(facing);
	const lft = { drow: -fwd.dcol, dcol: fwd.drow };
	return [
		{ row: pos.row + fwd.drow + lft.drow, col: pos.col + fwd.dcol + lft.dcol },
		{ row: pos.row + fwd.drow, col: pos.col + fwd.dcol },
		{ row: pos.row + fwd.drow - lft.drow, col: pos.col + fwd.dcol - lft.dcol },
	].filter(inBounds);
}

/**
 * Format a GridPosition as a labeled string for engine-internal logs.
 * NOT surfaced to daemons; used only in action-log records and dev tools.
 */
export function formatPosition(pos: GridPosition): string {
	return `(row ${pos.row}, col ${pos.col})`;
}
