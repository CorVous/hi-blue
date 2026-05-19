/**
 * makeTestPack — entity-first fixture helper for ContentPack literals in tests.
 *
 * Tests usually want to express "here are the entities in this pack" without
 * pre-splitting them into the four bucket fields (`objectivePairs`,
 * `interestingObjects`, `boundSpaces`, `obstacles`) that ContentPack currently
 * stores. This helper takes a flat `WorldEntity[]` plus optional pack overrides
 * and produces a fully-typed `ContentPack`, mirroring the bucket semantics that
 * `pack-selectors.ts` reads back.
 *
 * Split rules (kept in lockstep with `pack-selectors.ts`):
 *  - `interesting_object`    → `interestingObjects`
 *  - `obstacle`              → `obstacles`
 *  - `objective_object`      → matched with a `objective_space` whose `id`
 *                              equals `pairsWithSpaceId`, emitted as an
 *                              `ObjectivePair`. Must carry `pairsWithSpaceId`
 *                              and reference an entity in the same list.
 *  - `objective_space` that is referenced by some `objective_object`'s
 *                              `pairsWithSpaceId` → the `space` half of that
 *                              pair (NOT also emitted as a bound space).
 *  - `objective_space` NOT referenced by any object → `boundSpaces` (use_space
 *                              and convergence bindings).
 *
 * This slice (#461) is test-only and writes the OLD bucketed ContentPack
 * shape. When the schema flips to a flat `entities` array (#462), only this
 * helper changes — call sites stay put.
 *
 * Insertion order is preserved within each bucket.
 */
import { DEFAULT_LANDMARKS } from "../../direction.js";
import type { ContentPack, ObjectivePair, WorldEntity } from "../../types.js";

/**
 * Builds a fully-typed ContentPack from a flat list of WorldEntities, splitting
 * them into the current bucket fields by kind + `pairsWithSpaceId` pairing.
 *
 * @param entities  Flat entity list. Order within a kind is preserved.
 * @param overrides Optional partial overrides merged on top of the derived
 *                  pack. Any field you pass here wins (including bucket fields
 *                  — useful when a test wants to inject malformed shapes that
 *                  the helper would otherwise reject).
 */
export function makeTestPack(
	entities: WorldEntity[],
	overrides?: Partial<ContentPack>,
): ContentPack {
	const interesting: WorldEntity[] = [];
	const obstacleEntities: WorldEntity[] = [];
	const objectiveObjects: WorldEntity[] = [];
	const objectiveSpaces: WorldEntity[] = [];

	for (const entity of entities) {
		switch (entity.kind) {
			case "interesting_object":
				interesting.push(entity);
				break;
			case "obstacle":
				obstacleEntities.push(entity);
				break;
			case "objective_object":
				objectiveObjects.push(entity);
				break;
			case "objective_space":
				objectiveSpaces.push(entity);
				break;
		}
	}

	// Build the lookup of objective_space entities by id so we can pair them
	// with the objective_objects that reference them.
	const spacesById = new Map<string, WorldEntity>();
	for (const space of objectiveSpaces) {
		if (spacesById.has(space.id)) {
			throw new Error(
				`makeTestPack: duplicate objective_space id "${space.id}"`,
			);
		}
		spacesById.set(space.id, space);
	}

	const pairs: ObjectivePair[] = [];
	const pairedSpaceIds = new Set<string>();
	for (const object of objectiveObjects) {
		const spaceId = object.pairsWithSpaceId;
		if (spaceId === undefined) {
			throw new Error(
				`makeTestPack: objective_object "${object.id}" is missing pairsWithSpaceId`,
			);
		}
		const space = spacesById.get(spaceId);
		if (space === undefined) {
			throw new Error(
				`makeTestPack: objective_object "${object.id}" references missing objective_space "${spaceId}"`,
			);
		}
		if (pairedSpaceIds.has(spaceId)) {
			throw new Error(
				`makeTestPack: objective_space "${spaceId}" is paired with more than one objective_object`,
			);
		}
		pairedSpaceIds.add(spaceId);
		pairs.push({ object, space });
	}

	const boundSpaces = objectiveSpaces.filter(
		(space) => !pairedSpaceIds.has(space.id),
	);

	const derived: ContentPack = {
		setting: "",
		weather: "",
		timeOfDay: "",
		objectivePairs: pairs,
		interestingObjects: interesting,
		boundSpaces,
		obstacles: obstacleEntities,
		landmarks: DEFAULT_LANDMARKS,
		wallName: "",
		aiStarts: {},
	};

	return { ...derived, ...overrides };
}
