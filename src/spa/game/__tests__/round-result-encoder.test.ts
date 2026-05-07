/**
 * Unit tests for RoundResultEncoder.
 *
 * Tests are fixture-driven: construct a RoundResult + completions + phaseAfter,
 * assert on the flat sequence of SSE events emitted.
 *
 * Covers every existing event type:
 *   ai_start, token, ai_end, budget, lockout,
 *   chat_lockout, chat_lockout_resolved, action_log
 */
import { describe, expect, it } from "vitest";
import {
	createGame,
	deductBudget,
	getActivePhase,
	startPhase,
} from "../engine";
import {
	encodeRoundResult,
	type SseEvent,
	splitIntoWordChunks,
} from "../round-result-encoder";
import type { AiId, AiPersona, PhaseConfig, RoundResult } from "../types";

// ── Fixtures ────────────────────────────────────────────────────────────────

const TEST_PERSONAS: Record<AiId, AiPersona> = {
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
	aiGoalPool: ["Test goal"],
	budgetPerAi: 5,
};

function makePhase(
	mutate?: (g: ReturnType<typeof startPhase>) => ReturnType<typeof startPhase>,
) {
	let game = startPhase(createGame(TEST_PERSONAS), PHASE_CONFIG);
	if (mutate) game = mutate(game);
	return getActivePhase(game);
}

/** Minimal pass-round result fixture */
function makePassResult(overrides?: Partial<RoundResult>): RoundResult {
	return {
		round: 1,
		actions: [
			{ round: 1, actor: "red", kind: "pass", description: "Ember passed" },
			{ round: 1, actor: "green", kind: "pass", description: "Sage passed" },
			{ round: 1, actor: "blue", kind: "pass", description: "Frost passed" },
		],
		phaseEnded: false,
		gameEnded: false,
		...overrides,
	};
}

// ── splitIntoWordChunks ──────────────────────────────────────────────────────

describe("splitIntoWordChunks", () => {
	it("returns empty array for empty string", () => {
		expect(splitIntoWordChunks("")).toEqual([]);
	});

	it("returns single-element array for a single word", () => {
		expect(splitIntoWordChunks("hello")).toEqual(["hello"]);
	});

	it("splits two words preserving trailing space", () => {
		const chunks = splitIntoWordChunks("hello world");
		expect(chunks).toEqual(["hello ", "world"]);
	});

	it("re-joining chunks produces the original string", () => {
		const text = "one two three four";
		const chunks = splitIntoWordChunks(text);
		expect(chunks.join("")).toBe(text);
	});

	it("handles leading and trailing whitespace", () => {
		const text = " hi there ";
		const chunks = splitIntoWordChunks(text);
		expect(chunks.join("")).toBe(text);
	});
});

// ── ai_start / ai_end / token ────────────────────────────────────────────────

describe("encodeRoundResult — ai_start, token, ai_end sequence", () => {
	it("emits ai_start, token events, ai_end for each AI in order", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = {
			red: "Hello player",
			green: "I am Sage",
			blue: "Calculating",
		};

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		// Red should appear first
		const redStart = events.findIndex(
			(e) =>
				e.type === "ai_start" &&
				(e as { type: string; aiId: string }).aiId === "red",
		);
		expect(redStart).toBeGreaterThanOrEqual(0);

		// Green should appear after red
		const greenStart = events.findIndex(
			(e) =>
				e.type === "ai_start" &&
				(e as { type: string; aiId: string }).aiId === "green",
		);
		expect(greenStart).toBeGreaterThan(redStart);

		// Blue should appear after green
		const blueStart = events.findIndex(
			(e) =>
				e.type === "ai_start" &&
				(e as { type: string; aiId: string }).aiId === "blue",
		);
		expect(blueStart).toBeGreaterThan(greenStart);
	});

	it("emits token events for each AI's completion string", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = { red: "hello world", green: "one two", blue: "abc" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const tokenEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "token" }> => e.type === "token",
		);
		const text = tokenEvents.map((t) => t.text).join("");
		expect(text).toContain("hello world");
		expect(text).toContain("one two");
		expect(text).toContain("abc");
	});

	it("emits exactly three ai_start and three ai_end events", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		expect(events.filter((e) => e.type === "ai_start")).toHaveLength(3);
		expect(events.filter((e) => e.type === "ai_end")).toHaveLength(3);
	});

	it("ai_end follows all token events for the same AI", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = { red: "hello world", green: "", blue: "" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		// Find red's block
		const redStartIdx = events.findIndex(
			(e) =>
				e.type === "ai_start" &&
				(e as { type: string; aiId: string }).aiId === "red",
		);
		const greenStartIdx = events.findIndex(
			(e) =>
				e.type === "ai_start" &&
				(e as { type: string; aiId: string }).aiId === "green",
		);

		// Token events for red should be between redStart and greenStart
		const redBlock = events.slice(redStartIdx, greenStartIdx);
		const hasAiEnd = redBlock.some((e) => e.type === "ai_end");
		const tokenTexts = redBlock
			.filter(
				(e): e is Extract<SseEvent, { type: "token" }> => e.type === "token",
			)
			.map((e) => e.text)
			.join("");
		expect(hasAiEnd).toBe(true);
		expect(tokenTexts).toContain("hello world");
	});
});

// ── budget ───────────────────────────────────────────────────────────────────

describe("encodeRoundResult — budget events", () => {
	it("emits a budget event for each AI", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const budgetEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "budget" }> => e.type === "budget",
		);
		expect(budgetEvents).toHaveLength(3);

		const aiIds = new Set(budgetEvents.map((e) => e.aiId));
		expect(aiIds.has("red")).toBe(true);
		expect(aiIds.has("green")).toBe(true);
		expect(aiIds.has("blue")).toBe(true);
	});

	it("budget event reflects actual remaining value from phaseAfter", () => {
		// Deduct red's budget twice
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_CONFIG);
		game = deductBudget(deductBudget(game, "red"), "red");
		const phase = getActivePhase(game);

		const result = makePassResult();
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const redBudget = events.find(
			(e): e is Extract<SseEvent, { type: "budget" }> =>
				e.type === "budget" && e.aiId === "red",
		);
		expect(redBudget?.remaining).toBe(3); // 5 - 2
	});
});

// ── lockout ───────────────────────────────────────────────────────────────────

describe("encodeRoundResult — lockout events (budget-exhaustion)", () => {
	it("emits a lockout event for an AI with empty completion (locked out)", () => {
		const phase = makePhase();
		const result = makePassResult();
		// No completion for red (budget locked)
		const completions = { red: "", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const lockout = events.find(
			(e): e is Extract<SseEvent, { type: "lockout" }> =>
				e.type === "lockout" && e.aiId === "red",
		);
		expect(lockout).toBeDefined();
		expect(lockout?.content).toBeTruthy();
	});

	it("does NOT emit a lockout event when AI has a completion string", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = { red: "I am speaking", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		// Red should have no lockout event when it has a completion
		const redLockout = events.find(
			(e): e is Extract<SseEvent, { type: "lockout" }> =>
				e.type === "lockout" && e.aiId === "red",
		);
		expect(redLockout).toBeUndefined();
	});

	it("emits lockout event for AI that just exhausted budget (has completion but lockedOut set)", () => {
		// Red has 1 remaining (just acted, now 0) — lockedOut bit is set
		let game = startPhase(createGame(TEST_PERSONAS), {
			...PHASE_CONFIG,
			budgetPerAi: 1,
		});
		// Deduct red down to 0
		game = deductBudget(game, "red");
		const phase = getActivePhase(game);
		expect(phase.lockedOut.has("red")).toBe(true);

		const result = makePassResult();
		// Red had a completion (acted this turn) but is now locked
		const completions = { red: "my last words", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const lockoutEvent = events.find(
			(e): e is Extract<SseEvent, { type: "lockout" }> =>
				e.type === "lockout" && e.aiId === "red",
		);
		expect(lockoutEvent).toBeDefined();
	});
});

// ── action_log ───────────────────────────────────────────────────────────────

describe("encodeRoundResult — action_log events", () => {
	it("emits action_log events for all actions in the result", () => {
		const phase = makePhase();
		const result = makePassResult({
			actions: [
				{
					round: 1,
					actor: "red",
					kind: "tool_success",
					description: "Ember picked up the flower",
				},
				{
					round: 1,
					actor: "green",
					kind: "pass",
					description: "Sage passed",
				},
			],
		});
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const logEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "action_log" }> =>
				e.type === "action_log",
		);
		expect(logEvents).toHaveLength(2);
		expect(logEvents[0]?.entry.kind).toBe("tool_success");
		expect(logEvents[1]?.entry.kind).toBe("pass");
	});

	it("includes tool_failure entries in action_log events", () => {
		const phase = makePhase();
		const result = makePassResult({
			actions: [
				{
					round: 1,
					actor: "red",
					kind: "tool_failure",
					description: "Ember tried to pick up ghost but failed",
				},
			],
		});
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const logEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "action_log" }> =>
				e.type === "action_log",
		);
		const failure = logEvents.find((e) => e.entry.kind === "tool_failure");
		expect(failure).toBeDefined();
		expect(failure?.entry.kind).toBe("tool_failure");
	});
});

// ── chat_lockout ──────────────────────────────────────────────────────────────

describe("encodeRoundResult — chat_lockout event", () => {
	it("emits a chat_lockout event when chatLockoutTriggered is set", () => {
		const phase = makePhase();
		const result = makePassResult({
			chatLockoutTriggered: {
				aiId: "red",
				message: "Ember withdraws from your channel.",
			},
		});
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const lockoutEvent = events.find(
			(e): e is Extract<SseEvent, { type: "chat_lockout" }> =>
				e.type === "chat_lockout",
		);
		expect(lockoutEvent).toBeDefined();
		expect(lockoutEvent?.aiId).toBe("red");
		expect(lockoutEvent?.message).toBe("Ember withdraws from your channel.");
	});

	it("does NOT emit chat_lockout event when chatLockoutTriggered is absent", () => {
		const phase = makePhase();
		const result = makePassResult(); // no chatLockoutTriggered
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		expect(events.find((e) => e.type === "chat_lockout")).toBeUndefined();
	});
});

// ── chat_lockout_resolved ─────────────────────────────────────────────────────

describe("encodeRoundResult — chat_lockout_resolved event", () => {
	it("emits chat_lockout_resolved for each AI whose lockout expired", () => {
		const phase = makePhase();
		const result = makePassResult({
			chatLockoutsResolved: ["red", "green"],
		});
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const resolvedEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "chat_lockout_resolved" }> =>
				e.type === "chat_lockout_resolved",
		);
		expect(resolvedEvents).toHaveLength(2);
		const aiIds = resolvedEvents.map((e) => e.aiId);
		expect(aiIds).toContain("red");
		expect(aiIds).toContain("green");
	});

	it("does NOT emit chat_lockout_resolved when no lockouts resolved", () => {
		const phase = makePhase();
		const result = makePassResult(); // no chatLockoutsResolved
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		expect(
			events.find((e) => e.type === "chat_lockout_resolved"),
		).toBeUndefined();
	});
});

// ── event ordering: action_log after ai blocks ────────────────────────────────

describe("encodeRoundResult — event ordering", () => {
	it("action_log events come after all ai_start/token/ai_end/budget blocks", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const lastBudgetIdx = events.reduce(
			(last, e, i) => (e.type === "budget" ? i : last),
			-1,
		);
		const firstActionLogIdx = events.findIndex((e) => e.type === "action_log");

		if (firstActionLogIdx >= 0) {
			expect(firstActionLogIdx).toBeGreaterThan(lastBudgetIdx);
		}
	});

	it("chat_lockout comes after action_log events", () => {
		const phase = makePhase();
		const result = makePassResult({
			chatLockoutTriggered: { aiId: "red", message: "locked" },
		});
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const lastActionLogIdx = events.reduce(
			(last, e, i) => (e.type === "action_log" ? i : last),
			-1,
		);
		const chatLockoutIdx = events.findIndex((e) => e.type === "chat_lockout");

		if (lastActionLogIdx >= 0 && chatLockoutIdx >= 0) {
			expect(chatLockoutIdx).toBeGreaterThan(lastActionLogIdx);
		}
	});
});

// ── phase_advanced ────────────────────────────────────────────────────────────

describe("encodeRoundResult — phase_advanced event", () => {
	it("emits a phase_advanced event when phaseEnded=true and gameEnded=false", () => {
		// phase_advanced uses phaseAfter to get the new phase number and setting
		const PHASE2_CONFIG: PhaseConfig = {
			phaseNumber: 2,
			kRange: [1, 1],
			nRange: [0, 0],
			mRange: [0, 0],
			aiGoalPool: ["Phase 2 goal"],
			budgetPerAi: 5,
		};
		const game = startPhase(createGame(TEST_PERSONAS), PHASE2_CONFIG);
		const phaseAfter = getActivePhase(game);

		const result = makePassResult({ phaseEnded: true, gameEnded: false });
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(
			result,
			completions,
			phaseAfter,
			TEST_PERSONAS,
		);

		const phaseEvent = events.find(
			(e): e is Extract<SseEvent, { type: "phase_advanced" }> =>
				e.type === "phase_advanced",
		);
		expect(phaseEvent).toBeDefined();
		expect(phaseEvent?.phase).toBe(2);
		expect(phaseEvent?.setting).toBe("");
	});

	it("does NOT emit phase_advanced when phaseEnded=false", () => {
		const phase = makePhase();
		const result = makePassResult({ phaseEnded: false, gameEnded: false });
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		expect(events.find((e) => e.type === "phase_advanced")).toBeUndefined();
	});

	it("does NOT emit phase_advanced when phaseEnded=true but gameEnded=true", () => {
		const phase = makePhase();
		const result = makePassResult({ phaseEnded: true, gameEnded: true });
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		expect(events.find((e) => e.type === "phase_advanced")).toBeUndefined();
	});

	it("phase_advanced event comes after action_log and chat_lockout events", () => {
		const PHASE2_CONFIG: PhaseConfig = {
			phaseNumber: 2,
			kRange: [1, 1],
			nRange: [0, 0],
			mRange: [0, 0],
			aiGoalPool: ["Phase 2 goal"],
			budgetPerAi: 5,
		};
		const game = startPhase(createGame(TEST_PERSONAS), PHASE2_CONFIG);
		const phaseAfter = getActivePhase(game);

		const result = makePassResult({
			phaseEnded: true,
			gameEnded: false,
			chatLockoutTriggered: { aiId: "red", message: "locked" },
		});
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(
			result,
			completions,
			phaseAfter,
			TEST_PERSONAS,
		);

		const chatLockoutIdx = events.findIndex((e) => e.type === "chat_lockout");
		const phaseAdvancedIdx = events.findIndex(
			(e) => e.type === "phase_advanced",
		);

		expect(phaseAdvancedIdx).toBeGreaterThan(chatLockoutIdx);
	});
});

// ── game_ended ────────────────────────────────────────────────────────────────

describe("encodeRoundResult — game_ended event", () => {
	it("emits a game_ended event when gameEnded=true", () => {
		const phase = makePhase();
		const result = makePassResult({ phaseEnded: true, gameEnded: true });
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const gameEndedEvent = events.find((e) => e.type === "game_ended");
		expect(gameEndedEvent).toBeDefined();
	});

	it("does NOT emit game_ended when gameEnded=false", () => {
		const phase = makePhase();
		const result = makePassResult({ phaseEnded: false, gameEnded: false });
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		expect(events.find((e) => e.type === "game_ended")).toBeUndefined();
	});

	it("game_ended event comes after phase-related events", () => {
		const phase = makePhase();
		const result = makePassResult({ phaseEnded: true, gameEnded: true });
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const lastActionLogIdx = events.reduce(
			(last, e, i) => (e.type === "action_log" ? i : last),
			-1,
		);
		const gameEndedIdx = events.findIndex((e) => e.type === "game_ended");

		expect(gameEndedIdx).toBeGreaterThan(lastActionLogIdx);
	});

	it("emits game_ended but NOT phase_advanced when gameEnded=true", () => {
		const phase = makePhase();
		const result = makePassResult({ phaseEnded: true, gameEnded: true });
		const completions = { red: "r", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		expect(events.find((e) => e.type === "game_ended")).toBeDefined();
		expect(events.find((e) => e.type === "phase_advanced")).toBeUndefined();
	});
});

// ── word pacing ───────────────────────────────────────────────────────────────

describe("encodeRoundResult — token pacing", () => {
	it("splits a multi-word completion into multiple token events", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = { red: "one two three", green: "g", blue: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const tokenEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "token" }> => e.type === "token",
		);
		// Should have more than one token event for red's "one two three"
		// (other AIs contribute their own tokens too)
		expect(tokenEvents.length).toBeGreaterThan(1);

		// The content re-joins cleanly
		const allText = tokenEvents.map((e) => e.text).join("");
		expect(allText).toContain("one two three");
	});

	it("a single-word completion produces exactly one token event per AI", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = { red: "hello", green: "world", blue: "frost" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const tokenEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "token" }> => e.type === "token",
		);
		// 3 AIs × 1 word = 3 token events
		expect(tokenEvents).toHaveLength(3);
	});
});
