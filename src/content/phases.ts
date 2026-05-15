import type { SingleGameConfig } from "../content/content-pack-generator";

/**
 * Single-game config for the new flat game loop (issue #295).
 *
 * k = objective pairs, n = interesting objects, m = obstacles.
 * Budget is $0.50 per AI, no per-phase reset.
 */
export const SINGLE_GAME_CONFIG: SingleGameConfig = {
	kRange: [1, 2],
	nRange: [2, 4],
	mRange: [1, 3],
	budgetPerAi: 0.5,
};
