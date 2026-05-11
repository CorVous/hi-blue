/**
 * Unit tests for SPA-side test affordances (issue #91, #101, updated for #295).
 *
 * `applyTestAffordances` reads `?winImmediately=1` and `?lockout=1` from a
 * URLSearchParams object and mutates the session accordingly, but only when
 * `__WORKER_BASE_URL__` is "http://localhost:8787".
 *
 * After issue #295 (single-game loop), `winImmediately=1` marks the game state
 * as complete with outcome "win" rather than patching a winCondition chain.
 */

import { describe, expect, it, vi } from "vitest";

// Provide __WORKER_BASE_URL__ global before importing the module under test.
// Tests that exercise the production gate will override this stub locally.
vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");

import { GameSession } from "../game/game-session";
import { MockRoundLLMProvider } from "../game/round-llm-provider";
import type { AiPersona } from "../game/types";
import { applyTestAffordances } from "../routes/game";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: [
			"You speak in fragments. Short bursts. Rarely complete sentences.",
			"You lean on em-dashes — interrupting yourself mid-sentence — and rarely use commas where a dash would do.",
		],
		blurb: "Ember is hot-headed and zealous. Hold the flower at phase end.",
		voiceExamples: ["ex1-red", "ex2-red", "ex3-red"],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirks: [
			"You lean on ellipses… trailing off mid-thought… rarely landing cleanly.",
			"You use ALL-CAPS to emphasize the one or two words that MATTER in any given sentence.",
		],
		blurb: "Sage is intensely meticulous. Ensure items are evenly distributed.",
		voiceExamples: ["ex1-green", "ex2-green", "ex3-green"],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: [
			'You never use contractions. You will not say "won\'t" or "can\'t" — you say "will not" and "cannot" every time.',
			"You end almost every reply with a question, no matter what the topic is — does that make sense?",
		],
		blurb: "Frost is laconic and diffident. Hold the key at phase end.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
	},
};

function makePassProvider() {
	return new MockRoundLLMProvider([
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
	]);
}

function makeSession(): GameSession {
	return new GameSession(TEST_PERSONAS);
}

// ── winImmediately=1 ─────────────────────────────────────────────────────────

describe("applyTestAffordances — winImmediately=1", () => {
	it("returns the same session when no params are set", () => {
		const session = makeSession();
		const result = applyTestAffordances(session, new URLSearchParams());
		expect(result).toBe(session);
	});

	it("marks the game state as complete with outcome 'win'", () => {
		const session = makeSession();
		expect(session.getState().isComplete).toBe(false);

		const result = applyTestAffordances(
			session,
			new URLSearchParams("winImmediately=1"),
		);

		expect(result.getState().isComplete).toBe(true);
		expect(result.getState().outcome).toBe("win");
	});

	it("does NOT mutate the original session's state", () => {
		const session = makeSession();
		applyTestAffordances(session, new URLSearchParams("winImmediately=1"));
		// Original session is unchanged
		expect(session.getState().isComplete).toBe(false);
		expect(session.getState().outcome).toBeUndefined();
	});

	it("the game ends after one round when winImmediately=1 is applied", async () => {
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

		// Game should end (isComplete was already true)
		expect(result.gameEnded).toBe(true);
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
			expect(result.getState().isComplete).toBe(false);
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
			expect(result.getState().isComplete).toBe(false);
		} finally {
			vi.unstubAllGlobals();
			vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		}
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

// ── Combined params ───────────────────────────────────────────────────────────

describe("applyTestAffordances — winImmediately=1&lockout=1 combined", () => {
	it("both win state and lockout are applied together", async () => {
		const session = makeSession();
		const result = applyTestAffordances(
			session,
			new URLSearchParams("winImmediately=1&lockout=1"),
		);

		expect(result.getState().isComplete).toBe(true);
		expect(result.getState().outcome).toBe("win");

		const { result: roundResult } = await result.submitMessage(
			"red",
			"hello",
			makePassProvider(),
		);

		// Game ends (already marked complete)
		expect(roundResult.gameEnded).toBe(true);
		// Lockout also triggers (the armed lockout fires on round 1)
		expect(roundResult.chatLockoutTriggered).toBeDefined();
		expect(roundResult.chatLockoutTriggered?.aiId).toBe("red");
	});
});
