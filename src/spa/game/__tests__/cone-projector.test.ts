import { describe, expect, it } from "vitest";
import { projectCone } from "../cone-projector";

describe("projectCone — facing north from (2,2)", () => {
	it("returns exactly 9 cells", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		expect(cells).toHaveLength(9);
	});

	it("first cell is own cell (2,2) with phrasing 'your cell'", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		expect(cells[0]?.position).toEqual({ row: 2, col: 2 });
		expect(cells[0]?.phrasing).toBe("your cell");
		expect(cells[0]?.isOwnCell).toBe(true);
	});

	it("distance-1 front arc: left (1,1), center (1,2), right (1,3)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		expect(cells[1]?.position).toEqual({ row: 1, col: 1 });
		expect(cells[1]?.phrasing).toBe("directly in front, left");
		expect(cells[2]?.position).toEqual({ row: 1, col: 2 });
		expect(cells[2]?.phrasing).toBe("directly in front");
		expect(cells[3]?.position).toEqual({ row: 1, col: 3 });
		expect(cells[3]?.phrasing).toBe("directly in front, right");
	});

	it("distance-2 fan: far-left (0,0) through far-right (0,4)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		expect(cells[4]?.position).toEqual({ row: 0, col: 0 });
		expect(cells[4]?.phrasing).toBe("two steps ahead, far-left");
		expect(cells[5]?.position).toEqual({ row: 0, col: 1 });
		expect(cells[5]?.phrasing).toBe("two steps ahead, front-left");
		expect(cells[6]?.position).toEqual({ row: 0, col: 2 });
		expect(cells[6]?.phrasing).toBe("two steps ahead");
		expect(cells[7]?.position).toEqual({ row: 0, col: 3 });
		expect(cells[7]?.phrasing).toBe("two steps ahead, front-right");
		expect(cells[8]?.position).toEqual({ row: 0, col: 4 });
		expect(cells[8]?.phrasing).toBe("two steps ahead, far-right");
	});
});

describe("projectCone — facing south from (2,2)", () => {
	it("returns exactly 9 cells", () => {
		const cells = projectCone({ row: 2, col: 2 }, "south");
		expect(cells).toHaveLength(9);
	});

	it("own cell is (2,2)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "south");
		expect(cells[0]?.position).toEqual({ row: 2, col: 2 });
		expect(cells[0]?.phrasing).toBe("your cell");
	});

	it("distance-1 front arc: left (3,3), center (3,2), right (3,1)", () => {
		// south facing: left is east (+col)
		const cells = projectCone({ row: 2, col: 2 }, "south");
		expect(cells[1]?.position).toEqual({ row: 3, col: 3 });
		expect(cells[1]?.phrasing).toBe("directly in front, left");
		expect(cells[2]?.position).toEqual({ row: 3, col: 2 });
		expect(cells[2]?.phrasing).toBe("directly in front");
		expect(cells[3]?.position).toEqual({ row: 3, col: 1 });
		expect(cells[3]?.phrasing).toBe("directly in front, right");
	});

	it("distance-2 fan: far-left (4,4) through far-right (4,0)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "south");
		expect(cells[4]?.position).toEqual({ row: 4, col: 4 });
		expect(cells[4]?.phrasing).toBe("two steps ahead, far-left");
		expect(cells[5]?.position).toEqual({ row: 4, col: 3 });
		expect(cells[5]?.phrasing).toBe("two steps ahead, front-left");
		expect(cells[6]?.position).toEqual({ row: 4, col: 2 });
		expect(cells[6]?.phrasing).toBe("two steps ahead");
		expect(cells[7]?.position).toEqual({ row: 4, col: 1 });
		expect(cells[7]?.phrasing).toBe("two steps ahead, front-right");
		expect(cells[8]?.position).toEqual({ row: 4, col: 0 });
		expect(cells[8]?.phrasing).toBe("two steps ahead, far-right");
	});
});

describe("projectCone — facing east from (2,2)", () => {
	it("returns exactly 9 cells", () => {
		const cells = projectCone({ row: 2, col: 2 }, "east");
		expect(cells).toHaveLength(9);
	});

	it("distance-1 front arc: left (1,3), center (2,3), right (3,3)", () => {
		// east facing: left is north (drow -1)
		const cells = projectCone({ row: 2, col: 2 }, "east");
		expect(cells[1]?.position).toEqual({ row: 1, col: 3 });
		expect(cells[1]?.phrasing).toBe("directly in front, left");
		expect(cells[2]?.position).toEqual({ row: 2, col: 3 });
		expect(cells[2]?.phrasing).toBe("directly in front");
		expect(cells[3]?.position).toEqual({ row: 3, col: 3 });
		expect(cells[3]?.phrasing).toBe("directly in front, right");
	});

	it("distance-2 fan: far-left (0,4) through far-right (4,4)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "east");
		expect(cells[4]?.position).toEqual({ row: 0, col: 4 });
		expect(cells[4]?.phrasing).toBe("two steps ahead, far-left");
		expect(cells[5]?.position).toEqual({ row: 1, col: 4 });
		expect(cells[5]?.phrasing).toBe("two steps ahead, front-left");
		expect(cells[6]?.position).toEqual({ row: 2, col: 4 });
		expect(cells[6]?.phrasing).toBe("two steps ahead");
		expect(cells[7]?.position).toEqual({ row: 3, col: 4 });
		expect(cells[7]?.phrasing).toBe("two steps ahead, front-right");
		expect(cells[8]?.position).toEqual({ row: 4, col: 4 });
		expect(cells[8]?.phrasing).toBe("two steps ahead, far-right");
	});
});

describe("projectCone — facing west from (2,2)", () => {
	it("returns exactly 9 cells", () => {
		const cells = projectCone({ row: 2, col: 2 }, "west");
		expect(cells).toHaveLength(9);
	});

	it("distance-1 front arc: left (3,1), center (2,1), right (1,1)", () => {
		// west facing: left is south (drow +1)
		const cells = projectCone({ row: 2, col: 2 }, "west");
		expect(cells[1]?.position).toEqual({ row: 3, col: 1 });
		expect(cells[1]?.phrasing).toBe("directly in front, left");
		expect(cells[2]?.position).toEqual({ row: 2, col: 1 });
		expect(cells[2]?.phrasing).toBe("directly in front");
		expect(cells[3]?.position).toEqual({ row: 1, col: 1 });
		expect(cells[3]?.phrasing).toBe("directly in front, right");
	});

	it("distance-2 fan: far-left (4,0) through far-right (0,0)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "west");
		expect(cells[4]?.position).toEqual({ row: 4, col: 0 });
		expect(cells[4]?.phrasing).toBe("two steps ahead, far-left");
		expect(cells[5]?.position).toEqual({ row: 3, col: 0 });
		expect(cells[5]?.phrasing).toBe("two steps ahead, front-left");
		expect(cells[6]?.position).toEqual({ row: 2, col: 0 });
		expect(cells[6]?.phrasing).toBe("two steps ahead");
		expect(cells[7]?.position).toEqual({ row: 1, col: 0 });
		expect(cells[7]?.phrasing).toBe("two steps ahead, front-right");
		expect(cells[8]?.position).toEqual({ row: 0, col: 0 });
		expect(cells[8]?.phrasing).toBe("two steps ahead, far-right");
	});
});

describe("projectCone — edge cases: out-of-bounds filtering", () => {
	it("facing north from (0,0) returns only own cell (all cone cells OOB)", () => {
		const cells = projectCone({ row: 0, col: 0 }, "north");
		// Own cell is always included; all distance-1 and distance-2 cells are OOB
		expect(cells).toHaveLength(1);
		expect(cells[0]?.phrasing).toBe("your cell");
		expect(cells[0]?.position).toEqual({ row: 0, col: 0 });
	});

	it("facing north from (1,0) returns own cell plus the two in-bounds front-arc cells", () => {
		// front-left (0,-1) OOB; front (0,0) in; front-right (0,1) in; all dist-2 OOB
		const cells = projectCone({ row: 1, col: 0 }, "north");
		expect(cells).toHaveLength(3);
		expect(cells[0]?.phrasing).toBe("your cell");
		expect(cells[1]?.phrasing).toBe("directly in front");
		expect(cells[1]?.position).toEqual({ row: 0, col: 0 });
		expect(cells[2]?.phrasing).toBe("directly in front, right");
		expect(cells[2]?.position).toEqual({ row: 0, col: 1 });
	});

	it("own cell is always first in the returned array", () => {
		const cells = projectCone({ row: 3, col: 3 }, "south");
		expect(cells[0]?.isOwnCell).toBe(true);
	});

	it("phrasing strings match documented vocabulary verbatim", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		const phrasings = cells.map((c) => c.phrasing);
		expect(phrasings).toContain("your cell");
		expect(phrasings).toContain("directly in front, left");
		expect(phrasings).toContain("directly in front");
		expect(phrasings).toContain("directly in front, right");
		expect(phrasings).toContain("two steps ahead, far-left");
		expect(phrasings).toContain("two steps ahead, front-left");
		expect(phrasings).toContain("two steps ahead");
		expect(phrasings).toContain("two steps ahead, front-right");
		expect(phrasings).toContain("two steps ahead, far-right");
	});
});
