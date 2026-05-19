/**
 * Unit tests for pack-selectors.ts
 *
 * Selectors derive bucketing on demand from `pack.entities`. These tests build
 * entity arrays directly and exercise:
 *  - empty pack
 *  - each kind-only configuration
 *  - mixed packs
 *  - the `pairsWithSpaceId`-vs-not discriminator for `boundSpaces`
 *  - order-stability for every selector
 */
import { describe, expect, it } from "vitest";
import {
	boundSpaces,
	carryObjectById,
	carryPairs,
	interestingObjects,
	objectiveSpaces,
	obstacles,
} from "../pack-selectors.js";
import type { ContentPack, WorldEntity } from "../types.js";

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makePack(overrides?: Partial<ContentPack>): ContentPack {
	return {
		setting: "test",
		weather: "clear",
		timeOfDay: "noon",
		entities: [],
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

/**
 * Returns the two entities (object + paired space) for a carry pair at index
 * `i`. When `withPairsWithSpaceId` is false, the object omits the field so the
 * discriminator treats the space as unpaired.
 */
function makeCarryPairEntities(
	i: number,
	withPairsWithSpaceId = true,
): WorldEntity[] {
	const spaceId = `space-${i}`;
	const object: WorldEntity = {
		id: `obj-${i}`,
		kind: "objective_object",
		name: `object ${i}`,
		examineDescription: "An object.",
		holder: { row: 0, col: i },
	};
	if (withPairsWithSpaceId) object.pairsWithSpaceId = spaceId;
	const space: WorldEntity = {
		id: spaceId,
		kind: "objective_space",
		name: `space ${i}`,
		examineDescription: "A space.",
		holder: { row: 1, col: i },
	};
	return [object, space];
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

	it("returns pairs derived from entities (in object-iteration order)", () => {
		const entities = [...makeCarryPairEntities(0), ...makeCarryPairEntities(1)];
		const pack = makePack({ entities });
		const result = carryPairs(pack);
		expect(result).toHaveLength(2);
		expect(result[0]?.object.id).toBe("obj-0");
		expect(result[0]?.space.id).toBe("space-0");
		expect(result[1]?.object.id).toBe("obj-1");
		expect(result[1]?.space.id).toBe("space-1");
	});

	it("does not mutate the original pack", () => {
		const entities = makeCarryPairEntities(0);
		const pack = makePack({ entities });
		const result = carryPairs(pack);
		result.push({ object: entities[0]!, space: entities[1]! });
		expect(pack.entities).toHaveLength(2);
	});

	it("preserves carry-object order for 3 pairs", () => {
		const entities = [
			...makeCarryPairEntities(0),
			...makeCarryPairEntities(1),
			...makeCarryPairEntities(2),
		];
		const pack = makePack({ entities });
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
		const pack = makePack({ entities: [io0, io1] });
		const result = interestingObjects(pack);
		expect(result).toHaveLength(2);
		expect(result[0]).toBe(io0);
		expect(result[1]).toBe(io1);
	});

	it("does not mutate the original pack", () => {
		const io0 = makeInterestingObject(0);
		const pack = makePack({ entities: [io0] });
		const result = interestingObjects(pack);
		result.push(makeInterestingObject(99));
		expect(pack.entities).toHaveLength(1);
	});

	it("only returns interesting objects (kind isolation)", () => {
		const pack = makePack({
			entities: [
				...makeCarryPairEntities(0),
				makeInterestingObject(0),
				makeObstacle(0),
			],
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
		const pack = makePack({ entities: [o0, o1, o2] });
		const result = obstacles(pack);
		expect(result.map((e) => e.id)).toEqual([
			"obstacle-0",
			"obstacle-1",
			"obstacle-2",
		]);
	});

	it("does not mutate the original pack", () => {
		const o0 = makeObstacle(0);
		const pack = makePack({ entities: [o0] });
		const result = obstacles(pack);
		result.push(makeObstacle(99));
		expect(pack.entities).toHaveLength(1);
	});

	it("only returns obstacles (kind isolation)", () => {
		const pack = makePack({
			entities: [
				...makeCarryPairEntities(0),
				makeInterestingObject(0),
				makeObstacle(0),
			],
		});
		const result = obstacles(pack);
		expect(result).toHaveLength(1);
		expect(result[0]?.kind).toBe("obstacle");
	});
});

// ── boundSpaces ───────────────────────────────────────────────────────────────

describe("boundSpaces", () => {
	it("returns empty array when pack has no objective_space entities", () => {
		const pack = makePack(); // empty entities
		expect(boundSpaces(pack)).toEqual([]);
	});

	it("returns bound spaces in insertion order when there are no carry pairs", () => {
		const bs0 = makeBoundSpace(0);
		const bs1 = makeBoundSpace(1);
		const pack = makePack({ entities: [bs0, bs1] });
		const result = boundSpaces(pack);
		expect(result.map((e) => e.id)).toEqual(["bound-space-0", "bound-space-1"]);
	});

	it("does not mutate the original pack", () => {
		const bs0 = makeBoundSpace(0);
		const pack = makePack({ entities: [bs0] });
		const result = boundSpaces(pack);
		result.push(makeBoundSpace(99));
		expect(pack.entities).toHaveLength(1);
	});

	it("excludes objective_space entities referenced by a pairsWithSpaceId", () => {
		// The space `space-0` is referenced by `obj-0`'s pairsWithSpaceId — it
		// should be classified as a carry-paired space, NOT a bound space.
		const [pairObj, pairSpace] = makeCarryPairEntities(0);
		const genuineBound = makeBoundSpace(1);
		const pack = makePack({
			entities: [pairObj!, pairSpace!, genuineBound],
		});
		const result = boundSpaces(pack);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("bound-space-1");
	});

	it("includes objective_space entities NOT referenced by any pairsWithSpaceId", () => {
		// A carry pair whose object pairsWithSpaceId points to "space-0"; the
		// extra `bound-space-0` entity is NOT referenced, so it stays bound.
		const [pairObj, pairSpace] = makeCarryPairEntities(0);
		const bs0 = makeBoundSpace(0);
		const pack = makePack({ entities: [pairObj!, pairSpace!, bs0] });
		const result = boundSpaces(pack);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("bound-space-0");
	});

	it("handles objective_object without pairsWithSpaceId gracefully", () => {
		const [pairObj, pairSpace] = makeCarryPairEntities(0, false);
		const bs0 = makeBoundSpace(0);
		const pack = makePack({ entities: [pairObj!, pairSpace!, bs0] });
		// Neither `space-0` nor `bound-space-0` is referenced — both are
		// classified as bound (the carry object has no partner).
		const result = boundSpaces(pack);
		expect(result.map((e) => e.id)).toEqual(["space-0", "bound-space-0"]);
	});
});

// ── objectiveSpaces ───────────────────────────────────────────────────────────

describe("objectiveSpaces", () => {
	it("returns empty array for empty pack", () => {
		expect(objectiveSpaces(makePack())).toEqual([]);
	});

	it("returns paired spaces only when there are no bound spaces", () => {
		const entities = [...makeCarryPairEntities(0), ...makeCarryPairEntities(1)];
		const pack = makePack({ entities });
		const result = objectiveSpaces(pack);
		expect(result.map((e) => e.id)).toEqual(["space-0", "space-1"]);
	});

	it("returns bound spaces only when there are no carry pairs", () => {
		const bs0 = makeBoundSpace(0);
		const bs1 = makeBoundSpace(1);
		const pack = makePack({ entities: [bs0, bs1] });
		const result = objectiveSpaces(pack);
		expect(result.map((e) => e.id)).toEqual(["bound-space-0", "bound-space-1"]);
	});

	it("returns paired spaces before bound spaces in a mixed pack", () => {
		const pack = makePack({
			entities: [
				...makeCarryPairEntities(0),
				...makeCarryPairEntities(1),
				makeBoundSpace(0),
				makeBoundSpace(1),
			],
		});
		const result = objectiveSpaces(pack);
		expect(result.map((e) => e.id)).toEqual([
			"space-0",
			"space-1",
			"bound-space-0",
			"bound-space-1",
		]);
	});

	it("preserves carry-pair order and bound-space order", () => {
		const pack = makePack({
			entities: [
				...makeCarryPairEntities(2),
				...makeCarryPairEntities(0),
				...makeCarryPairEntities(1),
				makeBoundSpace(5),
				makeBoundSpace(3),
			],
		});
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
			entities: [
				...makeCarryPairEntities(0),
				makeInterestingObject(0),
				makeBoundSpace(0),
				makeObstacle(0),
			],
		});
		const result = objectiveSpaces(pack);
		for (const e of result) {
			expect(e.kind).toBe("objective_space");
		}
	});
});

// ── carryObjectById ───────────────────────────────────────────────────────────

describe("carryObjectById", () => {
	it("returns undefined for an empty pack", () => {
		expect(carryObjectById("anything", makePack())).toBeUndefined();
	});

	it("returns the matching carry object", () => {
		const pack = makePack({
			entities: [...makeCarryPairEntities(0), ...makeCarryPairEntities(1)],
		});
		const result = carryObjectById("obj-1", pack);
		expect(result).toBeDefined();
		expect(result?.id).toBe("obj-1");
		expect(result?.kind).toBe("objective_object");
	});

	it("returns undefined when id does not match any carry object", () => {
		const pack = makePack({
			entities: [...makeCarryPairEntities(0), ...makeCarryPairEntities(1)],
		});
		expect(carryObjectById("missing", pack)).toBeUndefined();
	});

	it("does not match by carry-space id, interesting-object id, bound-space id, or obstacle id", () => {
		// object id "obj-0", paired space id "space-0".
		const pack = makePack({
			entities: [
				...makeCarryPairEntities(0),
				makeInterestingObject(0), // id "interesting-0"
				makeBoundSpace(0), // id "bound-space-0"
				makeObstacle(0), // id "obstacle-0"
			],
		});
		expect(carryObjectById("space-0", pack)).toBeUndefined();
		expect(carryObjectById("interesting-0", pack)).toBeUndefined();
		expect(carryObjectById("bound-space-0", pack)).toBeUndefined();
		expect(carryObjectById("obstacle-0", pack)).toBeUndefined();
		// Sanity: the actual object id still resolves.
		expect(carryObjectById("obj-0", pack)?.id).toBe("obj-0");
	});

	it("picks the first match if duplicate ids exist (insertion order)", () => {
		const pair0 = makeCarryPairEntities(0);
		const pair1 = makeCarryPairEntities(0); // same ids — pathological but well-defined
		const pack = makePack({ entities: [...pair0, ...pair1] });
		const result = carryObjectById("obj-0", pack);
		expect(result).toBe(pair0[0]);
	});
});

// ── Mixed pack (all kinds populated) ──────────────────────────────────────────

describe("all selectors on a fully-populated mixed pack", () => {
	const pack = makePack({
		entities: [
			...makeCarryPairEntities(0),
			...makeCarryPairEntities(1),
			makeInterestingObject(0),
			makeInterestingObject(1),
			makeBoundSpace(0),
			makeObstacle(0),
			makeObstacle(1),
		],
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
