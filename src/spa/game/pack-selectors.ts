import type { ContentPack, ObjectivePair, WorldEntity } from "./types.js";

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

export function interestingObjects(pack: ContentPack): WorldEntity[] {
	return pack.entities.filter((e) => e.kind === "interesting_object");
}

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

export function obstacles(pack: ContentPack): WorldEntity[] {
	return pack.entities.filter((e) => e.kind === "obstacle");
}

export function standaloneObjectives(pack: ContentPack): WorldEntity[] {
	return pack.entities.filter(
		(e) => e.kind === "objective_object" && !e.pairsWithSpaceId,
	);
}

export function objectiveSpaces(pack: ContentPack): WorldEntity[] {
	const pairedSpaces = carryPairs(pack).map((p) => p.space);
	return [...pairedSpaces, ...boundSpaces(pack)];
}

export function carryObjectById(
	id: string,
	pack: ContentPack,
): WorldEntity | undefined {
	return carryPairs(pack)
		.map((p) => p.object)
		.find((o) => o.id === id);
}
