/**
 * Smoke tests for the makeTestPack fixture helper.
 *
 * Since the v11 schema flip (#462), `makeTestPack` is a thin shim that drops
 * the input entity list onto `pack.entities` with default scaffolding. These
 * tests confirm:
 *  - defaults are sensible (empty `entities`, DEFAULT_LANDMARKS, etc.)
 *  - entities are forwarded unmodified and in insertion order
 *  - selectors classify entities correctly off a `makeTestPack` result
 *  - overrides win (including overriding `entities` outright)
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
		expect(pack.entities).toEqual([]);
	});

	it("forwards interesting_object entities to interestingObjects selector", () => {
		const a = interestingObject("a");
		const b = interestingObject("b");
		const pack = makeTestPack([a, b]);
		expect(interestingObjects(pack)).toEqual([a, b]);
		expect(obstacles(pack)).toEqual([]);
		expect(carryPairs(pack)).toEqual([]);
		expect(boundSpaces(pack)).toEqual([]);
	});

	it("forwards obstacle entities to obstacles selector", () => {
		const a = obstacle("o1");
		const b = obstacle("o2");
		const pack = makeTestPack([a, b]);
		expect(obstacles(pack)).toEqual([a, b]);
		expect(interestingObjects(pack)).toEqual([]);
		expect(carryPairs(pack)).toEqual([]);
		expect(boundSpaces(pack)).toEqual([]);
	});

	it("carryPairs derives pairs from objective_object + objective_space entities", () => {
		const object = objectiveObject("obj-1", "space-1");
		const space = objectiveSpace("space-1");
		const pack = makeTestPack([object, space]);
		const pairs = carryPairs(pack);
		expect(pairs).toHaveLength(1);
		expect(pairs[0]?.object).toBe(object);
		expect(pairs[0]?.space).toBe(space);
		// The paired space is NOT also returned as a bound space.
		expect(boundSpaces(pack)).toEqual([]);
	});

	it("treats unpaired objective_space as a bound space", () => {
		const space = objectiveSpace("use-space-1");
		const pack = makeTestPack([space]);
		expect(boundSpaces(pack)).toEqual([space]);
		expect(carryPairs(pack)).toEqual([]);
	});

	it("handles mixed kinds without dropping or duplicating any entity", () => {
		const obj = objectiveObject("o-1", "s-1");
		const space = objectiveSpace("s-1");
		const unboundSpace = objectiveSpace("s-2");
		const io = interestingObject("io-1");
		const obs = obstacle("ob-1");
		const pack = makeTestPack([obj, space, unboundSpace, io, obs]);

		// Every input entity appears exactly once in pack.entities.
		expect(pack.entities).toHaveLength(5);
		expect(new Set(pack.entities.map((e) => e.id))).toEqual(
			new Set(["o-1", "s-1", "s-2", "io-1", "ob-1"]),
		);
	});

	it("preserves insertion order", () => {
		const io1 = interestingObject("io-1");
		const io2 = interestingObject("io-2");
		const io3 = interestingObject("io-3");
		const ob1 = obstacle("ob-1");
		const ob2 = obstacle("ob-2");
		const pack = makeTestPack([io1, ob1, io2, ob2, io3]);
		// The entities array preserves caller order verbatim.
		expect(pack.entities.map((e) => e.id)).toEqual([
			"io-1",
			"ob-1",
			"io-2",
			"ob-2",
			"io-3",
		]);
		// Selectors filter by kind without re-sorting.
		expect(interestingObjects(pack).map((e) => e.id)).toEqual([
			"io-1",
			"io-2",
			"io-3",
		]);
		expect(obstacles(pack).map((e) => e.id)).toEqual(["ob-1", "ob-2"]);
	});

	it("merges overrides on top of derived defaults", () => {
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
		// Derived entities untouched.
		expect(pack.entities).toEqual([io]);
	});

	it("lets overrides win when entities is supplied directly", () => {
		const io = interestingObject("io-1");
		const replacementIo = interestingObject("io-99");
		const pack = makeTestPack([io], {
			entities: [replacementIo],
		});
		// Override wins entirely (documented escape hatch for tests that need
		// to inject unusual shapes).
		expect(pack.entities).toEqual([replacementIo]);
	});
});
