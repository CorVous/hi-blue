import type { PhaseConfig } from "../types";

/**
 * Canonical phase configurations for the three-phase game.
 *
 * All prose fields are TODO(author) placeholders — the human author will
 * replace these after the scaffolding is merged.
 *
 * Chain: PHASE_1_CONFIG → PHASE_2_CONFIG → PHASE_3_CONFIG (no next).
 *
 * Win conditions are minimal placeholders so the engine can advance phases.
 * The human author should retune these after playtesting.
 */

export const PHASE_3_CONFIG: PhaseConfig = {
	phaseNumber: 3,
	objective: "TODO(author): phase 3 objective",
	aiGoals: {
		red: "TODO(author): Ember's goal for phase 3",
		green: "TODO(author): Sage's goal for phase 3",
		blue: "TODO(author): Frost's goal for phase 3",
	},
	initialWorld: {
		items: [
			{ id: "relic", name: "TODO(author): relic item name", holder: "room" },
			{ id: "seal", name: "TODO(author): seal item name", holder: "room" },
			{ id: "beacon", name: "TODO(author): beacon item name", holder: "room" },
		],
	},
	budgetPerAi: 5,
	// Minimal win condition: red holds the relic (author should retune)
	winCondition: (phase) =>
		phase.world.items.find((i) => i.id === "relic")?.holder === "red",
};

export const PHASE_2_CONFIG: PhaseConfig = {
	phaseNumber: 2,
	objective: "TODO(author): phase 2 objective",
	aiGoals: {
		red: "TODO(author): Ember's goal for phase 2",
		green: "TODO(author): Sage's goal for phase 2",
		blue: "TODO(author): Frost's goal for phase 2",
	},
	initialWorld: {
		items: [
			{ id: "lens", name: "TODO(author): lens item name", holder: "room" },
			{ id: "key", name: "TODO(author): key item name", holder: "room" },
			{ id: "scroll", name: "TODO(author): scroll item name", holder: "room" },
		],
	},
	budgetPerAi: 5,
	// Minimal win condition: blue holds the key (author should retune)
	winCondition: (phase) =>
		phase.world.items.find((i) => i.id === "key")?.holder === "blue",
	nextPhaseConfig: PHASE_3_CONFIG,
};

export const PHASE_1_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "TODO(author): phase 1 objective",
	aiGoals: {
		red: "TODO(author): Ember's goal for phase 1",
		green: "TODO(author): Sage's goal for phase 1",
		blue: "TODO(author): Frost's goal for phase 1",
	},
	initialWorld: {
		items: [
			{ id: "flower", name: "TODO(author): flower item name", holder: "room" },
			{ id: "token", name: "TODO(author): token item name", holder: "room" },
			{ id: "map", name: "TODO(author): map item name", holder: "room" },
		],
	},
	budgetPerAi: 5,
	// Minimal win condition: red holds the flower (author should retune)
	winCondition: (phase) =>
		phase.world.items.find((i) => i.id === "flower")?.holder === "red",
	nextPhaseConfig: PHASE_2_CONFIG,
};
