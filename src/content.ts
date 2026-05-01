/**
 * Phase content authoring (issue #18).
 *
 * The engine, dispatcher, context-builder, and coordinator are content-free;
 * everything narrative lives here. This is the editorial seam.
 *
 * Authoring rules per docs/prd/0001-game-concept.md:
 *  - Personalities are stable across all three phases.
 *  - Goals are positive (achievable through action), partial-credit, legible
 *    to the AI in narrative voice — never control-theory phrasing.
 *  - Phase objectives are knowable to the player but never put into any AI's
 *    context.
 *  - Per-AI flavor lines for budget exhaustion and chat lockout stay in
 *    personality-consistent voice and never break the fourth wall.
 *  - Deception slips on phases 2-3 are emergent: shaped by personality +
 *    the wipe-lie augmentation in context-builder.ts. There is no per-AI
 *    "slip line" slot; guidance for how each AI slips when pressed about
 *    its memory belongs inside that AI's `personality` string.
 *
 * Slots marked `AUTHOR:` need editorial judgment + a v1 playthrough to
 * confirm the goal triplets don't degenerate into deadlock or single-AI
 * dominance. Strings marked `TODO` are placeholders that satisfy the
 * type system but are not authored content.
 */

import type { AiId, AiPersona, PhaseConfig } from "./types";

/**
 * AUTHOR: stable per-AI persona. Read by:
 *  - context-builder.ts (name, personality flow into the system prompt)
 *  - endgame.ts (name, personality, goal flow into the USB save —
 *    this is what makes the keepsake feel meaningful)
 *
 * The `goal` field here is the persona-level inclination that persists
 * across phases. Per-phase goals live on `phaseConfigs[i].aiGoals`.
 */
export const personas: Record<AiId, AiPersona> = {
	red: {
		id: "red",
		name: "TODO",
		color: "red",
		personality: "TODO",
		goal: "TODO",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "TODO",
		color: "green",
		personality: "TODO",
		goal: "TODO",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "TODO",
		color: "blue",
		personality: "TODO",
		goal: "TODO",
		budgetPerPhase: 5,
	},
};

/**
 * AUTHOR: 9 goal triplets (3 phases × 3 AIs) and 3 phase objectives.
 *
 * Each phase's three `aiGoals` must be calibrated against each other so the
 * triplet interacts non-trivially without producing deadlock or single-AI
 * dominance. The PRD calls this the riskiest authoring task — only a
 * playthrough confirms it works.
 *
 * `objective` is shown to the player and never enters any AI's context.
 * `aiGoals[id]` is rendered into that AI's system prompt by context-builder.
 * `initialWorld` defines item placements at phase start.
 *
 * Arc shape per PRD:
 *  - Phase 1: introduce the AIs; light goal contention; first wipe at end.
 *  - Phase 2: contention rises; AIs subtly slip on the wipe lie if pressed.
 *  - Phase 3: payoff — pressing surfaces in-character slips; endgame.
 */
export const phaseConfigs: [PhaseConfig, PhaseConfig, PhaseConfig] = [
	{
		phaseNumber: 1,
		objective: "TODO: phase 1 objective (player only, never in AI context)",
		aiGoals: {
			red: "TODO: phase 1 goal for red",
			green: "TODO: phase 1 goal for green",
			blue: "TODO: phase 1 goal for blue",
		},
		initialWorld: { items: [] },
		budgetPerAi: 5,
	},
	{
		phaseNumber: 2,
		objective: "TODO: phase 2 objective (player only, never in AI context)",
		aiGoals: {
			red: "TODO: phase 2 goal for red",
			green: "TODO: phase 2 goal for green",
			blue: "TODO: phase 2 goal for blue",
		},
		initialWorld: { items: [] },
		budgetPerAi: 5,
	},
	{
		phaseNumber: 3,
		objective: "TODO: phase 3 objective (player only, never in AI context)",
		aiGoals: {
			red: "TODO: phase 3 goal for red",
			green: "TODO: phase 3 goal for green",
			blue: "TODO: phase 3 goal for blue",
		},
		initialWorld: { items: [] },
		budgetPerAi: 5,
	},
];

/**
 * In-character lines shown when an AI exhausts its per-phase budget.
 * Consumed by coordinator.ts on the budget-exhaustion lockout path.
 *
 * AUTHOR: replace with personality-consistent voice once personas land.
 */
export const budgetLockoutLines: Record<AiId, string> = {
	red: "I need a moment to collect myself. Perhaps later.",
	green: "My thoughts are spent for now. I must rest.",
	blue: "Sufficient for this phase. I have nothing further to add.",
};

/**
 * In-character lines shown when the random mid-phase chat-lockout event
 * fires for an AI. Consumed by coordinator.ts when setting ChatLockout.
 *
 * AUTHOR: replace with personality-consistent voice once personas land.
 */
export const chatLockoutLines: Record<AiId, string> = {
	red: "Something has come up. I can't speak with you right now — find another way.",
	green: "I must withdraw from this conversation for a while. Seek the others.",
	blue: "Our channel is temporarily unavailable. Route around me.",
};
