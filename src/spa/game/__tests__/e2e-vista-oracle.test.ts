import { describe, expect, it } from "vitest";
import {
	inRoom,
	inVista,
	vistaCells,
} from "../../../../e2e/helpers/vista-geometry.js";
import type { GridPosition } from "../direction";
import { GRID_COLS, GRID_ROWS, inBounds } from "../direction";
import { describeSteps } from "../prompt-builder";
import type { VistaAxisStep, VistaCell } from "../vista-projector";
import { projectVista, vistaContains } from "../vista-projector";

const DISK_CELLS = 13;

function positionsAround(margin: number): GridPosition[] {
	const positions: GridPosition[] = [];
	for (let row = -margin; row < GRID_ROWS + margin; row++) {
		for (let col = -margin; col < GRID_COLS + margin; col++) {
			positions.push({ row, col });
		}
	}
	return positions;
}

const ROOM_POSITIONS = positionsAround(0);

const ROOM_AND_WALL_RING = positionsAround(1);

type OracleVistaCell = ReturnType<typeof vistaCells>[number];

function alignedVista(
	observer: GridPosition,
): Array<{ oracle: OracleVistaCell; production: VistaCell }> {
	const oracle = vistaCells(observer);
	const production = projectVista(observer);
	expect(
		oracle,
		`vistaCells(${observer.row}, ${observer.col}) must project the same number of cells as projectVista`,
	).toHaveLength(production.length);
	return production.map((cell, index) => {
		const oracleCell = oracle[index];
		if (oracleCell === undefined) {
			throw new Error(
				`vistaCells(${observer.row}, ${observer.col}) has no cell at index ${index}`,
			);
		}
		return { oracle: oracleCell, production: cell };
	});
}

function renderedLabel(steps: readonly VistaAxisStep[]): string {
	const prose = describeSteps(steps);
	return prose.charAt(0).toUpperCase() + prose.slice(1);
}

describe("e2e Vista oracle — parity with the shared production geometry", () => {
	it("covers all 25 in-room observer positions", () => {
		expect(ROOM_POSITIONS).toHaveLength(GRID_ROWS * GRID_COLS);
		expect(ROOM_POSITIONS).toHaveLength(25);
		expect(ROOM_AND_WALL_RING).toHaveLength((GRID_ROWS + 2) * (GRID_COLS + 2));
		expect(ROOM_AND_WALL_RING).toHaveLength(49);
	});

	it("projects the cells projectVista projects, from every in-room observer", () => {
		let cellsChecked = 0;
		for (const observer of ROOM_POSITIONS) {
			for (const { oracle, production } of alignedVista(observer)) {
				expect(oracle.position).toEqual(production.position);
				expect(oracle.isOwnCell).toBe(production.isOwnCell);
				expect(oracle.isWall).toBe(production.isWall);
				cellsChecked++;
			}
		}
		expect(cellsChecked).toBe(ROOM_POSITIONS.length * DISK_CELLS);
	});

	it("labels every projected cell as the production renderer does", () => {
		let labelsChecked = 0;
		for (const observer of ROOM_POSITIONS) {
			for (const { oracle, production } of alignedVista(observer)) {
				expect(
					oracle.label,
					`label at (${production.position.row}, ${production.position.col})`,
				).toBe(renderedLabel(production.steps));
				labelsChecked++;
			}
		}
		expect(labelsChecked).toBe(ROOM_POSITIONS.length * DISK_CELLS);
	});

	it("checks room bounds as inBounds does", () => {
		const surroundings = positionsAround(2);
		for (const position of surroundings) {
			expect(inRoom(position), `inRoom(${position.row}, ${position.col})`).toBe(
				inBounds(position),
			);
		}
		expect(surroundings).toHaveLength((GRID_ROWS + 4) * (GRID_COLS + 4));
	});

	it("gates membership as vistaContains does for every observer/cell pair", () => {
		const roomCells = ROOM_AND_WALL_RING.filter((cell) => inRoom(cell));
		const ringCells = ROOM_AND_WALL_RING.filter((cell) => !inRoom(cell));
		expect(roomCells).toHaveLength(25);
		expect(ringCells).toHaveLength(24);

		let roomPairs = 0;
		let ringPairs = 0;
		for (const observer of ROOM_POSITIONS) {
			for (const cell of ROOM_AND_WALL_RING) {
				expect(
					inVista(observer, cell),
					`inVista((${observer.row}, ${observer.col}) → ` +
						`(${cell.row}, ${cell.col}))`,
				).toBe(vistaContains(observer, cell));
				if (inRoom(cell)) roomPairs++;
				else ringPairs++;
			}
		}
		expect(roomPairs).toBe(625);
		expect(ringPairs).toBe(600);
	});
});
