import { OBJECTIVE_TYPES, type ObjectiveType } from "./types.js";

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
