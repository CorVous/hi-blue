import { describe, expect, it } from "vitest";
import {
	applyDirection,
	areAdjacent4,
	CARDINAL_DIRECTIONS,
	cardinalToRelative,
	directionDelta,
	inBounds,
	manhattan,
	RELATIVE_DIRECTIONS,
	relativeToCardinal,
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

// ── relativeToCardinal — 16 cases (4 facings × 4 relatives) ──────────────────

describe("relativeToCardinal", () => {
	// facing north
	it("north + forward → north", () =>
		expect(relativeToCardinal("north", "forward")).toBe("north"));
	it("north + back → south", () =>
		expect(relativeToCardinal("north", "back")).toBe("south"));
	it("north + left → west", () =>
		expect(relativeToCardinal("north", "left")).toBe("west"));
	it("north + right → east", () =>
		expect(relativeToCardinal("north", "right")).toBe("east"));

	// facing south
	it("south + forward → south", () =>
		expect(relativeToCardinal("south", "forward")).toBe("south"));
	it("south + back → north", () =>
		expect(relativeToCardinal("south", "back")).toBe("north"));
	it("south + left → east", () =>
		expect(relativeToCardinal("south", "left")).toBe("east"));
	it("south + right → west", () =>
		expect(relativeToCardinal("south", "right")).toBe("west"));

	// facing east
	it("east + forward → east", () =>
		expect(relativeToCardinal("east", "forward")).toBe("east"));
	it("east + back → west", () =>
		expect(relativeToCardinal("east", "back")).toBe("west"));
	it("east + left → north", () =>
		expect(relativeToCardinal("east", "left")).toBe("north"));
	it("east + right → south", () =>
		expect(relativeToCardinal("east", "right")).toBe("south"));

	// facing west
	it("west + forward → west", () =>
		expect(relativeToCardinal("west", "forward")).toBe("west"));
	it("west + back → east", () =>
		expect(relativeToCardinal("west", "back")).toBe("east"));
	it("west + left → south", () =>
		expect(relativeToCardinal("west", "left")).toBe("south"));
	it("west + right → north", () =>
		expect(relativeToCardinal("west", "right")).toBe("north"));
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

// ── Round-trip ────────────────────────────────────────────────────────────────

describe("relativeToCardinal / cardinalToRelative round-trip", () => {
	it("cardinalToRelative(facing, relativeToCardinal(facing, rel)) === rel for all combinations", () => {
		for (const facing of CARDINAL_DIRECTIONS) {
			for (const rel of RELATIVE_DIRECTIONS) {
				const cardinal = relativeToCardinal(facing, rel);
				const back = cardinalToRelative(facing, cardinal);
				expect(back, `facing=${facing} rel=${rel}`).toBe(rel);
			}
		}
	});

	it("relativeToCardinal(facing, cardinalToRelative(facing, abs)) === abs for all combinations", () => {
		for (const facing of CARDINAL_DIRECTIONS) {
			for (const abs of CARDINAL_DIRECTIONS) {
				const rel = cardinalToRelative(facing, abs);
				const back = relativeToCardinal(facing, rel);
				expect(back, `facing=${facing} abs=${abs}`).toBe(abs);
			}
		}
	});
});
