import { describe, expect, it } from "vitest";
import {
	applyDirection,
	CARDINAL_DIRECTIONS,
	COMPASS_ORDER,
	inBounds,
	positionsEqual,
} from "../direction";

describe("constants", () => {
	it("CARDINAL_DIRECTIONS has exactly 4 values", () => {
		expect(CARDINAL_DIRECTIONS).toHaveLength(4);
		expect(CARDINAL_DIRECTIONS).toContain("north");
		expect(CARDINAL_DIRECTIONS).toContain("south");
		expect(CARDINAL_DIRECTIONS).toContain("east");
		expect(CARDINAL_DIRECTIONS).toContain("west");
	});
});

describe("COMPASS_ORDER — the shared compass rotation", () => {
	it("is north, east, south, west (clockwise)", () => {
		expect(COMPASS_ORDER).toEqual(["north", "east", "south", "west"]);
	});

	it("contains every cardinal exactly once", () => {
		expect([...COMPASS_ORDER].sort()).toEqual([...CARDINAL_DIRECTIONS].sort());
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

describe("positionsEqual", () => {
	it("same cell → true", () => {
		expect(positionsEqual({ row: 2, col: 2 }, { row: 2, col: 2 })).toBe(true);
	});

	it("different cell → false", () => {
		expect(positionsEqual({ row: 2, col: 2 }, { row: 2, col: 3 })).toBe(false);
	});
});
