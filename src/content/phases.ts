import { PHASE_GOAL_POOL } from "./goal-pool";

export { PHASE_GOAL_POOL };

/**
 * Content generation ranges for the single-game loop.
 *
 * k = objective pairs, n = interesting objects, m = obstacles.
 * The engine rolls k/n/m within the given ranges at game start via generateContentPacks.
 */
export const GAME_CONTENT_RANGES = {
	kRange: [1, 3] as [number, number],
	nRange: [2, 4] as [number, number],
	mRange: [1, 3] as [number, number],
};
