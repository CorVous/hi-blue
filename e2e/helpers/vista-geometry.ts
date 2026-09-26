export interface GridPosition {
	row: number;
	col: number;
}

export type CardinalDirection = "north" | "south" | "east" | "west";

export const CARDINAL_DIRECTIONS: readonly CardinalDirection[] = [
	"north",
	"south",
	"east",
	"west",
];

const LABEL_AXIS_ORDER: readonly CardinalDirection[] = [
	"north",
	"east",
	"south",
	"west",
];

const DISTANCE_WORDS: readonly string[] = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
];

const ROOM_SIDE_CELLS = 5;

const VISTA_RADIUS_SQUARED = 4;

const OWN_CELL_LABEL = "Your cell";

const LISTING_BULLET = "- ";

const LISTING_LABEL_SEPARATOR = ": ";

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

export function isGridPosition(holder: unknown): holder is GridPosition {
	return (
		typeof holder === "object" &&
		holder !== null &&
		typeof (holder as GridPosition).row === "number" &&
		typeof (holder as GridPosition).col === "number"
	);
}

export function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

export function inRoom(position: GridPosition): boolean {
	return (
		position.row >= 0 &&
		position.row < ROOM_SIDE_CELLS &&
		position.col >= 0 &&
		position.col < ROOM_SIDE_CELLS
	);
}

export function inVista(observer: GridPosition, cell: GridPosition): boolean {
	const eastward = cell.col - observer.col;
	const northward = observer.row - cell.row;
	return eastward * eastward + northward * northward <= VISTA_RADIUS_SQUARED;
}

export interface VistaCell {
	position: GridPosition;
	isOwnCell: boolean;
	isWall: boolean;
	label: string;
}

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

function vistaLabel(dx: number, dy: number): string {
	if (dx === 0 && dy === 0) return OWN_CELL_LABEL;
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
			LABEL_AXIS_ORDER.indexOf(a.direction) -
			LABEL_AXIS_ORDER.indexOf(b.direction),
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

export function listingLabels(listingBlock: string): string[] {
	return listingBlock
		.split("\n")
		.filter((line) => line.startsWith(LISTING_BULLET))
		.map((line) => {
			const labelStart = LISTING_BULLET.length;
			const labelEnd = line.indexOf(LISTING_LABEL_SEPARATOR);
			return labelEnd === -1
				? line.slice(labelStart)
				: line.slice(labelStart, labelEnd);
		});
}

export function sectionBetween(
	text: string,
	lastOpenMarker: string,
	closeMarker: string,
): string {
	const start = text.lastIndexOf(lastOpenMarker);
	if (start === -1) return "";
	const end = text.indexOf(closeMarker, start);
	if (end === -1) return "";
	return text.slice(start + lastOpenMarker.length, end);
}

export const RELATIVE_DIRECTION_WORDS =
	/\b(ahead|behind|forward|backward|left|right)\b/i;
