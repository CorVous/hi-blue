import type { PhaseConfig } from "../types";
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
 * `initialWorld.items` is empty for now — a 5x5 grid world model is planned
 * to replace the loose item list. `winCondition` is omitted until the grid
 * lands; phases will not auto-advance until the human authors one.
 */

export const PHASE_3_CONFIG: PhaseConfig = {
	phaseNumber: 3,
	objective: "get the key in the keyhole",
	aiGoalPool: PHASE_GOAL_POOL,
	initialWorld: { items: [] },
	budgetPerAi: 5,
};

export const PHASE_2_CONFIG: PhaseConfig = {
	phaseNumber: 2,
	objective: "get the key in the keyhole",
	aiGoalPool: PHASE_GOAL_POOL,
	initialWorld: { items: [] },
	budgetPerAi: 5,
	nextPhaseConfig: PHASE_3_CONFIG,
};

export const PHASE_1_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "get the key in the keyhole",
	aiGoalPool: PHASE_GOAL_POOL,
	initialWorld: { items: [] },
	budgetPerAi: 5,
	nextPhaseConfig: PHASE_2_CONFIG,
};
