import { describe, expect, it } from "vitest";
import type { CardinalDirection } from "../direction";
import {
	applyDirection,
	areAdjacent4,
	CARDINAL_DIRECTIONS,
	COMPASS_ORDER,
	cardinalToRelative,
	directionDelta,
	inBounds,
	manhattan,
	RELATIVE_DIRECTIONS,
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
	/** The direction `quarters` quarter-turns clockwise from `facing`. */
	function rotated(
		facing: CardinalDirection,
		quarters: number,
	): CardinalDirection {
		const index = COMPASS_ORDER.indexOf(facing);
		const turned = COMPASS_ORDER[(index + quarters) % COMPASS_ORDER.length];
		if (!turned) throw new Error(`COMPASS_ORDER does not contain ${facing}`);
		return turned;
	}

	it("is north, east, south, west (clockwise)", () => {
		expect(COMPASS_ORDER).toEqual(["north", "east", "south", "west"]);
	});

	it("is the rotation cardinalToRelative agrees with", () => {
		for (const facing of COMPASS_ORDER) {
			const right = rotated(facing, 1);
			const back = rotated(facing, 2);
			const left = rotated(facing, 3);
			expect(cardinalToRelative(facing, right)).toBe("right");
			expect(cardinalToRelative(facing, back)).toBe("back");
			expect(cardinalToRelative(facing, left)).toBe("left");
		}
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

// ── Relative direction constants ──────────────────────────────────────────────

describe("RELATIVE_DIRECTIONS", () => {
	it("has exactly 4 values: forward, back, left, right", () => {
		expect(RELATIVE_DIRECTIONS).toHaveLength(4);
		expect(RELATIVE_DIRECTIONS).toContain("forward");
		expect(RELATIVE_DIRECTIONS).toContain("back");
		expect(RELATIVE_DIRECTIONS).toContain("left");
		expect(RELATIVE_DIRECTIONS).toContain("right");
	});
});

// ── cardinalToRelative — 16 cases (4 facings × 4 absolutes) ──────────────────

describe("cardinalToRelative", () => {
	// facing north
	it("north → north: forward", () =>
		expect(cardinalToRelative("north", "north")).toBe("forward"));
	it("north → south: back", () =>
		expect(cardinalToRelative("north", "south")).toBe("back"));
	it("north → west: left", () =>
		expect(cardinalToRelative("north", "west")).toBe("left"));
	it("north → east: right", () =>
		expect(cardinalToRelative("north", "east")).toBe("right"));

	// facing south
	it("south → south: forward", () =>
		expect(cardinalToRelative("south", "south")).toBe("forward"));
	it("south → north: back", () =>
		expect(cardinalToRelative("south", "north")).toBe("back"));
	it("south → east: left", () =>
		expect(cardinalToRelative("south", "east")).toBe("left"));
	it("south → west: right", () =>
		expect(cardinalToRelative("south", "west")).toBe("right"));

	// facing east
	it("east → east: forward", () =>
		expect(cardinalToRelative("east", "east")).toBe("forward"));
	it("east → west: back", () =>
		expect(cardinalToRelative("east", "west")).toBe("back"));
	it("east → north: left", () =>
		expect(cardinalToRelative("east", "north")).toBe("left"));
	it("east → south: right", () =>
		expect(cardinalToRelative("east", "south")).toBe("right"));

	// facing west
	it("west → west: forward", () =>
		expect(cardinalToRelative("west", "west")).toBe("forward"));
	it("west → east: back", () =>
		expect(cardinalToRelative("west", "east")).toBe("back"));
	it("west → south: left", () =>
		expect(cardinalToRelative("west", "south")).toBe("left"));
	it("west → north: right", () =>
		expect(cardinalToRelative("west", "north")).toBe("right"));
});

// ── cardinalToRelative is a bijection per facing ─────────────────────────────

describe("cardinalToRelative — bijection per facing", () => {
	it("maps the four cardinals onto the four relatives exactly once for each facing", () => {
		for (const facing of CARDINAL_DIRECTIONS) {
			const relatives = CARDINAL_DIRECTIONS.map((abs) =>
				cardinalToRelative(facing, abs),
			);
			expect([...relatives].sort(), `facing=${facing}`).toEqual(
				[...RELATIVE_DIRECTIONS].sort(),
			);
		}
	});
});
