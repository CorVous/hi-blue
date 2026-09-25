import type { CardinalDirection, GridPosition } from "./direction.js";
import { COMPASS_ORDER, GRID_COLS, GRID_ROWS, inBounds } from "./direction.js";

const VISTA_RADIUS = 2;

export interface VistaAxisStep {
	direction: CardinalDirection;
	distance: number;
}

export interface VistaOffset {
	dx: number;
	dy: number;
	steps: readonly VistaAxisStep[];
}

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

function defineOffset(dx: number, dy: number): VistaOffset {
	return Object.freeze({
		dx,
		dy,
		steps: Object.freeze(stepsFor(dx, dy)),
	});
}

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

export function inVista(dx: number, dy: number): boolean {
	return dx * dx + dy * dy <= VISTA_RADIUS * VISTA_RADIUS;
}

export function vistaContains(
	observer: GridPosition,
	cell: GridPosition,
): boolean {
	const stepsEast = cell.col - observer.col;
	const stepsNorth = observer.row - cell.row;
	return inVista(stepsEast, stepsNorth);
}

export interface VistaCell {
	position: GridPosition;
	isOwnCell: boolean;
	isWall: boolean;
	steps: readonly VistaAxisStep[];
}

export function projectVista(position: GridPosition): VistaCell[] {
	if (!inBounds(position)) {
		throw new RangeError(
			`projectVista: observer (${position.row}, ${position.col}) is outside the ` +
				`${GRID_ROWS}×${GRID_COLS} room`,
		);
	}
	return VISTA_OFFSETS.map((offset) => {
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
