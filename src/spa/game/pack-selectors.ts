/**
 * Pure selectors over a ContentPack.
 *
 * All selectors are side-effect free, do not mutate their input, and return
 * arrays in a stable (insertion) order.
 *
 * Read from the flat `pack.entities` array (schema v11+). Bucket fields no
 * longer exist on `ContentPack`; bucketing is derived here on demand.
 */
import type { ContentPack, ObjectivePair, WorldEntity } from "./types.js";

/**
 * Returns the carry-pair array from the pack (insertion order preserved).
 *
 * Each `objective_object` entity with a `pairsWithSpaceId` is paired with the
 * `objective_space` entity whose `id` matches. Pairs are emitted in the order
 * the carry objects appear in `pack.entities`. Objects whose partner space is
 * missing from the pack are silently skipped (defensive against malformed
 * inputs).
 */
export function carryPairs(pack: ContentPack): ObjectivePair[] {
	const spaceById = new Map<string, WorldEntity>();
	for (const entity of pack.entities) {
		if (entity.kind === "objective_space") spaceById.set(entity.id, entity);
	}

	const pairs: ObjectivePair[] = [];
	for (const entity of pack.entities) {
		if (entity.kind !== "objective_object") continue;
		const spaceId = entity.pairsWithSpaceId;
		if (spaceId === undefined) continue;
		const space = spaceById.get(spaceId);
		if (space === undefined) continue;
		pairs.push({ object: entity, space });
	}
	return pairs;
}

/**
 * Returns interesting-object entities from the pack (insertion order preserved).
 */
export function interestingObjects(pack: ContentPack): WorldEntity[] {
	return pack.entities.filter((e) => e.kind === "interesting_object");
}

/**
 * Returns bound-space entities — objective_space entities NOT referenced by
 * any `objective_object`'s `pairsWithSpaceId` in the pack (i.e. use_space and
 * convergence bindings).
 *
 * The discriminator is the same one `carryPairs` uses, so the contract holds
 * symmetrically: every `objective_space` is either a carry-paired space (the
 * `space` half of a pair) OR a bound space, never both.
 */
export function boundSpaces(pack: ContentPack): WorldEntity[] {
	const pairedSpaceIds = new Set<string>();
	for (const entity of pack.entities) {
		if (entity.kind === "objective_object" && entity.pairsWithSpaceId) {
			pairedSpaceIds.add(entity.pairsWithSpaceId);
		}
	}

	return pack.entities.filter(
		(e) => e.kind === "objective_space" && !pairedSpaceIds.has(e.id),
	);
}

/**
 * Returns obstacle entities from the pack (insertion order preserved).
 */
export function obstacles(pack: ContentPack): WorldEntity[] {
	return pack.entities.filter((e) => e.kind === "obstacle");
}

/**
 * Returns ALL objective_space entities: carry-paired spaces first (in pair
 * order), then bound spaces (in entity-array order).
 */
export function objectiveSpaces(pack: ContentPack): WorldEntity[] {
	const pairedSpaces = carryPairs(pack).map((p) => p.space);
	return [...pairedSpaces, ...boundSpaces(pack)];
}

/**
 * Returns the carry-paired objective_object entity with the given id, or
 * `undefined` if no carry pair in the pack has an object with that id.
 *
 * This is a targeted lookup used by dispatcher when it needs to recover the
 * authored object definition (e.g. for raw placementFlavor) from an entity id.
 */
export function carryObjectById(
	id: string,
	pack: ContentPack,
): WorldEntity | undefined {
	return carryPairs(pack)
		.map((p) => p.object)
		.find((o) => o.id === id);
}
