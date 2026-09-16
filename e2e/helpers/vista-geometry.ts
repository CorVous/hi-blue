/**
 * The ADR 0015 Vista oracle the Playwright specs assert against, plus the grid
 * primitives those specs read alongside it.
 *
 * This is the e2e tree's own copy of the Vista geometry: the specs assert the
 * rendered `<what_you_see>` listing against `vistaCells` / `inVista`, and they
 * must not import SPA modules, so the disk, the cell labels, the room-bounds
 * check and the witness-membership predicate are re-implemented here
 * (ADR 0015, ticket #539).
 *
 * It lives in this leaf module — free of `@playwright/test` — so that
 * `src/spa/game/__tests__/e2e-vista-oracle.test.ts` can bind the copy to the
 * shared production geometry on every `pnpm test`, exhaustively over the room,
 * instead of leaving that agreement unverified. The specs reach these helpers
 * through `./stubs.js`, which re-exports them.
 */
/** A room cell. Row 0 is the room's north edge; columns increase eastward. */
export interface GridPosition {
	row: number;
	col: number;
}

/** The four directions `go` accepts. */
export type CardinalDirection = "north" | "south" | "east" | "west";

/** The four movement directions, in the order the specs iterate them. */
export const CARDINAL_DIRECTIONS: readonly CardinalDirection[] = [
	"north",
	"south",
	"east",
	"west",
];

/** Compass order used to order the axis steps of a cell label (ADR 0015). */
const COMPASS_ORDER: readonly CardinalDirection[] = [
	"north",
	"east",
	"south",
	"west",
];

/** Spelled-out distances, as `describeSteps` renders them. */
const DISTANCE_WORDS: readonly string[] = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
];

/** Row/column delta for one cardinal step. North decreases the row. */
export function stepDelta(direction: CardinalDirection): {
	drow: number;
	dcol: number;
} {
	switch (direction) {
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

/** True when an entity holder is a grid cell rather than a Daemon id. */
export function isGridPosition(holder: unknown): holder is GridPosition {
	return (
		typeof holder === "object" &&
		holder !== null &&
		typeof (holder as GridPosition).row === "number" &&
		typeof (holder as GridPosition).col === "number"
	);
}

/** True when both positions name the same cell. */
export function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

/** True when `position` is inside the 5×5 room. */
export function inRoom(position: GridPosition): boolean {
	return (
		position.row >= 0 &&
		position.row < 5 &&
		position.col >= 0 &&
		position.col < 5
	);
}

/**
 * The runtime's witness gate (ADR 0015): `cell` is inside the Vista centred on
 * `observer` when `dx² + dy² ≤ 4`, where north decreases the row. Mirrors
 * `vistaContains` in `src/spa/game/vista-projector.ts` — position only, with
 * obstacles never occluding membership.
 */
export function inVista(observer: GridPosition, cell: GridPosition): boolean {
	const dx = cell.col - observer.col;
	const dy = observer.row - cell.row;
	return dx * dx + dy * dy <= 4;
}

/** One cell of the projected Vista, with the label the listing renders. */
export interface VistaCell {
	position: GridPosition;
	isOwnCell: boolean;
	isWall: boolean;
	label: string;
}

/**
 * The 13 Vista offsets (ADR 0015): `dx` runs east–west and `dy` north–south.
 * Mirrors `VISTA_OFFSETS` in `src/spa/game/vista-projector.ts`.
 */
const VISTA_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
	{ dx: 0, dy: 0 },
	{ dx: 0, dy: 2 },
	{ dx: -1, dy: 1 },
	{ dx: 0, dy: 1 },
	{ dx: 1, dy: 1 },
	{ dx: -2, dy: 0 },
	{ dx: -1, dy: 0 },
	{ dx: 1, dy: 0 },
	{ dx: 2, dy: 0 },
	{ dx: -1, dy: -1 },
	{ dx: 0, dy: -1 },
	{ dx: 1, dy: -1 },
	{ dx: 0, dy: -2 },
];

/**
 * Cardinal label for one Vista offset, capitalised as the listing renders it
 * ("one step north and one step east" → "One step north and one step east").
 * Mirrors `describeSteps` + `capitalize` in `src/spa/game/prompt-builder.ts`.
 */
function vistaLabel(dx: number, dy: number): string {
	if (dx === 0 && dy === 0) return "Your cell";
	const steps: Array<{ direction: CardinalDirection; distance: number }> = [];
	if (dy !== 0) {
		steps.push({
			direction: dy > 0 ? "north" : "south",
			distance: Math.abs(dy),
		});
	}
	if (dx !== 0) {
		steps.push({ direction: dx > 0 ? "east" : "west", distance: Math.abs(dx) });
	}
	steps.sort(
		(a, b) =>
			COMPASS_ORDER.indexOf(a.direction) - COMPASS_ORDER.indexOf(b.direction),
	);
	const label = steps
		.map(
			(step) =>
				`${DISTANCE_WORDS[step.distance] ?? String(step.distance)} ` +
				`${step.distance === 1 ? "step" : "steps"} ${step.direction}`,
		)
		.join(" and ");
	return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Project the position-only 13-cell Vista from `observer`, flagging the
 * out-of-bounds cells the Daemon perceives as Walls. Mirrors `projectVista`.
 */
export function vistaCells(observer: GridPosition): VistaCell[] {
	return VISTA_OFFSETS.map((offset) => {
		const position = {
			row: observer.row - offset.dy,
			col: observer.col + offset.dx,
		};
		return {
			position,
			isOwnCell: offset.dx === 0 && offset.dy === 0,
			isWall: !inRoom(position),
			label: vistaLabel(offset.dx, offset.dy),
		};
	});
}

/** The cell labels of a rendered `<what_you_see>` block ("- <label>: <contents>"). */
export function listingLabels(block: string): string[] {
	return block
		.split("\n")
		.filter((line) => line.startsWith("- "))
		.map((line) => {
			const separator = line.indexOf(": ");
			return separator === -1 ? line.slice(2) : line.slice(2, separator);
		});
}

/** The text between the last `open` marker and the `close` that follows it. */
export function sectionBetween(
	text: string,
	open: string,
	close: string,
): string {
	const start = text.lastIndexOf(open);
	if (start === -1) return "";
	const end = text.indexOf(close, start);
	if (end === -1) return "";
	return text.slice(start + open.length, end);
}

/**
 * Relative-direction vocabulary ADR 0015 retired in favour of the room's
 * cardinal axes: a listing must never phrase a position relative to a Daemon.
 * Not a Vista shape — an absence check on rendered prompt prose.
 */
export const RELATIVE_DIRECTION_WORDS =
	/\b(ahead|behind|forward|backward|left|right)\b/i;
