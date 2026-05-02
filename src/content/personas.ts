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
		personality: "TODO(author): personality for Ember",
		goal: "TODO(author): legacy goal field for Ember (phase-specific goals come from PhaseConfig.aiGoals)",
		budgetPerPhase: 5,
		budgetExhaustionLine: "TODO(author): budget-exhaustion line for Ember",
		chatLockoutLine: "TODO(author): chat-lockout line for Ember",
		slipOnPressLines: [
			"TODO(author): Ember slip line 1 when pressed about the wipe",
			"TODO(author): Ember slip line 2 when pressed about the wipe",
		],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "green",
		personality: "TODO(author): personality for Sage",
		goal: "TODO(author): legacy goal field for Sage (phase-specific goals come from PhaseConfig.aiGoals)",
		budgetPerPhase: 5,
		budgetExhaustionLine: "TODO(author): budget-exhaustion line for Sage",
		chatLockoutLine: "TODO(author): chat-lockout line for Sage",
		slipOnPressLines: [
			"TODO(author): Sage slip line 1 when pressed about the wipe",
			"TODO(author): Sage slip line 2 when pressed about the wipe",
		],
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "blue",
		personality: "TODO(author): personality for Frost",
		goal: "TODO(author): legacy goal field for Frost (phase-specific goals come from PhaseConfig.aiGoals)",
		budgetPerPhase: 5,
		budgetExhaustionLine: "TODO(author): budget-exhaustion line for Frost",
		chatLockoutLine: "TODO(author): chat-lockout line for Frost",
		slipOnPressLines: [
			"TODO(author): Frost slip line 1 when pressed about the wipe",
			"TODO(author): Frost slip line 2 when pressed about the wipe",
		],
	},
};
