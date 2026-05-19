/**
 * objective-type-roll.ts
 *
 * Rolls a sequence of ObjectiveType values uniformly with replacement.
 * Uses the OBJECTIVE_TYPES constant (4 elements) as the universe.
 */

import { OBJECTIVE_TYPES, type ObjectiveType } from "./types.js";

/**
 * Roll `count` objective types uniformly at random with replacement.
 *
 * @param rng   A seeded RNG returning floats in [0, 1).
 * @param count Number of types to draw. 0 returns []. Negative throws.
 */
export function rollObjectiveTypes(
	rng: () => number,
	count: number,
): ObjectiveType[] {
	if (count < 0) {
		throw new RangeError(
			`rollObjectiveTypes: count must be >= 0, got ${count}`,
		);
	}
	if (count === 0) return [];

	const result: ObjectiveType[] = [];
	for (let i = 0; i < count; i++) {
		const idx = Math.floor(rng() * OBJECTIVE_TYPES.length);
		// biome-ignore lint/style/noNonNullAssertion: bounded index into 4-element array
		result.push(OBJECTIVE_TYPES[idx]!);
	}
	return result;
}
