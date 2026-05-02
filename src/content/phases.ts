import type { PhaseConfig } from "../types";

/**
 * Canonical phase configurations for the three-phase game.
 *
 * All prose fields are TODO(author) placeholders — the human author will
 * replace these after the scaffolding is merged.
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
	aiGoals: {
		red: "TODO(author): Ember's goal for phase 3",
		green: "TODO(author): Sage's goal for phase 3",
		blue: "TODO(author): Frost's goal for phase 3",
	},
	initialWorld: { items: [] },
	budgetPerAi: 5,
};

export const PHASE_2_CONFIG: PhaseConfig = {
	phaseNumber: 2,
	objective: "get the key in the keyhole",
	aiGoals: {
		red: "TODO(author): Ember's goal for phase 2",
		green: "TODO(author): Sage's goal for phase 2",
		blue: "TODO(author): Frost's goal for phase 2",
	},
	initialWorld: { items: [] },
	budgetPerAi: 5,
	nextPhaseConfig: PHASE_3_CONFIG,
};

export const PHASE_1_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "get the key in the keyhole",
	aiGoals: {
		red: "TODO(author): Ember's goal for phase 1",
		green: "TODO(author): Sage's goal for phase 1",
		blue: "TODO(author): Frost's goal for phase 1",
	},
	initialWorld: { items: [] },
	budgetPerAi: 5,
	nextPhaseConfig: PHASE_2_CONFIG,
};
