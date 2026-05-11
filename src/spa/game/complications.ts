/**
 * complications.ts
 *
 * Mid-phase complication registry. Each Complication has a name and an
 * `apply` function that mutates game state (pure — returns a new GameState).
 *
 * Currently registered:
 *   - weatherChangeComplication: draws a new weather string (different from
 *     the current one) and broadcasts the change to all Daemon logs.
 */

import { WEATHER_POOL } from "../../content/index.js";
import {
	appendBroadcast,
	getActivePhase,
	setActivePhaseWeather,
} from "./engine.js";
import type { GameState } from "./types.js";

/**
 * A mid-phase complication: a named handler that receives the current game
 * state plus a seeded rng and returns an updated game state.
 */
export interface Complication {
	name: string;
	apply(game: GameState, rng: () => number): GameState;
}

/**
 * Weather Change complication.
 *
 * Draws a new weather string from WEATHER_POOL that is different from the
 * active phase's current `phase.weather`, updates `phase.weather` and
 * `phase.contentPack.weather`, then appends a broadcast entry to every
 * Daemon's conversation log.
 */
export const weatherChangeComplication: Complication = {
	name: "weatherChange",
	apply(game: GameState, rng: () => number): GameState {
		const currentWeather = getActivePhase(game).weather;

		// Filter out the current weather so the draw always produces a change.
		const candidates = (WEATHER_POOL as readonly string[]).filter(
			(w) => w !== currentWeather,
		);

		// If somehow the pool is empty (shouldn't happen with ≥2 entries), fall
		// back to the full pool so we never throw.
		const pool = candidates.length > 0 ? candidates : (WEATHER_POOL as readonly string[]);
		const idx = Math.floor(rng() * pool.length);
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		const newWeather = pool[idx]!;

		let state = setActivePhaseWeather(game, newWeather);
		state = appendBroadcast(
			state,
			`The weather has changed to ${newWeather}`,
		);
		return state;
	},
};

/**
 * Registry of all available complications. The round coordinator draws one
 * entry from this list when a `complicationConfig.triggerRound` fires.
 */
export const COMPLICATIONS: Complication[] = [weatherChangeComplication];
