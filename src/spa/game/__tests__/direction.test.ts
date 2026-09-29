import { describe, expect, it } from "vitest";
import type { CardinalDirection, GridPosition } from "../direction";
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
	it.each<[CardinalDirection, GridPosition]>([
		["north", { row: 1, col: 2 }],
		["south", { row: 3, col: 2 }],
		["east", { row: 2, col: 3 }],
		["west", { row: 2, col: 1 }],
	])("moves %s from center", (direction, expected) => {
		expect(applyDirection({ row: 2, col: 2 }, direction)).toEqual(expected);
	});

	it("can produce out-of-bounds positions (caller must check)", () => {
		const result = applyDirection({ row: 0, col: 0 }, "north");
		expect(result.row).toBe(-1);
		expect(inBounds(result)).toBe(false);
	});
});

describe("inBounds", () => {
	it.each<[string, GridPosition, boolean]>([
		["center cell (2,2)", { row: 2, col: 2 }, true],
		["top-left corner (0,0)", { row: 0, col: 0 }, true],
		["bottom-right corner (4,4)", { row: 4, col: 4 }, true],
		["row -1", { row: -1, col: 0 }, false],
		["row 5", { row: 5, col: 0 }, false],
		["col -1", { row: 0, col: -1 }, false],
		["col 5", { row: 0, col: 5 }, false],
	])("%s → in bounds: %s", (_label, position, expected) => {
		expect(inBounds(position)).toBe(expected);
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
