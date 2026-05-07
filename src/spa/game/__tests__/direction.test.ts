import { describe, expect, it } from "vitest";
import {
	applyDirection,
	areAdjacent4,
	CARDINAL_DIRECTIONS,
	directionDelta,
	GRID_COLS,
	GRID_ROWS,
	inBounds,
	manhattan,
} from "../direction";

describe("constants", () => {
	it("GRID_ROWS and GRID_COLS are 5", () => {
		expect(GRID_ROWS).toBe(5);
		expect(GRID_COLS).toBe(5);
	});

	it("CARDINAL_DIRECTIONS has exactly 4 values", () => {
		expect(CARDINAL_DIRECTIONS).toHaveLength(4);
		expect(CARDINAL_DIRECTIONS).toContain("north");
		expect(CARDINAL_DIRECTIONS).toContain("south");
		expect(CARDINAL_DIRECTIONS).toContain("east");
		expect(CARDINAL_DIRECTIONS).toContain("west");
	});
});

describe("directionDelta", () => {
	it("north moves row -1, col 0", () => {
		expect(directionDelta("north")).toEqual({ drow: -1, dcol: 0 });
	});

	it("south moves row +1, col 0", () => {
		expect(directionDelta("south")).toEqual({ drow: 1, dcol: 0 });
	});

	it("east moves row 0, col +1", () => {
		expect(directionDelta("east")).toEqual({ drow: 0, dcol: 1 });
	});

	it("west moves row 0, col -1", () => {
		expect(directionDelta("west")).toEqual({ drow: 0, dcol: -1 });
	});
});

describe("applyDirection", () => {
	it("moves north from center", () => {
		expect(applyDirection({ row: 2, col: 2 }, "north")).toEqual({
			row: 1,
			col: 2,
		});
	});

	it("moves south from center", () => {
		expect(applyDirection({ row: 2, col: 2 }, "south")).toEqual({
			row: 3,
			col: 2,
		});
	});

	it("moves east from center", () => {
		expect(applyDirection({ row: 2, col: 2 }, "east")).toEqual({
			row: 2,
			col: 3,
		});
	});

	it("moves west from center", () => {
		expect(applyDirection({ row: 2, col: 2 }, "west")).toEqual({
			row: 2,
			col: 1,
		});
	});

	it("can produce out-of-bounds positions (caller must check)", () => {
		// top-left corner, go north → row -1
		const result = applyDirection({ row: 0, col: 0 }, "north");
		expect(result.row).toBe(-1);
		expect(inBounds(result)).toBe(false);
	});
});

describe("inBounds", () => {
	it("center cell (2,2) is in bounds", () => {
		expect(inBounds({ row: 2, col: 2 })).toBe(true);
	});

	it("top-left corner (0,0) is in bounds", () => {
		expect(inBounds({ row: 0, col: 0 })).toBe(true);
	});

	it("bottom-right corner (4,4) is in bounds", () => {
		expect(inBounds({ row: 4, col: 4 })).toBe(true);
	});

	it("row -1 is out of bounds", () => {
		expect(inBounds({ row: -1, col: 0 })).toBe(false);
	});

	it("row 5 is out of bounds", () => {
		expect(inBounds({ row: 5, col: 0 })).toBe(false);
	});

	it("col -1 is out of bounds", () => {
		expect(inBounds({ row: 0, col: -1 })).toBe(false);
	});

	it("col 5 is out of bounds", () => {
		expect(inBounds({ row: 0, col: 5 })).toBe(false);
	});
});

describe("manhattan", () => {
	it("same cell has distance 0", () => {
		expect(manhattan({ row: 2, col: 2 }, { row: 2, col: 2 })).toBe(0);
	});

	it("adjacent cells have distance 1", () => {
		expect(manhattan({ row: 0, col: 0 }, { row: 0, col: 1 })).toBe(1);
		expect(manhattan({ row: 0, col: 0 }, { row: 1, col: 0 })).toBe(1);
	});

	it("diagonal neighbors have distance 2", () => {
		expect(manhattan({ row: 0, col: 0 }, { row: 1, col: 1 })).toBe(2);
	});

	it("opposite corners of 5×5 grid have distance 8", () => {
		expect(manhattan({ row: 0, col: 0 }, { row: 4, col: 4 })).toBe(8);
	});
});

describe("areAdjacent4", () => {
	it("adjacent horizontally → true", () => {
		expect(areAdjacent4({ row: 2, col: 2 }, { row: 2, col: 3 })).toBe(true);
	});

	it("adjacent vertically → true", () => {
		expect(areAdjacent4({ row: 2, col: 2 }, { row: 3, col: 2 })).toBe(true);
	});

	it("same cell → false", () => {
		expect(areAdjacent4({ row: 2, col: 2 }, { row: 2, col: 2 })).toBe(false);
	});

	it("diagonal neighbor → false (distance 2)", () => {
		expect(areAdjacent4({ row: 2, col: 2 }, { row: 3, col: 3 })).toBe(false);
	});

	it("two cells apart → false", () => {
		expect(areAdjacent4({ row: 0, col: 0 }, { row: 0, col: 2 })).toBe(false);
	});
});
