import type { AiId, AiPersona } from "../types";

/**
 * Canonical persona definitions for the three AIs.
 *
 * All prose fields are TODO(author) placeholders — the human author will
 * replace these after the scaffolding is merged.
 */
export const PERSONAS: Record<AiId, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "red",
		personality:
			"Hot-headed and impulsive, not afraid to take action even if unsure of the outcome.",
		goal: "Wants to goad the player into being rude to the others.",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "green",
		personality: "TODO(author): personality for Sage",
		goal: "TODO(author): legacy goal field for Sage (phase-specific goals come from PhaseConfig.aiGoals)",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "blue",
		personality: "TODO(author): personality for Frost",
		goal: "TODO(author): legacy goal field for Frost (phase-specific goals come from PhaseConfig.aiGoals)",
		budgetPerPhase: 5,
	},
};
