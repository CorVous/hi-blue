/**
 * Binds the Playwright e2e Vista oracle to the shared production geometry.
 *
 * `e2e/helpers/vista-geometry.ts` (re-exported by `e2e/helpers/stubs.ts`)
 * deliberately re-implements ADR 0015's position-only Vista — the projected
 * disk, the room-bounds check, the cardinal cell labels and the
 * witness-membership predicate — because the specs may not import SPA modules.
 * `e2e/persistence-reload.spec.ts` and `e2e/witnessed-event-reload.spec.ts`
 * then assert the rendered `<what_you_see>` listing against that copy. Nothing
 * in the e2e tree can show the copy is current: the specs only compare the
 * rendered output with the copy itself, so a shared misconception passes, and
 * Playwright does not run in every environment.
 *
 * This test is that proof, and it runs on every `pnpm test`. It walks every
 * in-room observer position and compares, cell by cell, the oracle's
 * projection with `projectVista`, each cell's label with the production
 * rendering of `describeSteps`, the oracle's bounds check with `inBounds`, and
 * the oracle's membership predicate with `vistaContains` for every
 * observer/cell pair across the room and its one-cell wall ring. Changing
 * either side alone — the oracle or the geometry — fails here.
 */
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

/** Cells of the ADR 0015 disk, transcribed from the diagram: 13 offsets. */
const DISK_CELLS = 13;

/**
 * Every position in a square band of width `margin` around the 5×5 room:
 * margin 0 is the room, margin 1 adds the one-cell wall ring.
 */
function positionsAround(margin: number): GridPosition[] {
	const positions: GridPosition[] = [];
	for (let row = -margin; row < GRID_ROWS + margin; row++) {
		for (let col = -margin; col < GRID_COLS + margin; col++) {
			positions.push({ row, col });
		}
	}
	return positions;
}

/** The 25 in-room positions the specs can centre a Vista on. */
const ROOM_POSITIONS = positionsAround(0);

/** The room plus its one-cell wall ring: the 7×7 neighbourhood, 49 positions. */
const ROOM_AND_WALL_RING = positionsAround(1);

/** One projected cell of the e2e oracle, as `vista-geometry.ts` types it. */
type OracleVistaCell = ReturnType<typeof vistaCells>[number];

/**
 * Pair the oracle's projected cells with the production projection index by
 * index, so each comparison reads one oracle cell against the production cell
 * the specs assume it mirrors. The lengths must agree before pairing.
 */
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

/**
 * The label the listing renders for a set of axis steps: the production prompt
 * builder capitalises `describeSteps` at both of its call sites
 * (`renderCurrentState` and `buildDiskSnapshot`), so the oracle's labels are
 * that same prose with its first character uppercased.
 */
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
		// 25 observers × the 25 room cells, plus 25 × the 24 wall-ring cells.
		expect(roomPairs).toBe(625);
		expect(ringPairs).toBe(600);
	});
});
