/**
 * Pure selectors over a ContentPack.
 *
 * All selectors are side-effect free, do not mutate their input, and return
 * arrays in a stable (insertion) order.
 *
 * These selectors read from the existing bucketed ContentPack fields so that
 * consumers can be migrated to use them before any schema change lands.
 */
import type { ContentPack, ObjectivePair, WorldEntity } from "./types.js";

/**
 * Returns the carry-pair array from the pack (insertion order preserved).
 */
export function carryPairs(pack: ContentPack): ObjectivePair[] {
	return pack.objectivePairs.slice();
}

/**
 * Returns interesting-object entities from the pack (insertion order preserved).
 */
export function interestingObjects(pack: ContentPack): WorldEntity[] {
	return pack.interestingObjects.slice();
}

/**
 * Returns bound-space entities — objective_space entities NOT paired with any
 * objective_object in the pack (i.e. use_space and convergence bindings).
 *
 * Today this maps directly to `pack.boundSpaces ?? []`, but the implementation
 * uses the discriminator (no carry-pair object references the space by id) so
 * that tests cover the semantic contract and the same tests will pass after a
 * schema flip.
 */
export function boundSpaces(pack: ContentPack): WorldEntity[] {
	// Build the set of space ids that ARE referenced by a carry-pair object.
	const pairedSpaceIds = new Set(
		pack.objectivePairs
			.map((p) => p.object.pairsWithSpaceId)
			.filter((id): id is string => id !== undefined),
	);

	return (pack.boundSpaces ?? []).filter(
		(space) => !pairedSpaceIds.has(space.id),
	);
}

/**
 * Returns obstacle entities from the pack (insertion order preserved).
 */
export function obstacles(pack: ContentPack): WorldEntity[] {
	return pack.obstacles.slice();
}

/**
 * Returns ALL objective_space entities: carry-paired spaces first (in pair
 * order), then bound spaces (in their array order).
 */
export function objectiveSpaces(pack: ContentPack): WorldEntity[] {
	const pairedSpaces = pack.objectivePairs.map((p) => p.space);
	return [...pairedSpaces, ...boundSpaces(pack)];
}
