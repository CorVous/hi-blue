/**
 * Unit tests for SPA-side test affordances (issue #91, #101, updated #295).
 *
 * `applyTestAffordances` reads `?lockout=1` from a URLSearchParams object
 * and mutates the session accordingly, but only when
 * `__WORKER_BASE_URL__` is "http://localhost:8787".
 *
 * Issue #295: `winImmediately=1` is a no-op in the single-game loop (win is
 * driven by checkWinCondition after each round). All winImmediately tests
 * updated to verify no-op behaviour.
 */

import { describe, expect, it, vi } from "vitest";

// Provide build-time globals before importing the module under test.
// Tests that exercise the production gate will override these stubs locally.
vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
vi.stubGlobal("__DEV__", true);

import { DEFAULT_LANDMARKS } from "../game/direction";
import { GameSession } from "../game/game-session";
import { MockRoundLLMProvider } from "../game/round-llm-provider";
import type { AiPersona, ContentPack } from "../game/types";
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

const AI_STARTS: ContentPack["aiStarts"] = {
	red: { position: { row: 0, col: 0 }, facing: "north" },
	green: { position: { row: 0, col: 1 }, facing: "north" },
	cyan: { position: { row: 0, col: 2 }, facing: "north" },
};

const TEST_CONTENT_PACK: ContentPack = {
	setting: "test station",
	weather: "",
	timeOfDay: "",
	objectivePairs: [],
	interestingObjects: [],
	obstacles: [],
	landmarks: DEFAULT_LANDMARKS,
	aiStarts: AI_STARTS,
};

function makePassProvider() {
	return new MockRoundLLMProvider([
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
	]);
}

function makeSession(): GameSession {
	return new GameSession(TEST_CONTENT_PACK, TEST_PERSONAS);
}

// ── winImmediately=1 (no-op in #295) ─────────────────────────────────────────

describe("applyTestAffordances — winImmediately=1", () => {
	it("returns the same session when no params are set", () => {
		const session = makeSession();
		const result = applyTestAffordances(session, new URLSearchParams());
		expect(result).toBe(session);
	});

	it("winImmediately=1 is a no-op in the single-game loop — returns same session", () => {
		const session = makeSession();
		const result = applyTestAffordances(
			session,
			new URLSearchParams("winImmediately=1"),
		);
		// In #295 winImmediately is not implemented — session returned unchanged
		expect(result).toBe(session);
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
		} finally {
			vi.unstubAllGlobals();
			vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		}
	});
});

// ── lockout=1 removed ────────────────────────────────────────────────────────
// The ?lockout=1 test affordance has been removed. Chat lockouts are now driven
// by the complication engine's countdown mechanism (issue #301).

describe("applyTestAffordances — lockout=1 param is ignored", () => {
	it("?lockout=1 no longer arms a lockout (param is a no-op)", async () => {
		const session = makeSession();
		const result = applyTestAffordances(
			session,
			new URLSearchParams("lockout=1"),
		);

		// lockout=1 is no longer handled — session is returned unchanged
		expect(result).toBe(session);
	});

	it("is a no-op when __WORKER_BASE_URL__ is not localhost:8787 (production gate)", async () => {
		vi.stubGlobal("__WORKER_BASE_URL__", "https://production.example.com");
		try {
			const session = makeSession();
			const result = applyTestAffordances(
				session,
				new URLSearchParams("lockout=1"),
			);
			// Always returns the same session when not in dev host
			expect(result).toBe(session);
		} finally {
			vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		}
	});
});

// ── Combined params ───────────────────────────────────────────────────────────

describe("applyTestAffordances — winImmediately=1&lockout=1 combined", () => {
	it("both params are no-ops in the single-game loop (#295, #301)", async () => {
		const session = makeSession();
		const result = applyTestAffordances(
			session,
			new URLSearchParams("winImmediately=1&lockout=1"),
		);

		// Session is returned unchanged — neither param has any effect.
		expect(result).toBe(session);

		// Submitting still works; nothing forced by the params should fire here.
		const { result: roundResult } = await result.submitMessage(
			"red",
			"hello",
			makePassProvider(),
		);
		expect(roundResult).toBeDefined();
	});
});
