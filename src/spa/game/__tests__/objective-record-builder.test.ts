/**
 * Tests for objective-record-builder.ts
 */
import { describe, expect, it } from "vitest";
import { buildObjectiveRecords } from "../objective-record-builder.js";
import type { ContentPack } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePack(overrides?: Partial<ContentPack>): ContentPack {
	return {
		setting: "test setting",
		weather: "clear",
		timeOfDay: "noon",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: {
			north: { shortName: "tower", horizonPhrase: "rusted tower" },
			south: { shortName: "spire", horizonPhrase: "glowing spire" },
			east: { shortName: "cliff", horizonPhrase: "jagged cliff" },
			west: { shortName: "ruin", horizonPhrase: "crumbling ruin" },
		},
		wallName: "test wall",
		aiStarts: {},
		...overrides,
	};
}

function makeCarryPair(i: number) {
	return {
		object: {
			id: `carry-${i}-obj`,
			kind: "objective_object" as const,
			name: `carry object ${i}`,
			examineDescription: "An object.",
			holder: { row: 0, col: 0 },
		},
		space: {
			id: `carry-${i}-space`,
			kind: "objective_space" as const,
			name: `carry space ${i}`,
			examineDescription: "A space.",
			holder: { row: 1, col: 0 },
		},
	};
}

function makeUseSpacePair(i: number) {
	return {
		object: {
			id: `useSpace-${i}-obj-dummy`,
			kind: "objective_object" as const,
			name: "dummy object",
			examineDescription: "Dummy.",
			holder: { row: 0, col: 0 },
		},
		space: {
			id: `useSpace-${i}-space`,
			kind: "objective_space" as const,
			name: `use space ${i}`,
			examineDescription: "A space to use.",
			holder: { row: 1, col: 1 },
		},
	};
}

function makeConvergencePair(i: number) {
	return {
		object: {
			id: `convergence-${i}-obj-dummy`,
			kind: "objective_object" as const,
			name: "dummy object",
			examineDescription: "Dummy.",
			holder: { row: 0, col: 0 },
		},
		space: {
			id: `convergence-${i}-space`,
			kind: "objective_space" as const,
			name: `convergence space ${i}`,
			examineDescription: "A convergence point.",
			holder: { row: 2, col: 2 },
		},
	};
}

function makeUseItem(i: number) {
	return {
		id: `useItem-${i}-item`,
		kind: "interesting_object" as const,
		name: `use item ${i}`,
		examineDescription: "An item to use.",
		holder: { row: 3, col: 3 },
	};
}

// ── Per-type tests ────────────────────────────────────────────────────────────

describe("buildObjectiveRecords — carry type", () => {
	it("returns a CarryObjective with correct shape", () => {
		const pack = makePack({
			objectivePairs: [makeCarryPair(0)],
		});
		const objectives = buildObjectiveRecords(["carry"], pack);
		expect(objectives).toHaveLength(1);
		const obj = objectives[0];
		expect(obj?.kind).toBe("carry");
		expect(obj?.id).toBe("obj-0");
		expect(obj?.satisfactionState).toBe("pending");
		if (obj?.kind === "carry") {
			expect(obj.objectId).toBe("carry-0-obj");
			expect(obj.spaceId).toBe("carry-0-space");
			expect(obj.description).toContain("carry object 0");
			expect(obj.description).toContain("carry space 0");
		}
	});

	it("3-carry → 3 CarryObjectives with ids obj-0, obj-1, obj-2", () => {
		const pack = makePack({
			objectivePairs: [makeCarryPair(0), makeCarryPair(1), makeCarryPair(2)],
		});
		const objectives = buildObjectiveRecords(["carry", "carry", "carry"], pack);
		expect(objectives).toHaveLength(3);
		expect(objectives[0]?.id).toBe("obj-0");
		expect(objectives[1]?.id).toBe("obj-1");
		expect(objectives[2]?.id).toBe("obj-2");
		for (const obj of objectives) {
			expect(obj?.kind).toBe("carry");
			expect(obj?.satisfactionState).toBe("pending");
		}
	});
});

describe("buildObjectiveRecords — use_space type", () => {
	it("returns a UseSpaceObjective with correct shape", () => {
		const pack = makePack({
			objectivePairs: [makeUseSpacePair(0)],
		});
		const objectives = buildObjectiveRecords(["use_space"], pack);
		expect(objectives).toHaveLength(1);
		const obj = objectives[0];
		expect(obj?.kind).toBe("use_space");
		expect(obj?.id).toBe("obj-0");
		expect(obj?.satisfactionState).toBe("pending");
		if (obj?.kind === "use_space") {
			expect(obj.spaceId).toBe("useSpace-0-space");
			expect(obj.description).toContain("use space 0");
		}
	});
});

describe("buildObjectiveRecords — use_item type", () => {
	it("returns a UseItemObjective with correct shape", () => {
		const pack = makePack({
			interestingObjects: [makeUseItem(0)],
		});
		const objectives = buildObjectiveRecords(["use_item"], pack);
		expect(objectives).toHaveLength(1);
		const obj = objectives[0];
		expect(obj?.kind).toBe("use_item");
		expect(obj?.id).toBe("obj-0");
		expect(obj?.satisfactionState).toBe("pending");
		if (obj?.kind === "use_item") {
			expect(obj.itemId).toBe("useItem-0-item");
			expect(obj.description).toContain("use item 0");
		}
	});
});

describe("buildObjectiveRecords — convergence type", () => {
	it("returns a ConvergenceObjective with correct shape", () => {
		const pack = makePack({
			objectivePairs: [makeConvergencePair(0)],
		});
		const objectives = buildObjectiveRecords(["convergence"], pack);
		expect(objectives).toHaveLength(1);
		const obj = objectives[0];
		expect(obj?.kind).toBe("convergence");
		expect(obj?.id).toBe("obj-0");
		expect(obj?.satisfactionState).toBe("pending");
		if (obj?.kind === "convergence") {
			expect(obj.spaceId).toBe("convergence-0-space");
			expect(obj.description).toContain("convergence space 0");
		}
	});
});

describe("buildObjectiveRecords — all satisfactionState are pending", () => {
	it("all objectives start with satisfactionState: pending", () => {
		const pack = makePack({
			objectivePairs: [
				makeCarryPair(0),
				makeUseSpacePair(1),
				makeConvergencePair(2),
			],
			interestingObjects: [],
		});
		const objectives = buildObjectiveRecords(
			["carry", "use_space", "convergence"],
			pack,
		);
		for (const obj of objectives) {
			expect(obj?.satisfactionState).toBe("pending");
		}
	});
});

describe("buildObjectiveRecords — sequential ids", () => {
	it("assigns ids obj-0, obj-1, obj-2 in order", () => {
		const pack = makePack({
			objectivePairs: [
				makeCarryPair(0),
				makeUseSpacePair(1),
				makeConvergencePair(2),
			],
		});
		const objectives = buildObjectiveRecords(
			["carry", "use_space", "convergence"],
			pack,
		);
		expect(objectives[0]?.id).toBe("obj-0");
		expect(objectives[1]?.id).toBe("obj-1");
		expect(objectives[2]?.id).toBe("obj-2");
	});
});

describe("buildObjectiveRecords — missing entity throws", () => {
	it("throws if carry object not found in pack", () => {
		const pack = makePack({}); // empty objectivePairs
		expect(() => buildObjectiveRecords(["carry"], pack)).toThrow(RangeError);
	});

	it("throws if use_space space not found in pack", () => {
		const pack = makePack({});
		expect(() => buildObjectiveRecords(["use_space"], pack)).toThrow(
			RangeError,
		);
	});

	it("throws if use_item item not found in pack", () => {
		const pack = makePack({});
		expect(() => buildObjectiveRecords(["use_item"], pack)).toThrow(RangeError);
	});

	it("throws if convergence space not found in pack", () => {
		const pack = makePack({});
		expect(() => buildObjectiveRecords(["convergence"], pack)).toThrow(
			RangeError,
		);
	});
});

describe("buildObjectiveRecords — empty types returns empty array", () => {
	it("returns [] for empty types", () => {
		const pack = makePack({});
		const objectives = buildObjectiveRecords([], pack);
		expect(objectives).toEqual([]);
	});
});
