/**
 * Unit tests for pack-selectors.ts
 *
 * Covers: empty pack, each bucket-only configuration, mixed packs,
 * the pairsWithSpaceId-vs-not discriminator for boundSpaces, and
 * order-stability for every selector.
 */
import { describe, expect, it } from "vitest";
import {
	boundSpaces,
	carryPairs,
	interestingObjects,
	objectiveSpaces,
	obstacles,
} from "../pack-selectors.js";
import type { ContentPack, ObjectivePair, WorldEntity } from "../types.js";

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makePack(overrides?: Partial<ContentPack>): ContentPack {
	return {
		setting: "test",
		weather: "clear",
		timeOfDay: "noon",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: {
			north: { shortName: "tower", horizonPhrase: "a rusted tower" },
			south: { shortName: "spire", horizonPhrase: "a glowing spire" },
			east: { shortName: "cliff", horizonPhrase: "a jagged cliff" },
			west: { shortName: "ruin", horizonPhrase: "a crumbling ruin" },
		},
		wallName: "test wall",
		aiStarts: {},
		...overrides,
	};
}

function makeObjectivePair(
	index: number,
	withPairsWithSpaceId = true,
): ObjectivePair {
	const spaceId = `space-${index}`;
	const objectBase: WorldEntity = {
		id: `obj-${index}`,
		kind: "objective_object",
		name: `object ${index}`,
		examineDescription: "An object.",
		holder: { row: 0, col: index },
	};
	if (withPairsWithSpaceId) {
		objectBase.pairsWithSpaceId = spaceId;
	}
	return {
		object: objectBase,
		space: {
			id: spaceId,
			kind: "objective_space",
			name: `space ${index}`,
			examineDescription: "A space.",
			holder: { row: 1, col: index },
		},
	};
}

function makeInterestingObject(index: number): WorldEntity {
	return {
		id: `interesting-${index}`,
		kind: "interesting_object",
		name: `interesting ${index}`,
		examineDescription: "Interesting.",
		holder: { row: 2, col: index },
	};
}

function makeBoundSpace(index: number): WorldEntity {
	return {
		id: `bound-space-${index}`,
		kind: "objective_space",
		name: `bound space ${index}`,
		examineDescription: "A bound space.",
		holder: { row: 3, col: index },
	};
}

function makeObstacle(index: number): WorldEntity {
	return {
		id: `obstacle-${index}`,
		kind: "obstacle",
		name: `obstacle ${index}`,
		examineDescription: "An obstacle.",
		holder: { row: 4, col: index },
	};
}

// ── carryPairs ────────────────────────────────────────────────────────────────

describe("carryPairs", () => {
	it("returns empty array for an empty pack", () => {
		expect(carryPairs(makePack())).toEqual([]);
	});

	it("returns a copy of objectivePairs", () => {
		const pair0 = makeObjectivePair(0);
		const pair1 = makeObjectivePair(1);
		const pack = makePack({ objectivePairs: [pair0, pair1] });
		const result = carryPairs(pack);
		expect(result).toHaveLength(2);
		expect(result[0]).toBe(pair0);
		expect(result[1]).toBe(pair1);
	});

	it("does not mutate the original pack", () => {
		const pair0 = makeObjectivePair(0);
		const pack = makePack({ objectivePairs: [pair0] });
		const result = carryPairs(pack);
		result.push(makeObjectivePair(99));
		expect(pack.objectivePairs).toHaveLength(1);
	});

	it("preserves insertion order for 3 pairs", () => {
		const pairs = [
			makeObjectivePair(0),
			makeObjectivePair(1),
			makeObjectivePair(2),
		];
		const pack = makePack({ objectivePairs: pairs });
		const result = carryPairs(pack);
		expect(result.map((p) => p.object.id)).toEqual(["obj-0", "obj-1", "obj-2"]);
	});
});

// ── interestingObjects ────────────────────────────────────────────────────────

describe("interestingObjects", () => {
	it("returns empty array for an empty pack", () => {
		expect(interestingObjects(makePack())).toEqual([]);
	});

	it("returns interesting objects in insertion order", () => {
		const io0 = makeInterestingObject(0);
		const io1 = makeInterestingObject(1);
		const pack = makePack({ interestingObjects: [io0, io1] });
		const result = interestingObjects(pack);
		expect(result).toHaveLength(2);
		expect(result[0]).toBe(io0);
		expect(result[1]).toBe(io1);
	});

	it("does not mutate the original pack", () => {
		const io0 = makeInterestingObject(0);
		const pack = makePack({ interestingObjects: [io0] });
		const result = interestingObjects(pack);
		result.push(makeInterestingObject(99));
		expect(pack.interestingObjects).toHaveLength(1);
	});

	it("only returns interesting objects (bucket isolation)", () => {
		const pack = makePack({
			objectivePairs: [makeObjectivePair(0)],
			interestingObjects: [makeInterestingObject(0)],
			obstacles: [makeObstacle(0)],
		});
		const result = interestingObjects(pack);
		expect(result).toHaveLength(1);
		expect(result[0]?.kind).toBe("interesting_object");
	});
});

// ── obstacles ────────────────────────────────────────────────────────────────

describe("obstacles", () => {
	it("returns empty array for an empty pack", () => {
		expect(obstacles(makePack())).toEqual([]);
	});

	it("returns obstacles in insertion order", () => {
		const o0 = makeObstacle(0);
		const o1 = makeObstacle(1);
		const o2 = makeObstacle(2);
		const pack = makePack({ obstacles: [o0, o1, o2] });
		const result = obstacles(pack);
		expect(result.map((e) => e.id)).toEqual([
			"obstacle-0",
			"obstacle-1",
			"obstacle-2",
		]);
	});

	it("does not mutate the original pack", () => {
		const o0 = makeObstacle(0);
		const pack = makePack({ obstacles: [o0] });
		const result = obstacles(pack);
		result.push(makeObstacle(99));
		expect(pack.obstacles).toHaveLength(1);
	});

	it("only returns obstacles (bucket isolation)", () => {
		const pack = makePack({
			objectivePairs: [makeObjectivePair(0)],
			interestingObjects: [makeInterestingObject(0)],
			obstacles: [makeObstacle(0)],
		});
		const result = obstacles(pack);
		expect(result).toHaveLength(1);
		expect(result[0]?.kind).toBe("obstacle");
	});
});

// ── boundSpaces ───────────────────────────────────────────────────────────────

describe("boundSpaces", () => {
	it("returns empty array when pack has no boundSpaces field", () => {
		const pack = makePack(); // no boundSpaces key
		expect(boundSpaces(pack)).toEqual([]);
	});

	it("returns empty array when boundSpaces is explicitly empty", () => {
		const pack = makePack({ boundSpaces: [] });
		expect(boundSpaces(pack)).toEqual([]);
	});

	it("returns bound spaces in insertion order when there are no carry pairs", () => {
		const bs0 = makeBoundSpace(0);
		const bs1 = makeBoundSpace(1);
		const pack = makePack({ boundSpaces: [bs0, bs1] });
		const result = boundSpaces(pack);
		expect(result.map((e) => e.id)).toEqual(["bound-space-0", "bound-space-1"]);
	});

	it("does not mutate the original pack", () => {
		const bs0 = makeBoundSpace(0);
		const pack = makePack({ boundSpaces: [bs0] });
		const result = boundSpaces(pack);
		result.push(makeBoundSpace(99));
		expect(pack.boundSpaces).toHaveLength(1);
	});

	it("excludes bound spaces whose id is referenced by a pairsWithSpaceId on an objective_object", () => {
		// Simulate a scenario where a space that IS in boundSpaces is also
		// referenced by pairsWithSpaceId — the discriminator should filter it out.
		const pairedSpaceId = "bound-space-0";
		const pair: ObjectivePair = {
			object: {
				id: "obj-paired",
				kind: "objective_object",
				name: "paired object",
				examineDescription: "Paired.",
				pairsWithSpaceId: pairedSpaceId,
				holder: { row: 0, col: 0 },
			},
			space: {
				id: pairedSpaceId,
				kind: "objective_space",
				name: "paired space",
				examineDescription: "A paired space.",
				holder: { row: 1, col: 0 },
			},
		};
		const genuineBound = makeBoundSpace(1);
		const pack = makePack({
			objectivePairs: [pair],
			// The paired space is also listed in boundSpaces (erroneous but
			// should be excluded by the discriminator).
			boundSpaces: [
				{ ...pair.space }, // same id — should be filtered out
				genuineBound,
			],
		});
		const result = boundSpaces(pack);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("bound-space-1");
	});

	it("includes bound spaces whose id is NOT referenced by any pairsWithSpaceId", () => {
		// A carry pair whose object has pairsWithSpaceId pointing to a different id.
		const pair = makeObjectivePair(0); // pairsWithSpaceId = "space-0"
		const bs0 = makeBoundSpace(0); // id = "bound-space-0" — NOT "space-0"
		const pack = makePack({
			objectivePairs: [pair],
			boundSpaces: [bs0],
		});
		const result = boundSpaces(pack);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("bound-space-0");
	});

	it("handles carry pairs without pairsWithSpaceId gracefully", () => {
		const pair = makeObjectivePair(0, false); // pairsWithSpaceId = undefined
		const bs0 = makeBoundSpace(0);
		const pack = makePack({
			objectivePairs: [pair],
			boundSpaces: [bs0],
		});
		const result = boundSpaces(pack);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("bound-space-0");
	});
});

// ── objectiveSpaces ───────────────────────────────────────────────────────────

describe("objectiveSpaces", () => {
	it("returns empty array for empty pack", () => {
		expect(objectiveSpaces(makePack())).toEqual([]);
	});

	it("returns paired spaces only when there are no bound spaces", () => {
		const pair0 = makeObjectivePair(0);
		const pair1 = makeObjectivePair(1);
		const pack = makePack({ objectivePairs: [pair0, pair1] });
		const result = objectiveSpaces(pack);
		expect(result.map((e) => e.id)).toEqual(["space-0", "space-1"]);
	});

	it("returns bound spaces only when there are no carry pairs", () => {
		const bs0 = makeBoundSpace(0);
		const bs1 = makeBoundSpace(1);
		const pack = makePack({ boundSpaces: [bs0, bs1] });
		const result = objectiveSpaces(pack);
		expect(result.map((e) => e.id)).toEqual(["bound-space-0", "bound-space-1"]);
	});

	it("returns paired spaces before bound spaces in a mixed pack", () => {
		const pair0 = makeObjectivePair(0);
		const pair1 = makeObjectivePair(1);
		const bs0 = makeBoundSpace(0);
		const bs1 = makeBoundSpace(1);
		const pack = makePack({
			objectivePairs: [pair0, pair1],
			boundSpaces: [bs0, bs1],
		});
		const result = objectiveSpaces(pack);
		expect(result.map((e) => e.id)).toEqual([
			"space-0",
			"space-1",
			"bound-space-0",
			"bound-space-1",
		]);
	});

	it("preserves insertion order within each group", () => {
		const pairs = [
			makeObjectivePair(2),
			makeObjectivePair(0),
			makeObjectivePair(1),
		];
		const bound = [makeBoundSpace(5), makeBoundSpace(3)];
		const pack = makePack({ objectivePairs: pairs, boundSpaces: bound });
		const result = objectiveSpaces(pack);
		expect(result.map((e) => e.id)).toEqual([
			"space-2",
			"space-0",
			"space-1",
			"bound-space-5",
			"bound-space-3",
		]);
	});

	it("does not include interesting_objects or obstacles", () => {
		const pack = makePack({
			objectivePairs: [makeObjectivePair(0)],
			interestingObjects: [makeInterestingObject(0)],
			boundSpaces: [makeBoundSpace(0)],
			obstacles: [makeObstacle(0)],
		});
		const result = objectiveSpaces(pack);
		for (const e of result) {
			expect(e.kind).toBe("objective_space");
		}
	});
});

// ── Mixed pack (all buckets populated) ───────────────────────────────────────

describe("all selectors on a fully-populated mixed pack", () => {
	const pair0 = makeObjectivePair(0);
	const pair1 = makeObjectivePair(1);
	const io0 = makeInterestingObject(0);
	const io1 = makeInterestingObject(1);
	const bs0 = makeBoundSpace(0);
	const ob0 = makeObstacle(0);
	const ob1 = makeObstacle(1);

	const pack = makePack({
		objectivePairs: [pair0, pair1],
		interestingObjects: [io0, io1],
		boundSpaces: [bs0],
		obstacles: [ob0, ob1],
	});

	it("carryPairs returns the 2 pairs", () => {
		expect(carryPairs(pack).map((p) => p.object.id)).toEqual([
			"obj-0",
			"obj-1",
		]);
	});

	it("interestingObjects returns the 2 items", () => {
		expect(interestingObjects(pack).map((e) => e.id)).toEqual([
			"interesting-0",
			"interesting-1",
		]);
	});

	it("boundSpaces returns the 1 bound space", () => {
		expect(boundSpaces(pack).map((e) => e.id)).toEqual(["bound-space-0"]);
	});

	it("obstacles returns the 2 obstacles", () => {
		expect(obstacles(pack).map((e) => e.id)).toEqual([
			"obstacle-0",
			"obstacle-1",
		]);
	});

	it("objectiveSpaces returns paired-then-bound", () => {
		expect(objectiveSpaces(pack).map((e) => e.id)).toEqual([
			"space-0",
			"space-1",
			"bound-space-0",
		]);
	});
});
