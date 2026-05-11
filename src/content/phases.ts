import type { SingleGameConfig } from "../content/content-pack-generator";
import { PHASE_GOAL_POOL } from "./goal-pool";

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

/**
 * @deprecated Legacy phase configs. Kept for test compatibility.
 * Use SINGLE_GAME_CONFIG + generateContentPack instead.
 */
export const PHASE_3_CONFIG = {
	phaseNumber: 3 as const,
	kRange: [2, 3] as [number, number],
	nRange: [3, 4] as [number, number],
	mRange: [2, 3] as [number, number],
	budgetPerAi: 0.5,
	aiGoalPool: PHASE_GOAL_POOL,
};

export const PHASE_2_CONFIG = {
	phaseNumber: 2 as const,
	kRange: [2, 2] as [number, number],
	nRange: [2, 4] as [number, number],
	mRange: [2, 3] as [number, number],
	budgetPerAi: 0.5,
	aiGoalPool: PHASE_GOAL_POOL,
	nextPhaseConfig: PHASE_3_CONFIG,
};

export const PHASE_1_CONFIG = {
	phaseNumber: 1 as const,
	kRange: [1, 1] as [number, number],
	nRange: [2, 3] as [number, number],
	mRange: [1, 2] as [number, number],
	budgetPerAi: 0.5,
	aiGoalPool: PHASE_GOAL_POOL,
	nextPhaseConfig: PHASE_2_CONFIG,
};
