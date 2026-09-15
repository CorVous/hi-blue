/**
 * fixtures/retired-orientation.ts
 *
 * Test fixture for the per-Daemon orientation field retired by ADR 0015.
 *
 * `PersonaSpatialState` is position-only now, so a state that carries the old
 * field can only be built through an untyped shape. Tests use these helpers to
 * pin that such a field changes nothing: not the spatial state, not the
 * prompts, not the witness decisions. Old saves and stale fixtures still hold
 * it, so the runtime has to ignore it.
 *
 * The key is spelled from parts on purpose: a literal mention anywhere in
 * `src/` is a regression, so this module keeps the removal greppable.
 */

import type {
	AiId,
	GameState,
	GridPosition,
	PersonaSpatialState,
} from "../../types";

/** The retired orientation key, as an old save would spell it. */
export const RETIRED_ORIENTATION_KEY = ["fac", "ing"].join("");

/** A spatial record shaped like an old save's: position plus the retired field. */
export function spatialWithRetiredOrientation(
	position: GridPosition,
	value: string,
): PersonaSpatialState {
	return {
		position,
		[RETIRED_ORIENTATION_KEY]: value,
	} as PersonaSpatialState;
}

/** A GameState where one Daemon's spatial record also carries the retired field. */
export function withRetiredOrientation(
	game: GameState,
	aiId: AiId,
	value: string,
): GameState {
	const spatial = game.personaSpatial[aiId];
	if (!spatial) throw new Error(`No spatial state for ${aiId}`);
	return {
		...game,
		personaSpatial: {
			...game.personaSpatial,
			[aiId]: {
				...spatial,
				[RETIRED_ORIENTATION_KEY]: value,
			} as PersonaSpatialState,
		},
	};
}

/** Read the retired field back out of a Daemon's spatial record, for assertions. */
export function retiredOrientationOf(game: GameState, aiId: AiId): unknown {
	const spatial = game.personaSpatial[aiId] as
		| Record<string, unknown>
		| undefined;
	return spatial?.[RETIRED_ORIENTATION_KEY];
}
