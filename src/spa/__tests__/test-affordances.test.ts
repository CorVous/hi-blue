/**
 * Unit tests for SPA-side test affordances (issue #91, #101).
 *
 * `applyTestAffordances` reads `?winImmediately=1` and `?lockout=1` from a
 * URLSearchParams object and mutates the session accordingly, but only when
 * `__WORKER_BASE_URL__` is "http://localhost:8787".
 *
 * Issue #101: `winImmediately=1` now recursively patches the real phase chain
 * (PHASE_1 → PHASE_2 → PHASE_3) so that cold-start can reach game_ended.
 */

import { describe, expect, it, vi } from "vitest";

// Provide __WORKER_BASE_URL__ global before importing the module under test.
// Tests that exercise the production gate will override this stub locally.
vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");

import { getActivePhase } from "../game/engine";
import { GameSession } from "../game/game-session";
import { MockRoundLLMProvider } from "../game/round-llm-provider";
import type { AiPersona, PhaseConfig } from "../game/types";
import { applyTestAffordances } from "../routes/game";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		budgetPerPhase: 5,
	},
};

const PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	kRange: [1, 1],
	nRange: [0, 0],
	mRange: [0, 0],
	aiGoalPool: ["Hold the flower", "Distribute evenly", "Hold the key"],
	budgetPerAi: 5,
	// No winCondition — phase never auto-advances by default
};

function makePassProvider() {
	return new MockRoundLLMProvider([
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
	]);
}

function makeSession(): GameSession {
	return new GameSession(PHASE_CONFIG, TEST_PERSONAS);
}

// ── winImmediately=1 ─────────────────────────────────────────────────────────

describe("applyTestAffordances — winImmediately=1", () => {
	it("returns the same session when no params are set", () => {
		const session = makeSession();
		const result = applyTestAffordances(session, new URLSearchParams());
		expect(result).toBe(session);
	});

	it("injects winCondition: () => true into the active phase", () => {
		const session = makeSession();
		const phase = getActivePhase(session.getState());
		// Original session has no winCondition
		expect(phase.winCondition).toBeUndefined();

		const result = applyTestAffordances(
			session,
			new URLSearchParams("winImmediately=1"),
		);

		const patchedPhase = getActivePhase(result.getState());
		expect(patchedPhase.winCondition).toBeDefined();
		// The injected winCondition always returns true
		// biome-ignore lint/style/noNonNullAssertion: checked by toBeDefined() above
		expect(patchedPhase.winCondition!(patchedPhase)).toBe(true);
	});

	it("does NOT mutate the original session's state", () => {
		const session = makeSession();
		applyTestAffordances(session, new URLSearchParams("winImmediately=1"));
		// Original session is unchanged
		const phase = getActivePhase(session.getState());
		expect(phase.winCondition).toBeUndefined();
	});

	it("the injected winCondition causes the game to end after one round", async () => {
		const session = makeSession();
		const patched = applyTestAffordances(
			session,
			new URLSearchParams("winImmediately=1"),
		);

		const { result } = await patched.submitMessage(
			"red",
			"hello",
			makePassProvider(),
		);

		// The phase should have ended (winCondition fired)
		expect(result.phaseEnded).toBe(true);
	});

	it("is a no-op when __WORKER_BASE_URL__ is not localhost:8787 (production gate)", () => {
		vi.stubGlobal("__WORKER_BASE_URL__", "https://production.example.com");
		try {
			const session = makeSession();
			const result = applyTestAffordances(
				session,
				new URLSearchParams("winImmediately=1"),
			);
			// Must return the original session unchanged
			expect(result).toBe(session);
			expect(getActivePhase(result.getState()).winCondition).toBeUndefined();
		} finally {
			vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		}
	});

	it("is a no-op when location.origin differs from __WORKER_BASE_URL__ (separate-host gate)", () => {
		// Simulate the SPA being served from a separate static host while
		// __WORKER_BASE_URL__ still points at the local worker — this is the
		// "not wrangler dev" case the new gate is meant to lock out.
		vi.stubGlobal("location", {
			origin: "http://localhost:5173",
			search: "",
		});
		try {
			const session = makeSession();
			const result = applyTestAffordances(
				session,
				new URLSearchParams("winImmediately=1"),
			);
			expect(result).toBe(session);
			expect(getActivePhase(result.getState()).winCondition).toBeUndefined();
		} finally {
			vi.unstubAllGlobals();
			vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		}
	});

	it("recursively patches nextPhaseConfig chain so all levels have winCondition: () => true", () => {
		// Build a 3-deep config chain: a → b → c
		const configC: PhaseConfig = {
			phaseNumber: 3,
			kRange: [1, 1],
			nRange: [0, 0],
			mRange: [0, 0],
			aiGoalPool: ["r"],
			budgetPerAi: 5,
			// No winCondition, no nextPhaseConfig
		};
		const configB: PhaseConfig = {
			phaseNumber: 2,
			kRange: [1, 1],
			nRange: [0, 0],
			mRange: [0, 0],
			aiGoalPool: ["r"],
			budgetPerAi: 5,
			nextPhaseConfig: configC,
		};
		const configA: PhaseConfig = {
			phaseNumber: 1,
			kRange: [1, 1],
			nRange: [0, 0],
			mRange: [0, 0],
			aiGoalPool: ["r"],
			budgetPerAi: 5,
			nextPhaseConfig: configB,
		};

		const session = new GameSession(configA, TEST_PERSONAS);
		const result = applyTestAffordances(
			session,
			new URLSearchParams("winImmediately=1"),
		);

		const patchedPhase = getActivePhase(result.getState());

		// Active phase winCondition must return true
		expect(patchedPhase.winCondition).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: checked by toBeDefined()
		expect(patchedPhase.winCondition!(patchedPhase)).toBe(true);

		// nextPhaseConfig (b) must also have winCondition: () => true
		expect(patchedPhase.nextPhaseConfig).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: checked by toBeDefined()
		const chainB = patchedPhase.nextPhaseConfig!;
		expect(chainB.winCondition).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: checked by toBeDefined()
		expect(chainB.winCondition!(patchedPhase)).toBe(true);

		// nextPhaseConfig.nextPhaseConfig (c) must also have winCondition: () => true
		expect(chainB.nextPhaseConfig).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: checked by toBeDefined()
		const chainC = chainB.nextPhaseConfig!;
		expect(chainC.winCondition).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: checked by toBeDefined()
		expect(chainC.winCondition!(patchedPhase)).toBe(true);

		// The deepest link has no further nextPhaseConfig
		expect(chainC.nextPhaseConfig).toBeUndefined();

		// Original configs are not mutated
		expect(configA.winCondition).toBeUndefined();
		expect(configB.winCondition).toBeUndefined();
		expect(configC.winCondition).toBeUndefined();
	});
});

// ── lockout=1 ────────────────────────────────────────────────────────────────

describe("applyTestAffordances — lockout=1", () => {
	it("arms a chat-lockout for red, 2 rounds, on the next round", async () => {
		const session = makeSession();
		const result = applyTestAffordances(
			session,
			new URLSearchParams("lockout=1"),
		);

		// Submitting one round should trigger the chat lockout (red, round 1 triggers)
		const { result: roundResult } = await result.submitMessage(
			"red",
			"hello",
			makePassProvider(),
		);

		expect(roundResult.chatLockoutTriggered).toBeDefined();
		expect(roundResult.chatLockoutTriggered?.aiId).toBe("red");
	});

	it("is a no-op when __WORKER_BASE_URL__ is not localhost:8787 (production gate)", async () => {
		vi.stubGlobal("__WORKER_BASE_URL__", "https://production.example.com");
		try {
			const session = makeSession();
			const result = applyTestAffordances(
				session,
				new URLSearchParams("lockout=1"),
			);
			// Should return the same session without arming a lockout
			expect(result).toBe(session);

			const { result: roundResult } = await result.submitMessage(
				"red",
				"hello",
				makePassProvider(),
			);
			// No lockout should have triggered
			expect(roundResult.chatLockoutTriggered).toBeUndefined();
		} finally {
			vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		}
	});
});

// ── Three-round game-ended (issue #101) ───────────────────────────────────────

describe("applyTestAffordances — winImmediately=1 three-round chain reaches game_ended", () => {
	it("drives game_ended through a 3-deep config chain with three submitMessage calls", async () => {
		// Build a 3-deep chain mirroring PHASE_1_CONFIG → PHASE_2_CONFIG → PHASE_3_CONFIG
		const phase3Config: PhaseConfig = {
			phaseNumber: 3,
			kRange: [1, 1],
			nRange: [0, 0],
			mRange: [0, 0],
			aiGoalPool: ["r"],
			budgetPerAi: 5,
		};
		const phase2Config: PhaseConfig = {
			phaseNumber: 2,
			kRange: [1, 1],
			nRange: [0, 0],
			mRange: [0, 0],
			aiGoalPool: ["r"],
			budgetPerAi: 5,
			nextPhaseConfig: phase3Config,
		};
		const phase1Config: PhaseConfig = {
			phaseNumber: 1,
			kRange: [1, 1],
			nRange: [0, 0],
			mRange: [0, 0],
			aiGoalPool: ["r"],
			budgetPerAi: 5,
			nextPhaseConfig: phase2Config,
		};

		const session = new GameSession(phase1Config, TEST_PERSONAS);
		let active = applyTestAffordances(
			session,
			new URLSearchParams("winImmediately=1"),
		);

		// Round 1: phase 1 ends, game has not ended
		const { result: result1, nextState: state1 } = await active.submitMessage(
			"red",
			"hello",
			makePassProvider(),
		);
		expect(result1.phaseEnded).toBe(true);
		expect(result1.gameEnded).toBe(false);
		active = GameSession.restore(state1);

		// Round 2: phase 2 ends, game has not ended
		const { result: result2, nextState: state2 } = await active.submitMessage(
			"red",
			"hello",
			makePassProvider(),
		);
		expect(result2.phaseEnded).toBe(true);
		expect(result2.gameEnded).toBe(false);
		active = GameSession.restore(state2);

		// Round 3: phase 3 ends, game HAS ended
		const { result: result3 } = await active.submitMessage(
			"red",
			"hello",
			makePassProvider(),
		);
		expect(result3.phaseEnded).toBe(true);
		expect(result3.gameEnded).toBe(true);
	});
});

// ── Combined params ───────────────────────────────────────────────────────────

describe("applyTestAffordances — winImmediately=1&lockout=1 combined", () => {
	it("both winCondition and lockout are applied together", async () => {
		const session = makeSession();
		const result = applyTestAffordances(
			session,
			new URLSearchParams("winImmediately=1&lockout=1"),
		);

		const patchedPhase = getActivePhase(result.getState());
		expect(patchedPhase.winCondition).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: checked by toBeDefined() above
		expect(patchedPhase.winCondition!(patchedPhase)).toBe(true);

		const { result: roundResult } = await result.submitMessage(
			"red",
			"hello",
			makePassProvider(),
		);

		// Phase ends (winCondition fires)
		expect(roundResult.phaseEnded).toBe(true);
		// Lockout also triggers (the armed lockout fires on round 1)
		expect(roundResult.chatLockoutTriggered).toBeDefined();
		expect(roundResult.chatLockoutTriggered?.aiId).toBe("red");
	});
});
