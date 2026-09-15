import { describe, expect, it } from "vitest";
import { directionDelta, inBounds } from "../direction";
import { inVista, projectVista, VISTA_OFFSETS } from "../vista-projector";

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

describe("VISTA_OFFSETS — the ADR 0015 disk", () => {
	it("contains exactly the 13 offsets from the ADR diagram, in canonical order", () => {
		// Transcribed verbatim from the ADR 0015 diagram: rows run
		// north-to-south, west-to-east within a row, own cell first.
		const expected: Array<[number, number]> = [
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
		expect(VISTA_OFFSETS.map((o) => [o.dx, o.dy])).toEqual(expected);
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
		const present = (dx: number, dy: number) =>
			VISTA_OFFSETS.some((o) => o.dx === dx && o.dy === dy);
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

	it("every cell's Wall flag agrees with room bounds", () => {
		for (const c of projectVista({ row: 4, col: 3 })) {
			expect(c.isWall).toBe(!c.isOwnCell && !inBounds(c.position));
		}
	});

	it("in-bounds and Wall counts agree at all 25 room positions", () => {
		for (let row = 0; row < 5; row++) {
			for (let col = 0; col < 5; col++) {
				const cells = projectVista({ row, col });
				expect(cells).toHaveLength(13);
				const inBounds = cells.filter((c) => !c.isWall).length;
				const walls = cells.length - inBounds;
				expect(inBounds).toBe(EXPECTED_INBOUNDS[row]?.[col] ?? 0);
				expect(walls).toBe(13 - (EXPECTED_INBOUNDS[row]?.[col] ?? 0));
			}
		}
	});

	it("asserts the named archetypes against worked counts: 13/0, 9/4, 6/7", () => {
		const counts = (row: number, col: number) => {
			const cells = projectVista({ row, col });
			const inBounds = cells.filter((c) => !c.isWall).length;
			return [inBounds, cells.length - inBounds] as const;
		};
		expect(counts(2, 2)).toEqual([13, 0]); // centre
		expect(counts(0, 2)).toEqual([9, 4]); // edge-mid
		expect(counts(0, 0)).toEqual([6, 7]); // corner
	});

	it("keeps the own cell first, in-bounds, and never a Wall", () => {
		for (const [row, col] of [
			[0, 0],
			[2, 2],
			[4, 4],
		] as const) {
			const cells = projectVista({ row, col });
			expect(cells[0]?.isOwnCell).toBe(true);
			expect(cells[0]?.position).toEqual({ row, col });
			expect(cells[0]?.isWall).toBe(false);
		}
	});
});

describe("VistaOffset — no occlusion by obstacles", () => {
	it("keeps cells intact behind an obstacle: the footprint never changes", () => {
		// The projection takes a position only — no facing, no obstacle
		// input — so obstacles can never remove cells from the footprint.
		// Worked example: from the north-west corner with an obstacle on
		// (0,1), the cell two steps beyond it, (0,2), is still perceived
		// as a room cell, not a wall.
		const cells = projectVista({ row: 0, col: 0 });
		const beyondObstacle = cells.find(
			(c) => c.position.row === 0 && c.position.col === 2,
		);
		expect(beyondObstacle).toBeDefined();
		expect(beyondObstacle?.isWall).toBe(false);
		expect(beyondObstacle?.isOwnCell).toBe(false);
	});
});

describe("VistaOffset.steps — position-plus-distance descriptions", () => {
	// Compose an offset's axis steps back into (dx, dy) using the engine's
	// own direction table, so the test never re-derives steps by the same
	// code path as the implementation.
	const composeSteps = (
		o: (typeof VISTA_OFFSETS)[number],
	): [number, number] => {
		let dx = 0;
		let dy = 0;
		for (const step of o.steps) {
			// The ADR's dy axis is north-positive; the engine's drow is
			// north-negative, so compose dy through the negated row delta.
			const d = directionDelta(step.direction);
			dx += d.dcol * step.distance;
			dy += -d.drow * step.distance;
		}
		return [dx, dy];
	};

	const offset = (dx: number, dy: number) => {
		const found = VISTA_OFFSETS.find((o) => o.dx === dx && o.dy === dy);
		if (!found) throw new Error(`No Vista offset at (${dx}, ${dy})`);
		return found;
	};

	it("the own cell has no steps", () => {
		expect(offset(0, 0).steps).toEqual([]);
	});

	it("matches the ADR example: (1,1) is one step north and one step east", () => {
		expect(offset(1, 1).steps).toEqual([
			{ direction: "north", distance: 1 },
			{ direction: "east", distance: 1 },
		]);
	});

	it("gives each pure-cardinal distance-2 offset a single two-step axis", () => {
		expect(offset(0, 2).steps).toEqual([{ direction: "north", distance: 2 }]);
		expect(offset(0, -2).steps).toEqual([{ direction: "south", distance: 2 }]);
		expect(offset(2, 0).steps).toEqual([{ direction: "east", distance: 2 }]);
		expect(offset(-2, 0).steps).toEqual([{ direction: "west", distance: 2 }]);
	});

	it("composes back to the original offset for every Vista cell", () => {
		for (const o of VISTA_OFFSETS) {
			expect(composeSteps(o)).toEqual([o.dx, o.dy]);
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
