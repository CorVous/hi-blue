import type { PhaseConfig } from "../spa/game/types";
import { PHASE_GOAL_POOL } from "./goal-pool";

/**
 * Canonical phase configurations for the three-phase game.
 *
 * Per-phase goals are drawn at phase start from the shared `PHASE_GOAL_POOL`.
 * Personalities (and the persona-level cross-game goal) live in `personas.ts`
 * and are stable across all three phases.
 *
 * Chain: PHASE_1_CONFIG → PHASE_2_CONFIG → PHASE_3_CONFIG (no next).
 *
 * k = objective pairs, n = interesting objects, m = obstacles.
 * The engine rolls k/n/m within the given ranges at game start via generateContentPacks.
 *
 * `winCondition` is omitted — phases do not auto-advance until a win-check is authored.
 */

export const PHASE_3_CONFIG: PhaseConfig = {
	phaseNumber: 3,
	kRange: [2, 3],
	nRange: [3, 4],
	mRange: [2, 3],
	budgetPerAi: 5,
	aiGoalPool: PHASE_GOAL_POOL,
};

export const PHASE_2_CONFIG: PhaseConfig = {
	phaseNumber: 2,
	kRange: [2, 2],
	nRange: [2, 4],
	mRange: [2, 3],
	budgetPerAi: 5,
	aiGoalPool: PHASE_GOAL_POOL,
	nextPhaseConfig: PHASE_3_CONFIG,
};

export const PHASE_1_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	kRange: [1, 1],
	nRange: [2, 3],
	mRange: [1, 2],
	budgetPerAi: 5,
	aiGoalPool: PHASE_GOAL_POOL,
	nextPhaseConfig: PHASE_2_CONFIG,
};
