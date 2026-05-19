/**
 * objective-record-builder.ts
 *
 * Builds typed Objective records from a list of ObjectiveTypes and a placed
 * ContentPack, using the type-first entity-ID convention:
 *
 *   carry-{i}-obj   → objectId for CarryObjective at index i
 *   carry-{i}-space → spaceId  for CarryObjective at index i
 *   useSpace-{i}-space  → spaceId  for UseSpaceObjective at index i
 *   useItem-{i}-item    → itemId   for UseItemObjective at index i
 *   convergence-{i}-space → spaceId  for ConvergenceObjective at index i
 *
 * Entities are looked up by id in the placed ContentPack:
 *   - carry objects and spaces come from objectivePairs[*].{object,space}
 *   - use_item items come from interestingObjects[*]
 *   - use_space spaces and convergence spaces also come from objectivePairs[*].space
 *     (they are authored as `objective_space` entities)
 *
 * Throws RangeError if any entity is not found in the pack.
 */

import {
	boundSpaces,
	carryPairs,
	interestingObjects,
} from "./pack-selectors.js";
import type {
	ContentPack,
	Objective,
	ObjectiveType,
	WorldEntity,
} from "./types.js";

/**
 * Build an array of Objective records from a types list and a placed ContentPack.
 *
 * @param types  The ordered list of ObjectiveTypes (length 3 for standard games).
 * @param pack   The placed ContentPack with entity holders assigned.
 * @returns      Array of Objective records with satisfactionState: "pending".
 */
export function buildObjectiveRecords(
	types: ObjectiveType[],
	pack: ContentPack,
): Objective[] {
	// Build entity lookup maps
	const objectById = new Map<string, WorldEntity>();
	const spaceById = new Map<string, WorldEntity>();
	const interestingById = new Map<string, WorldEntity>();

	for (const pair of carryPairs(pack)) {
		objectById.set(pair.object.id, pair.object);
		spaceById.set(pair.space.id, pair.space);
	}
	for (const space of boundSpaces(pack)) {
		spaceById.set(space.id, space);
	}
	for (const obj of interestingObjects(pack)) {
		interestingById.set(obj.id, obj);
	}

	const objectives: Objective[] = [];

	for (let i = 0; i < types.length; i++) {
		const type = types[i]!;
		const id = `obj-${i}`;

		switch (type) {
			case "carry": {
				const objectId = `carry-${i}-obj`;
				const spaceId = `carry-${i}-space`;

				const object = objectById.get(objectId);
				if (!object) {
					throw new RangeError(
						`buildObjectiveRecords: carry object "${objectId}" not found in pack.objectivePairs`,
					);
				}
				const space = spaceById.get(spaceId);
				if (!space) {
					throw new RangeError(
						`buildObjectiveRecords: carry space "${spaceId}" not found in pack.objectivePairs`,
					);
				}

				objectives.push({
					id,
					kind: "carry",
					description: `Bring the ${object.name} to the ${space.name}`,
					satisfactionState: "pending",
					objectId,
					spaceId,
				});
				break;
			}

			case "use_space": {
				const spaceId = `useSpace-${i}-space`;
				const space = spaceById.get(spaceId);
				if (!space) {
					throw new RangeError(
						`buildObjectiveRecords: use_space space "${spaceId}" not found in pack.objectivePairs or pack.boundSpaces`,
					);
				}

				objectives.push({
					id,
					kind: "use_space",
					description: `Use the ${space.name}`,
					satisfactionState: "pending",
					spaceId,
				});
				break;
			}

			case "use_item": {
				const itemId = `useItem-${i}-item`;
				const item = interestingById.get(itemId);
				if (!item) {
					throw new RangeError(
						`buildObjectiveRecords: use_item item "${itemId}" not found in pack.interestingObjects`,
					);
				}

				objectives.push({
					id,
					kind: "use_item",
					description: `Use the ${item.name}`,
					satisfactionState: "pending",
					itemId,
				});
				break;
			}

			case "convergence": {
				const spaceId = `convergence-${i}-space`;
				const space = spaceById.get(spaceId);
				if (!space) {
					throw new RangeError(
						`buildObjectiveRecords: convergence space "${spaceId}" not found in pack.objectivePairs or pack.boundSpaces`,
					);
				}

				objectives.push({
					id,
					kind: "convergence",
					description: `Converge on the ${space.name}`,
					satisfactionState: "pending",
					spaceId,
				});
				break;
			}
		}
	}

	return objectives;
}
