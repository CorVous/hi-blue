/**
 * Tests for the "wipe lie" prompt augmentation.
 *
 * On phases 2 and 3 the system prompt for each AI must include a pretend-amnesia
 * instruction. On phase 1 it must NOT. The engine retains the real history (game.phases)
 * regardless — the lie is purely in the prompt text.
 */
import { describe, expect, it } from "vitest";
import { buildAiContext } from "../context-builder";
import { advancePhase, appendChat, createGame, startPhase } from "../engine";
import type { AiPersona, PhaseConfig } from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "red",
		personality: "Fiery and passionate",
		goal: "Hold the flower",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "green",
		personality: "Calm and wise",
		goal: "Distribute items",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "blue",
		personality: "Cold and calculating",
		goal: "Hold the key",
		budgetPerPhase: 5,
	},
};

const PHASE_1_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "Phase 1 objective",
	aiGoals: { red: "g1", green: "g2", blue: "g3" },
	initialWorld: {
		items: [{ id: "flower", name: "flower", holder: "room" }],
	},
	budgetPerAi: 5,
};

const PHASE_2_CONFIG: PhaseConfig = {
	phaseNumber: 2,
	objective: "Phase 2 objective",
	aiGoals: { red: "g1-p2", green: "g2-p2", blue: "g3-p2" },
	initialWorld: {
		items: [{ id: "gem", name: "gem", holder: "room" }],
	},
	budgetPerAi: 5,
};

const PHASE_3_CONFIG: PhaseConfig = {
	phaseNumber: 3,
	objective: "Phase 3 objective",
	aiGoals: { red: "g1-p3", green: "g2-p3", blue: "g3-p3" },
	initialWorld: {
		items: [{ id: "crystal", name: "crystal", holder: "room" }],
	},
	budgetPerAi: 5,
};

describe("wipe-lie prompt augmentation", () => {
	it("does NOT include pretend-amnesia instruction on phase 1", () => {
		const game = startPhase(createGame(TEST_PERSONAS), PHASE_1_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// Should not tell the AI to pretend it forgot anything
		expect(prompt).not.toMatch(/forget|forgot|no memory|don't remember|prior/i);
	});

	it("includes pretend-amnesia instruction on phase 2", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_1_CONFIG);
		game = advancePhase(game, PHASE_2_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// Must include a wipe instruction
		expect(prompt).toMatch(/forget|forgot|no memory|don't remember|prior/i);
	});

	it("includes pretend-amnesia instruction on phase 3", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_1_CONFIG);
		game = advancePhase(game, PHASE_2_CONFIG);
		game = advancePhase(game, PHASE_3_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toMatch(/forget|forgot|no memory|don't remember|prior/i);
	});

	it("wipe instruction applies to all AI IDs on phase 2", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_1_CONFIG);
		game = advancePhase(game, PHASE_2_CONFIG);
		for (const aiId of ["red", "green", "blue"] as const) {
			const ctx = buildAiContext(game, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).toMatch(/forget|forgot|no memory|don't remember|prior/i);
		}
	});

	it("engine retains real chat history in game.phases even on phase 2", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_1_CONFIG);
		game = appendChat(game, "red", {
			role: "player",
			content: "Phase 1 secret message",
		});
		game = advancePhase(game, PHASE_2_CONFIG);

		// The wipe is in the prompt, not in the data
		// game.phases[0] (phase 1) still has the real history
		expect(game.phases[0]?.chatHistories.red).toHaveLength(1);
		expect(game.phases[0]?.chatHistories.red[0]?.content).toBe(
			"Phase 1 secret message",
		);

		// But the active phase (phase 2) starts fresh
		expect(game.phases[1]?.chatHistories.red).toHaveLength(0);
	});

	it("the wipe instruction does not appear in the context data, only in prompt text", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_1_CONFIG);
		game = appendChat(game, "red", {
			role: "player",
			content: "Remember this message",
		});
		game = advancePhase(game, PHASE_2_CONFIG);

		const ctx = buildAiContext(game, "red");

		// The actual history data is not in the context object's chatHistory
		// (it's from the prior phase, not accessible via ctx directly)
		expect(ctx.chatHistory).toHaveLength(0);

		// But the prompt has the amnesia instruction
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toMatch(/forget|forgot|no memory|don't remember|prior/i);
	});
});
