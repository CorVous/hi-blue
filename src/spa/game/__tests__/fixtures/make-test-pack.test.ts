/**
 * Smoke tests for the makeTestPack fixture helper.
 *
 * Covers: type validity, bucket-split by kind + pairing, override merging,
 * insertion order, error cases, no entity dropped or duplicated.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../../direction.js";
import {
	boundSpaces,
	carryPairs,
	interestingObjects,
	obstacles,
} from "../../pack-selectors.js";
import type { WorldEntity } from "../../types.js";
import { makeTestPack } from "./make-test-pack.js";

function interestingObject(id: string): WorldEntity {
	return {
		id,
		kind: "interesting_object",
		name: id,
		examineDescription: id,
		holder: { row: 0, col: 0 },
	};
}

function obstacle(id: string): WorldEntity {
	return {
		id,
		kind: "obstacle",
		name: id,
		examineDescription: id,
		holder: { row: 0, col: 0 },
	};
}

function objectiveObject(id: string, pairsWithSpaceId: string): WorldEntity {
	return {
		id,
		kind: "objective_object",
		name: id,
		examineDescription: id,
		holder: { row: 0, col: 0 },
		pairsWithSpaceId,
	};
}

function objectiveSpace(id: string): WorldEntity {
	return {
		id,
		kind: "objective_space",
		name: id,
		examineDescription: id,
		holder: { row: 0, col: 0 },
	};
}

describe("makeTestPack", () => {
	it("produces a valid empty pack with sensible defaults when entities is empty", () => {
		const pack = makeTestPack([]);
		expect(pack.setting).toBe("");
		expect(pack.weather).toBe("");
		expect(pack.timeOfDay).toBe("");
		expect(pack.wallName).toBe("");
		expect(pack.aiStarts).toEqual({});
		expect(pack.landmarks).toEqual(DEFAULT_LANDMARKS);
		expect(pack.objectivePairs).toEqual([]);
		expect(pack.interestingObjects).toEqual([]);
		expect(pack.boundSpaces).toEqual([]);
		expect(pack.obstacles).toEqual([]);
	});

	it("buckets interesting_object into interestingObjects", () => {
		const a = interestingObject("a");
		const b = interestingObject("b");
		const pack = makeTestPack([a, b]);
		expect(interestingObjects(pack)).toEqual([a, b]);
		expect(pack.obstacles).toEqual([]);
		expect(pack.objectivePairs).toEqual([]);
		expect(pack.boundSpaces).toEqual([]);
	});

	it("buckets obstacle into obstacles", () => {
		const a = obstacle("o1");
		const b = obstacle("o2");
		const pack = makeTestPack([a, b]);
		expect(obstacles(pack)).toEqual([a, b]);
		expect(pack.interestingObjects).toEqual([]);
		expect(pack.objectivePairs).toEqual([]);
		expect(pack.boundSpaces).toEqual([]);
	});

	it("pairs objective_object with its objective_space into objectivePairs", () => {
		const object = objectiveObject("obj-1", "space-1");
		const space = objectiveSpace("space-1");
		const pack = makeTestPack([object, space]);
		const pairs = carryPairs(pack);
		expect(pairs).toHaveLength(1);
		expect(pairs[0]?.object).toBe(object);
		expect(pairs[0]?.space).toBe(space);
		// The paired space is NOT also emitted as a bound space.
		expect(boundSpaces(pack)).toEqual([]);
	});

	it("treats unpaired objective_space as boundSpaces", () => {
		const space = objectiveSpace("use-space-1");
		const pack = makeTestPack([space]);
		expect(pack.boundSpaces).toEqual([space]);
		expect(pack.objectivePairs).toEqual([]);
	});

	it("handles mixed kinds without dropping or duplicating any entity", () => {
		const obj = objectiveObject("o-1", "s-1");
		const space = objectiveSpace("s-1");
		const unboundSpace = objectiveSpace("s-2");
		const io = interestingObject("io-1");
		const obs = obstacle("ob-1");
		const pack = makeTestPack([obj, space, unboundSpace, io, obs]);

		const flattened = [
			...pack.objectivePairs.flatMap((p) => [p.object, p.space]),
			...pack.interestingObjects,
			...(pack.boundSpaces ?? []),
			...pack.obstacles,
		];
		// Every input entity appears exactly once in the bucketed pack.
		expect(flattened).toHaveLength(5);
		expect(new Set(flattened.map((e) => e.id))).toEqual(
			new Set(["o-1", "s-1", "s-2", "io-1", "ob-1"]),
		);
	});

	it("preserves insertion order within each bucket", () => {
		const io1 = interestingObject("io-1");
		const io2 = interestingObject("io-2");
		const io3 = interestingObject("io-3");
		const ob1 = obstacle("ob-1");
		const ob2 = obstacle("ob-2");
		const pack = makeTestPack([io1, ob1, io2, ob2, io3]);
		expect(pack.interestingObjects.map((e) => e.id)).toEqual([
			"io-1",
			"io-2",
			"io-3",
		]);
		expect(pack.obstacles.map((e) => e.id)).toEqual(["ob-1", "ob-2"]);
	});

	it("merges overrides on top of derived buckets and defaults", () => {
		const io = interestingObject("io-1");
		const pack = makeTestPack([io], {
			setting: "abandoned subway station",
			weather: "rainy",
			wallName: "tunnel wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
			},
		});
		// Overrides applied.
		expect(pack.setting).toBe("abandoned subway station");
		expect(pack.weather).toBe("rainy");
		expect(pack.wallName).toBe("tunnel wall");
		expect(pack.aiStarts.red).toEqual({
			position: { row: 0, col: 0 },
			facing: "north",
		});
		// Derived bucket untouched.
		expect(pack.interestingObjects).toEqual([io]);
	});

	it("lets overrides win when the same bucket field is supplied", () => {
		const io = interestingObject("io-1");
		const replacementIo = interestingObject("io-99");
		const pack = makeTestPack([io], {
			interestingObjects: [replacementIo],
		});
		// Override wins entirely (documented behaviour — escape hatch for tests
		// that need to inject unusual shapes).
		expect(pack.interestingObjects).toEqual([replacementIo]);
	});

	it("throws when an objective_object is missing pairsWithSpaceId", () => {
		const orphan: WorldEntity = {
			id: "orphan",
			kind: "objective_object",
			name: "orphan",
			examineDescription: "orphan",
			holder: { row: 0, col: 0 },
		};
		expect(() => makeTestPack([orphan])).toThrow(/pairsWithSpaceId/);
	});

	it("throws when an objective_object references a missing objective_space", () => {
		const obj = objectiveObject("obj-1", "missing-space");
		expect(() => makeTestPack([obj])).toThrow(/missing objective_space/);
	});

	it("throws when two objective_objects pair with the same space", () => {
		const objA = objectiveObject("obj-a", "shared-space");
		const objB = objectiveObject("obj-b", "shared-space");
		const space = objectiveSpace("shared-space");
		expect(() => makeTestPack([objA, objB, space])).toThrow(
			/more than one objective_object/,
		);
	});

	it("throws on duplicate objective_space ids", () => {
		const dup1 = objectiveSpace("dup");
		const dup2 = objectiveSpace("dup");
		expect(() => makeTestPack([dup1, dup2])).toThrow(
			/duplicate objective_space/,
		);
	});
});
