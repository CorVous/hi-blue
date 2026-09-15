import { describe, expect, it } from "vitest";
import type { GridPosition } from "../direction";
import { directionDelta, GRID_COLS, GRID_ROWS, inBounds } from "../direction";
import type { VistaAxisStep, VistaCell, VistaOffset } from "../vista-projector";
import { inVista, projectVista, VISTA_OFFSETS } from "../vista-projector";

/**
 * The 13 Vista offsets, transcribed verbatim from the ADR 0015 diagram: rows
 * run north-to-south, west-to-east within a row, own cell first. The
 * expectations below are built from this literal, not from the exported
 * table.
 */
const CANONICAL_OFFSETS: Array<[number, number]> = [
	[0, 0], // own cell
	[0, 2], // two steps north
	[-1, 1],
	[0, 1],
	[1, 1],
	[-2, 0],
	[-1, 0],
	[1, 0],
	[2, 0],
	[-1, -1],
	[0, -1],
	[1, -1],
	[0, -2],
];

/**
 * Independently worked expectation (from the ADR 0015 disk, not the
 * implementation): for every one of the 25 room positions, how many of the
 * 13 Vista cells land in-bounds. Walls make up the rest: 13 − in-bounds.
 * The named archetypes are centre (13/0), edge-mid (9/4), corner (6/7).
 */
const EXPECTED_INBOUNDS: number[][] = [
	[6, 8, 9, 8, 6],
	[8, 11, 12, 11, 8],
	[9, 12, 13, 12, 9],
	[8, 11, 12, 11, 8],
	[6, 8, 9, 8, 6],
];

/** Every room position, row-major. */
const ROOM_POSITIONS: GridPosition[] = Array.from(
	{ length: GRID_ROWS * GRID_COLS },
	(_, index) => ({
		row: Math.floor(index / GRID_COLS),
		col: index % GRID_COLS,
	}),
);

/** The named offset from the exported table, or a loud failure. */
function offsetAt(dx: number, dy: number): VistaOffset {
	const found = VISTA_OFFSETS.find((o) => o.dx === dx && o.dy === dy);
	if (!found) throw new Error(`No Vista offset at (${dx}, ${dy})`);
	return found;
}

/** True when the exported table carries the offset. */
function present(dx: number, dy: number): boolean {
	return VISTA_OFFSETS.some((o) => o.dx === dx && o.dy === dy);
}

/**
 * The offset (dx, dy) locating a projected cell, derived from absolute
 * positions under ADR 0015's axis convention (dx east-positive, dy
 * north-positive) rather than from the exported table.
 */
function offsetOf(observer: GridPosition, cell: VistaCell): [number, number] {
	return [cell.position.col - observer.col, observer.row - cell.position.row];
}

/** The projected cell at relative offset (dx, dy), or a loud failure. */
function cellAt(position: GridPosition, dx: number, dy: number): VistaCell {
	const found = projectVista(position).find((cell) => {
		const [cellDx, cellDy] = offsetOf(position, cell);
		return cellDx === dx && cellDy === dy;
	});
	if (!found) {
		throw new Error(
			`No Vista cell at (${dx}, ${dy}) from (${position.row}, ${position.col})`,
		);
	}
	return found;
}

/** The Vista tallies at a position: [in-bounds cells, Wall sentinels]. */
function talliesAt(position: GridPosition): [number, number] {
	const cells = projectVista(position);
	const inBoundsCells = cells.filter((cell) => !cell.isWall).length;
	return [inBoundsCells, cells.length - inBoundsCells];
}

/**
 * Compose a cell's axis steps back into (dx, dy) using the engine's own
 * direction table, so the test never re-derives steps by the same code path
 * as the implementation.
 */
function stepsOffset(steps: readonly VistaAxisStep[]): [number, number] {
	let dx = 0;
	let dy = 0;
	for (const step of steps) {
		// The ADR's dy axis is north-positive; the engine's drow is
		// north-negative, so compose dy through the negated row delta.
		const d = directionDelta(step.direction);
		dx += d.dcol * step.distance;
		dy += -d.drow * step.distance;
	}
	return [dx, dy];
}

describe("VISTA_OFFSETS — the ADR 0015 disk", () => {
	it("contains exactly the 13 offsets from the ADR diagram, in canonical order", () => {
		expect(VISTA_OFFSETS.map((o) => [o.dx, o.dy])).toEqual(CANONICAL_OFFSETS);
	});

	it("is exactly the brute-force enumeration of inVista over dx, dy ∈ [-2, 2]", () => {
		const enumerated: string[] = [];
		for (let dy = -2; dy <= 2; dy++) {
			for (let dx = -2; dx <= 2; dx++) {
				if (inVista(dx, dy)) enumerated.push(`${dx},${dy}`);
			}
		}
		expect(enumerated).toHaveLength(CANONICAL_OFFSETS.length);
		expect(new Set(enumerated)).toEqual(
			new Set(CANONICAL_OFFSETS.map(([dx, dy]) => `${dx},${dy}`)),
		);
	});
});

describe("inVista — the dx² + dy² ≤ 4 predicate", () => {
	it("includes the own cell", () => {
		expect(inVista(0, 0)).toBe(true);
	});

	it("includes the four cardinal neighbours and the four adjacent diagonals", () => {
		expect(inVista(1, 0)).toBe(true);
		expect(inVista(-1, 0)).toBe(true);
		expect(inVista(0, 1)).toBe(true);
		expect(inVista(0, -1)).toBe(true);
		expect(inVista(1, 1)).toBe(true);
		expect(inVista(-1, 1)).toBe(true);
		expect(inVista(1, -1)).toBe(true);
		expect(inVista(-1, -1)).toBe(true);
	});

	it("includes the four cardinal distance-2 cells", () => {
		expect(inVista(2, 0)).toBe(true);
		expect(inVista(-2, 0)).toBe(true);
		expect(inVista(0, 2)).toBe(true);
		expect(inVista(0, -2)).toBe(true);
	});

	it("excludes (2,1) and its rotations and reflections", () => {
		expect(inVista(2, 1)).toBe(false);
		expect(inVista(1, 2)).toBe(false);
		expect(inVista(-2, 1)).toBe(false);
		expect(inVista(-1, 2)).toBe(false);
		expect(inVista(2, -1)).toBe(false);
		expect(inVista(1, -2)).toBe(false);
		expect(inVista(-2, -1)).toBe(false);
		expect(inVista(-1, -2)).toBe(false);
	});

	it("excludes everything further out, e.g. (2,2), (3,0), (0,3)", () => {
		expect(inVista(2, 2)).toBe(false);
		expect(inVista(3, 0)).toBe(false);
		expect(inVista(0, 3)).toBe(false);
	});
});

describe("VISTA_OFFSETS — disk integrity", () => {
	it("is symmetric under reflection in both axes", () => {
		for (const o of VISTA_OFFSETS) {
			expect(present(-o.dx, o.dy)).toBe(true);
			expect(present(o.dx, -o.dy)).toBe(true);
			expect(present(-o.dx, -o.dy)).toBe(true);
		}
	});

	it("has no duplicate offsets", () => {
		const keys = VISTA_OFFSETS.map((o) => `${o.dx},${o.dy}`);
		expect(new Set(keys).size).toBe(VISTA_OFFSETS.length);
	});

	it("includes the own cell exactly once", () => {
		const own = VISTA_OFFSETS.filter((o) => o.dx === 0 && o.dy === 0);
		expect(own).toHaveLength(1);
	});

	it("agrees with the inVista predicate on every offset", () => {
		for (const o of VISTA_OFFSETS) {
			expect(inVista(o.dx, o.dy)).toBe(true);
		}
	});

	it("is frozen at every level, so no consumer can corrupt the shared table", () => {
		expect(Object.isFrozen(VISTA_OFFSETS)).toBe(true);
		for (const o of VISTA_OFFSETS) {
			expect(Object.isFrozen(o)).toBe(true);
			expect(Object.isFrozen(o.steps)).toBe(true);
		}
	});
});

describe("projectVista — the position-only 13-cell disk", () => {
	it("from the centre: all 13 cells in-bounds, no walls, no duplicates", () => {
		const cells = projectVista({ row: 2, col: 2 });
		expect(cells).toHaveLength(13);
		for (const c of cells) {
			expect(c.isWall).toBe(false);
		}
		const positions = cells.map((c) => `${c.position.row},${c.position.col}`);
		expect(new Set(positions).size).toBe(13);
		// Transcribed verbatim from the ADR 0015 diagram (observer at the
		// room centre): own cell first, north-to-south rows west-to-east.
		expect(positions).toEqual([
			"2,2", // own cell
			"0,2", // two steps north
			"1,1",
			"1,2",
			"1,3",
			"2,0",
			"2,1",
			"2,3",
			"2,4",
			"3,1",
			"3,2",
			"3,3",
			"4,2",
		]);
	});

	it("from the north-west corner: 6 room cells and 7 Wall sentinels", () => {
		const cells = projectVista({ row: 0, col: 0 });
		expect(cells).toHaveLength(13);
		const inBounds = cells.filter((c) => !c.isWall);
		const walls = cells.filter((c) => c.isWall);
		expect(inBounds).toHaveLength(6);
		expect(walls).toHaveLength(7);
		// Worked expectation: out-of-bounds positions are preserved as Wall
		// sentinels, not clipped away from the footprint.
		expect(walls.map((c) => c.position)).toEqual([
			{ row: -2, col: 0 }, // two steps north
			{ row: -1, col: -1 }, // north-west diagonal
			{ row: -1, col: 0 }, // one step north
			{ row: -1, col: 1 }, // north-east diagonal
			{ row: 0, col: -2 }, // two steps west
			{ row: 0, col: -1 }, // one step west
			{ row: 1, col: -1 }, // south-west diagonal
		]);
	});

	it("walls exactly the out-of-bounds cells: literal expectation at (4, 3)", () => {
		// Worked from the ADR diagram, not from the implementation: observer
		// (4,3) sits one row above the south edge and two columns from the
		// east edge, so 8 of the 13 cells are room cells and 5 are Walls.
		const cells = projectVista({ row: 4, col: 3 });
		const room = cells
			.filter((c) => !c.isWall)
			.map((c) => [c.position.row, c.position.col]);
		const walls = cells
			.filter((c) => c.isWall)
			.map((c) => [c.position.row, c.position.col]);
		expect(room).toEqual([
			[4, 3], // own cell
			[2, 3], // two steps north
			[3, 2], // north-west diagonal
			[3, 3], // one step north
			[3, 4], // north-east diagonal
			[4, 1], // two steps west
			[4, 2], // one step west
			[4, 4], // one step east
		]);
		expect(walls).toEqual([
			[4, 5], // two steps east
			[5, 2], // south-west diagonal
			[5, 3], // one step south
			[5, 4], // south-east diagonal
			[6, 3], // two steps south
		]);
	});

	it("projects only disk cells: every projected cell's offset satisfies inVista", () => {
		for (const position of ROOM_POSITIONS) {
			for (const cell of projectVista(position)) {
				expect(inVista(...offsetOf(position, cell))).toBe(true);
			}
		}
	});

	it("translates with the observer: the same ordered offsets at all 25 positions", () => {
		for (const position of ROOM_POSITIONS) {
			const offsets = projectVista(position).map((cell) =>
				offsetOf(position, cell),
			);
			expect(offsets).toEqual(CANONICAL_OFFSETS);
		}
	});

	it("in-bounds and Wall counts agree at all 25 room positions", () => {
		for (const position of ROOM_POSITIONS) {
			const cells = projectVista(position);
			expect(cells).toHaveLength(VISTA_OFFSETS.length);
			const [room, walls] = talliesAt(position);
			const expected = EXPECTED_INBOUNDS[position.row]?.[position.col] ?? 0;
			expect(room).toBe(expected);
			expect(walls).toBe(cells.length - expected);
		}
	});

	it("asserts the named archetypes against worked counts: 13/0, 9/4, 6/7", () => {
		expect(talliesAt({ row: 2, col: 2 })).toEqual([13, 0]); // centre
		expect(talliesAt({ row: 0, col: 2 })).toEqual([9, 4]); // edge-mid
		expect(talliesAt({ row: 0, col: 0 })).toEqual([6, 7]); // corner
	});

	it("keeps the own cell first, in-bounds, and never a Wall", () => {
		for (const position of ROOM_POSITIONS) {
			const own = projectVista(position)[0];
			expect(own?.isOwnCell).toBe(true);
			expect(own?.position).toEqual(position);
			expect(own?.isWall).toBe(false);
		}
	});

	it("rejects an out-of-bounds observer rather than exempting its own cell", () => {
		// An observer is a Daemon's own position, which is always in-bounds
		// (the dispatcher enforces that), so an out-of-bounds observer is a
		// caller bug: the own-cell exemption must not silently produce a
		// footprint whose own cell is the only non-Wall in the room.
		for (const position of [
			{ row: -1, col: 2 },
			{ row: 5, col: 2 },
			{ row: 2, col: -1 },
			{ row: 2, col: 5 },
		]) {
			expect(inBounds(position)).toBe(false);
			expect(() => projectVista(position)).toThrow(RangeError);
		}
	});

	it("hands every projected cell the frozen shared steps array", () => {
		const cell = cellAt({ row: 2, col: 2 }, 0, 2);
		expect(cell.steps).toBe(offsetAt(0, 2).steps);
		expect(Object.isFrozen(cell.steps)).toBe(true);
		expect(() =>
			(cell.steps as VistaAxisStep[]).push({ direction: "north", distance: 1 }),
		).toThrow(TypeError);
		// The exported table is untouched by the failed mutation.
		expect(offsetAt(0, 2).steps).toEqual([{ direction: "north", distance: 2 }]);
	});
});

describe("Vista footprint — no facing, no occluders", () => {
	it("takes only the observer's position, so no occluder can remove a cell", () => {
		// ADR 0015: obstacles do not occlude the Vista. The guarantee is
		// structural — `projectVista` accepts the observer's position and
		// nothing else, so no facing and no occluder set can reach the
		// footprint. The other half of the rule (no cell is ever dropped) is
		// pinned by the translation test above, which compares the projected
		// offsets with the ADR diagram at all 25 room positions.
		expect(projectVista.length).toBe(1);
	});
});

describe("VistaOffset.steps — cardinal direction-and-distance descriptions", () => {
	it("the own cell has no steps", () => {
		expect(offsetAt(0, 0).steps).toEqual([]);
	});

	it("matches the ADR example: (1,1) is one step north and one step east", () => {
		expect(offsetAt(1, 1).steps).toEqual([
			{ direction: "north", distance: 1 },
			{ direction: "east", distance: 1 },
		]);
	});

	it("orders every diagonal's steps by compass rotation (north, east, south, west)", () => {
		expect(offsetAt(1, 1).steps.map((s) => s.direction)).toEqual([
			"north",
			"east",
		]);
		expect(offsetAt(-1, 1).steps.map((s) => s.direction)).toEqual([
			"north",
			"west",
		]);
		expect(offsetAt(1, -1).steps.map((s) => s.direction)).toEqual([
			"east",
			"south",
		]);
		expect(offsetAt(-1, -1).steps.map((s) => s.direction)).toEqual([
			"south",
			"west",
		]);
	});

	it("gives each pure-cardinal distance-2 offset a single two-step axis", () => {
		expect(offsetAt(0, 2).steps).toEqual([{ direction: "north", distance: 2 }]);
		expect(offsetAt(0, -2).steps).toEqual([
			{ direction: "south", distance: 2 },
		]);
		expect(offsetAt(2, 0).steps).toEqual([{ direction: "east", distance: 2 }]);
		expect(offsetAt(-2, 0).steps).toEqual([{ direction: "west", distance: 2 }]);
	});

	it("composes back to the original offset for every Vista offset", () => {
		for (const o of VISTA_OFFSETS) {
			expect(stepsOffset(o.steps)).toEqual([o.dx, o.dy]);
		}
	});

	it("composes to the projected cell's position-derived offset everywhere", () => {
		for (const position of ROOM_POSITIONS) {
			for (const cell of projectVista(position)) {
				expect(stepsOffset(cell.steps)).toEqual(offsetOf(position, cell));
			}
		}
	});

	it("keeps steps deterministic: no step is zero, none repeat a direction", () => {
		for (const o of VISTA_OFFSETS) {
			for (const step of o.steps) {
				expect(step.distance).toBeGreaterThan(0);
			}
			const dirs = o.steps.map((s) => s.direction);
			expect(new Set(dirs).size).toBe(dirs.length);
		}
	});
});
