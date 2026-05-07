import { describe, expect, it } from "vitest";
import { projectCone } from "../cone-projector";

describe("projectCone — facing north from (2,2)", () => {
	it("returns exactly 5 cells", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		expect(cells).toHaveLength(5);
	});

	it("first cell is own cell (2,2) with phrasing 'your cell'", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		expect(cells[0]?.position).toEqual({ row: 2, col: 2 });
		expect(cells[0]?.phrasing).toBe("your cell");
		expect(cells[0]?.isOwnCell).toBe(true);
	});

	it("second cell is directly in front (1,2)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		expect(cells[1]?.position).toEqual({ row: 1, col: 2 });
		expect(cells[1]?.phrasing).toBe("directly in front");
	});

	it("third cell is two steps ahead, front-left (0,1)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		expect(cells[2]?.position).toEqual({ row: 0, col: 1 });
		expect(cells[2]?.phrasing).toBe("two steps ahead, front-left");
	});

	it("fourth cell is two steps ahead (0,2)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		expect(cells[3]?.position).toEqual({ row: 0, col: 2 });
		expect(cells[3]?.phrasing).toBe("two steps ahead");
	});

	it("fifth cell is two steps ahead, front-right (0,3)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		expect(cells[4]?.position).toEqual({ row: 0, col: 3 });
		expect(cells[4]?.phrasing).toBe("two steps ahead, front-right");
	});
});

describe("projectCone — facing south from (2,2)", () => {
	it("returns exactly 5 cells", () => {
		const cells = projectCone({ row: 2, col: 2 }, "south");
		expect(cells).toHaveLength(5);
	});

	it("own cell is (2,2)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "south");
		expect(cells[0]?.position).toEqual({ row: 2, col: 2 });
		expect(cells[0]?.phrasing).toBe("your cell");
	});

	it("directly in front is (3,2)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "south");
		expect(cells[1]?.position).toEqual({ row: 3, col: 2 });
		expect(cells[1]?.phrasing).toBe("directly in front");
	});

	it("two steps ahead, front-left is (4,3)", () => {
		// south facing: left is east (+col), so front-left = (row+2, col+1)
		const cells = projectCone({ row: 2, col: 2 }, "south");
		expect(cells[2]?.position).toEqual({ row: 4, col: 3 });
		expect(cells[2]?.phrasing).toBe("two steps ahead, front-left");
	});

	it("two steps ahead is (4,2)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "south");
		expect(cells[3]?.position).toEqual({ row: 4, col: 2 });
		expect(cells[3]?.phrasing).toBe("two steps ahead");
	});

	it("two steps ahead, front-right is (4,1)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "south");
		expect(cells[4]?.position).toEqual({ row: 4, col: 1 });
		expect(cells[4]?.phrasing).toBe("two steps ahead, front-right");
	});
});

describe("projectCone — facing east from (2,2)", () => {
	it("returns exactly 5 cells", () => {
		const cells = projectCone({ row: 2, col: 2 }, "east");
		expect(cells).toHaveLength(5);
	});

	it("directly in front is (2,3)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "east");
		expect(cells[1]?.position).toEqual({ row: 2, col: 3 });
	});

	it("two steps ahead, front-left is (1,4)", () => {
		// east facing: left is north (drow -1), so (row-1, col+2)
		const cells = projectCone({ row: 2, col: 2 }, "east");
		expect(cells[2]?.position).toEqual({ row: 1, col: 4 });
		expect(cells[2]?.phrasing).toBe("two steps ahead, front-left");
	});

	it("two steps ahead is (2,4)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "east");
		expect(cells[3]?.position).toEqual({ row: 2, col: 4 });
	});

	it("two steps ahead, front-right is (3,4)", () => {
		// east facing: right is south (drow +1), so (row+1, col+2)
		const cells = projectCone({ row: 2, col: 2 }, "east");
		expect(cells[4]?.position).toEqual({ row: 3, col: 4 });
		expect(cells[4]?.phrasing).toBe("two steps ahead, front-right");
	});
});

describe("projectCone — facing west from (2,2)", () => {
	it("returns exactly 5 cells", () => {
		const cells = projectCone({ row: 2, col: 2 }, "west");
		expect(cells).toHaveLength(5);
	});

	it("directly in front is (2,1)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "west");
		expect(cells[1]?.position).toEqual({ row: 2, col: 1 });
	});

	it("two steps ahead, front-left is (3,0)", () => {
		// west facing: left is south (drow +1), so (row+1, col-2)
		const cells = projectCone({ row: 2, col: 2 }, "west");
		expect(cells[2]?.position).toEqual({ row: 3, col: 0 });
		expect(cells[2]?.phrasing).toBe("two steps ahead, front-left");
	});

	it("two steps ahead is (2,0)", () => {
		const cells = projectCone({ row: 2, col: 2 }, "west");
		expect(cells[3]?.position).toEqual({ row: 2, col: 0 });
	});

	it("two steps ahead, front-right is (1,0)", () => {
		// west facing: right is north (drow -1), so (row-1, col-2)
		const cells = projectCone({ row: 2, col: 2 }, "west");
		expect(cells[4]?.position).toEqual({ row: 1, col: 0 });
		expect(cells[4]?.phrasing).toBe("two steps ahead, front-right");
	});
});

describe("projectCone — edge cases: out-of-bounds filtering", () => {
	it("facing north from (0,0) returns only own cell (all cone cells OOB)", () => {
		const cells = projectCone({ row: 0, col: 0 }, "north");
		// Own cell is always included; (−1,0), (−2,−1), (−2,0), (−2,1) are all OOB
		expect(cells).toHaveLength(1);
		expect(cells[0]?.phrasing).toBe("your cell");
		expect(cells[0]?.position).toEqual({ row: 0, col: 0 });
	});

	it("facing north from (1,0) returns own cell and directly in front only", () => {
		// Front = (0,0) — in bounds
		// Two ahead = (−1, ...) — all OOB
		const cells = projectCone({ row: 1, col: 0 }, "north");
		expect(cells).toHaveLength(2);
		expect(cells[0]?.phrasing).toBe("your cell");
		expect(cells[1]?.phrasing).toBe("directly in front");
		expect(cells[1]?.position).toEqual({ row: 0, col: 0 });
	});

	it("own cell is always first in the returned array", () => {
		const cells = projectCone({ row: 3, col: 3 }, "south");
		expect(cells[0]?.isOwnCell).toBe(true);
	});

	it("phrasing strings match documented vocabulary verbatim", () => {
		const cells = projectCone({ row: 2, col: 2 }, "north");
		const phrasings = cells.map((c) => c.phrasing);
		expect(phrasings).toContain("your cell");
		expect(phrasings).toContain("directly in front");
		expect(phrasings).toContain("two steps ahead, front-left");
		expect(phrasings).toContain("two steps ahead");
		expect(phrasings).toContain("two steps ahead, front-right");
	});
});
