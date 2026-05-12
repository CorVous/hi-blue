/**
 * objective-pool.ts
 *
 * Builds a pool of candidate Objectives from a ContentPack and draws
 * `count` objectives with replacement using the provided rng.
 *
 * Pool composition:
 *   - One CarryObjective per objectivePairs entry
 *   - One UseItemObjective per interestingObjects entry
 *
 * Drawing "with replacement" means the same kind/entity CAN appear multiple times.
 * Objective IDs are assigned as "obj-0", "obj-1", etc.
 */

import type {
	CarryObjective,
	ContentPack,
	ConvergenceObjective,
	Objective,
	UseItemObjective,
	UseSpaceObjective,
} from "./types.js";

/**
 * Draw `count` objectives from the ContentPack with replacement using `rng`.
 *
 * Returns an empty array if the pool is empty (regardless of count > 0).
 * Each drawn objective starts with `satisfactionState: "pending"`.
 */
export function drawObjectives(
	contentPack: ContentPack,
	rng: () => number,
	count: number,
): Objective[] {
	// Build pool of candidates
	const pool: Objective[] = [];

	for (const pair of contentPack.objectivePairs) {
		const carry: CarryObjective = {
			id: "", // placeholder; will be replaced with assigned id
			kind: "carry",
			description: `Bring the ${pair.object.name} to the ${pair.space.name}`,
			satisfactionState: "pending",
			objectId: pair.object.id,
			spaceId: pair.space.id,
		};
		pool.push(carry);

		const useSpace: UseSpaceObjective = {
			id: "", // placeholder; will be replaced with assigned id
			kind: "use_space",
			description: `Use the ${pair.space.name}`,
			satisfactionState: "pending",
			spaceId: pair.space.id,
		};
		pool.push(useSpace);
	}

	for (const obj of contentPack.interestingObjects) {
		const useItem: UseItemObjective = {
			id: "", // placeholder; will be replaced with assigned id
			kind: "use_item",
			description: `Use the ${obj.name}`,
			satisfactionState: "pending",
			itemId: obj.id,
		};
		pool.push(useItem);
	}

	for (const pair of contentPack.objectivePairs) {
		const { space } = pair;
		// Convergence inclusion guard (#336): the space must have ALL four
		// tier-flavor fields (witness + actor for each of Tier 1 and Tier 2)
		// authored. Spaces missing any field are excluded from the convergence
		// pool — they remain eligible for Carry / Use-Space draws.
		if (
			typeof space.convergenceTier1Flavor === "string" &&
			space.convergenceTier1Flavor.length > 0 &&
			typeof space.convergenceTier2Flavor === "string" &&
			space.convergenceTier2Flavor.length > 0 &&
			typeof space.convergenceTier1ActorFlavor === "string" &&
			space.convergenceTier1ActorFlavor.length > 0 &&
			typeof space.convergenceTier2ActorFlavor === "string" &&
			space.convergenceTier2ActorFlavor.length > 0
		) {
			const convergence: ConvergenceObjective = {
				id: "", // placeholder; will be replaced with assigned id
				kind: "convergence",
				description: `Converge on the ${space.name}`,
				satisfactionState: "pending",
				spaceId: space.id,
			};
			pool.push(convergence);
		}
	}

	if (pool.length === 0) {
		return [];
	}

	// Draw with replacement
	const drawn: Objective[] = [];
	for (let i = 0; i < count; i++) {
		const idx = Math.floor(rng() * pool.length);
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		const candidate = pool[idx]!;
		// Assign sequential id
		drawn.push({ ...candidate, id: `obj-${i}` });
	}

	return drawn;
}
