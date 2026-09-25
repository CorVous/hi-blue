import { describe, expect, it } from "vitest";
import { appendMessage, deductBudget, startGame } from "../engine";
import {
	encodeRoundResult,
	type SseEvent,
	splitIntoWordChunks,
} from "../round-result-encoder";
import type { AiId, AiPersona, RoundResult } from "../types";
import { makeTestPack } from "./fixtures/make-test-pack";

const TEST_PERSONAS: Record<AiId, AiPersona> = {
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

const TEST_CONTENT_PACK = makeTestPack([], { wallName: "wall" });

function makePhase(
	mutate?: (g: ReturnType<typeof startGame>) => ReturnType<typeof startGame>,
) {
	let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
	if (mutate) game = mutate(game);
	return game;
}

function makePhaseWithMessages(
	entries: Array<{ from: AiId | "blue"; to: AiId | "blue"; content: string }>,
): ReturnType<typeof makePhase> {
	let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
	for (const { from, to, content } of entries) {
		game = appendMessage(game, from, to, content);
	}
	return game;
}

function makePassResult(overrides?: Partial<RoundResult>): RoundResult {
	return {
		round: 1,
		actions: [
			{ round: 1, actor: "red", kind: "pass", description: "Ember passed" },
			{ round: 1, actor: "green", kind: "pass", description: "Sage passed" },
			{ round: 1, actor: "cyan", kind: "pass", description: "Frost passed" },
		],
		gameEnded: false,
		...overrides,
	};
}

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

describe("encodeRoundResult — ai_start, token, ai_end sequence", () => {
	it("emits ai_start, token events, ai_end for each AI in order", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = {
			red: "Hello player",
			green: "I am Sage",
			cyan: "Calculating",
		};

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const redStart = events.findIndex(
			(e) =>
				e.type === "ai_start" &&
				(e as { type: string; aiId: string }).aiId === "red",
		);
		expect(redStart).toBeGreaterThanOrEqual(0);

		const greenStart = events.findIndex(
			(e) =>
				e.type === "ai_start" &&
				(e as { type: string; aiId: string }).aiId === "green",
		);
		expect(greenStart).toBeGreaterThan(redStart);

		const cyanStart = events.findIndex(
			(e) =>
				e.type === "ai_start" &&
				(e as { type: string; aiId: string }).aiId === "cyan",
		);
		expect(cyanStart).toBeGreaterThan(greenStart);
	});

	it("emits message events for each AI's conversationLog entry (round-scoped, blue-involved)", () => {
		const phase = makePhaseWithMessages([
			{ from: "red", to: "blue", content: "hello world" },
			{ from: "green", to: "blue", content: "one two" },
			{ from: "cyan", to: "blue", content: "abc" },
		]);
		const result = makePassResult();
		const completions = {};

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const messageEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "message" }> => e.type === "message",
		);
		const contents = messageEvents.map((e) => e.content);
		expect(contents).toContain("hello world");
		expect(contents).toContain("one two");
		expect(contents).toContain("abc");
	});

	it("emits exactly three ai_start and three ai_end events", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = { red: "r", green: "g", cyan: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		expect(events.filter((e) => e.type === "ai_start")).toHaveLength(3);
		expect(events.filter((e) => e.type === "ai_end")).toHaveLength(3);
	});

	it("ai_end follows message events for the same AI", () => {
		const phase = makePhaseWithMessages([
			{ from: "red", to: "blue", content: "hello world" },
		]);
		const result = makePassResult();
		const completions = {};

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

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

		const redBlock = events.slice(redStartIdx, greenStartIdx);
		const hasAiEnd = redBlock.some((e) => e.type === "ai_end");
		const messageEvents = redBlock.filter(
			(e): e is Extract<SseEvent, { type: "message" }> => e.type === "message",
		);
		expect(hasAiEnd).toBe(true);
		expect(messageEvents.map((e) => e.content)).toContain("hello world");

		const msgIdx = redBlock.findIndex((e) => e.type === "message");
		const endIdx = redBlock.findIndex((e) => e.type === "ai_end");
		expect(endIdx).toBeGreaterThan(msgIdx);
	});
});

describe("encodeRoundResult — budget events", () => {
	it("emits a budget event for each AI", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = { red: "r", green: "g", cyan: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const budgetEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "budget" }> => e.type === "budget",
		);
		expect(budgetEvents).toHaveLength(3);

		const aiIds = new Set(budgetEvents.map((e) => e.aiId));
		expect(aiIds.has("red")).toBe(true);
		expect(aiIds.has("green")).toBe(true);
		expect(aiIds.has("cyan")).toBe(true);
	});

	it("budget event reflects actual remaining value from phaseAfter", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = deductBudget(deductBudget(game, "red", 1).game, "red", 1).game;
		const phase = game;

		const result = makePassResult();
		const completions = { red: "r", green: "g", cyan: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const redBudget = events.find(
			(e): e is Extract<SseEvent, { type: "budget" }> =>
				e.type === "budget" && e.aiId === "red",
		);
		expect(redBudget?.remaining).toBeCloseTo(3, 10);
	});
});

describe("encodeRoundResult — lockout events (budget-exhaustion)", () => {
	it("emits a lockout event when AI is budget-exhausted (lockedOut set)", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 1 });
		game = deductBudget(game, "red", 1).game;
		const phase = game;
		expect(phase.lockedOut.has("red")).toBe(true);

		const result = makePassResult();
		const completions = {};

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const lockout = events.find(
			(e): e is Extract<SseEvent, { type: "lockout" }> =>
				e.type === "lockout" && e.aiId === "red",
		);
		expect(lockout).toBeDefined();
		expect(lockout?.content).toBeTruthy();
	});

	it("does NOT emit a lockout event when AI is not budget-locked-out", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = {};

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const redLockout = events.find(
			(e): e is Extract<SseEvent, { type: "lockout" }> =>
				e.type === "lockout" && e.aiId === "red",
		);
		expect(redLockout).toBeUndefined();
	});

	it("emits lockout event for AI that just exhausted budget (has completion but lockedOut set)", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 1 });
		game = deductBudget(game, "red", 1).game;
		const phase = game;
		expect(phase.lockedOut.has("red")).toBe(true);

		const result = makePassResult();
		const completions = { red: "my last words", green: "g", cyan: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const lockoutEvent = events.find(
			(e): e is Extract<SseEvent, { type: "lockout" }> =>
				e.type === "lockout" && e.aiId === "red",
		);
		expect(lockoutEvent).toBeDefined();
	});
});

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
		const completions = { red: "r", green: "g", cyan: "b" };

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
		const completions = { red: "r", green: "g", cyan: "b" };

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

describe("encodeRoundResult — chat_lockout event", () => {
	it("emits a chat_lockout event when chatLockoutTriggered is set", () => {
		const phase = makePhase();
		const result = makePassResult({
			chatLockoutTriggered: {
				aiId: "red",
				message: "Ember withdraws from your channel.",
			},
		});
		const completions = { red: "r", green: "g", cyan: "b" };

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
		const result = makePassResult();
		const completions = { red: "r", green: "g", cyan: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		expect(events.find((e) => e.type === "chat_lockout")).toBeUndefined();
	});
});

describe("encodeRoundResult — chat_lockout_resolved event", () => {
	it("emits chat_lockout_resolved for each AI whose lockout expired", () => {
		const phase = makePhase();
		const result = makePassResult({
			chatLockoutsResolved: ["red", "green"],
		});
		const completions = { red: "r", green: "g", cyan: "b" };

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
		const result = makePassResult();
		const completions = { red: "r", green: "g", cyan: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		expect(
			events.find((e) => e.type === "chat_lockout_resolved"),
		).toBeUndefined();
	});
});

describe("encodeRoundResult — event ordering", () => {
	it("action_log events come after all ai_start/token/ai_end/budget blocks", () => {
		const phase = makePhase();
		const result = makePassResult();
		const completions = { red: "r", green: "g", cyan: "b" };

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
		const completions = { red: "r", green: "g", cyan: "b" };

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

describe("encodeRoundResult — game_ended event", () => {
	it("emits a game_ended event when gameEnded=true", () => {
		const phase = makePhase();
		const result = makePassResult({ gameEnded: true });
		const completions = { red: "r", green: "g", cyan: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const gameEndedEvent = events.find((e) => e.type === "game_ended");
		expect(gameEndedEvent).toBeDefined();
	});

	it("does NOT emit game_ended when gameEnded=false", () => {
		const phase = makePhase();
		const result = makePassResult({ gameEnded: false });
		const completions = { red: "r", green: "g", cyan: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		expect(events.find((e) => e.type === "game_ended")).toBeUndefined();
	});

	it("game_ended event comes after phase-related events", () => {
		const phase = makePhase();
		const result = makePassResult({ gameEnded: true });
		const completions = { red: "r", green: "g", cyan: "b" };

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const lastActionLogIdx = events.reduce(
			(last, e, i) => (e.type === "action_log" ? i : last),
			-1,
		);
		const gameEndedIdx = events.findIndex((e) => e.type === "game_ended");

		expect(gameEndedIdx).toBeGreaterThan(lastActionLogIdx);
	});
});

describe("encodeRoundResult — message events from conversationLogs", () => {
	it("emits one message event per blue-involved conversationLog entry (round-scoped)", () => {
		const phase = makePhaseWithMessages([
			{ from: "red", to: "blue", content: "one two three" },
			{ from: "green", to: "blue", content: "hello world" },
			{ from: "cyan", to: "blue", content: "frost" },
		]);
		const result = makePassResult();
		const completions = {};

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const messageEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "message" }> => e.type === "message",
		);
		expect(messageEvents).toHaveLength(3);

		const contents = messageEvents.map((e) => e.content);
		expect(contents).toContain("one two three");
		expect(contents).toContain("hello world");
		expect(contents).toContain("frost");
	});

	it("emits exactly one message event per daemon when each has one entry", () => {
		const phase = makePhaseWithMessages([
			{ from: "red", to: "blue", content: "hello" },
			{ from: "green", to: "blue", content: "world" },
			{ from: "cyan", to: "blue", content: "frost" },
		]);
		const result = makePassResult();
		const completions = {};

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const messageEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "message" }> => e.type === "message",
		);
		expect(messageEvents).toHaveLength(3);
	});

	it("emits NO message events for daemon→daemon entries (DM-thread filter, AC #2)", () => {
		const phase = makePhaseWithMessages([
			{ from: "red", to: "green", content: "PEER_PEER_TAG" },
		]);
		const result = makePassResult();
		const completions = {};

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const messageEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "message" }> => e.type === "message",
		);
		expect(messageEvents).toHaveLength(0);

		const anyPeerEvent = events.some(
			(e) =>
				e.type === "message" &&
				(e as Extract<SseEvent, { type: "message" }>).content ===
					"PEER_PEER_TAG",
		);
		expect(anyPeerEvent).toBe(false);
	});

	it("emits message event for blue→daemon entry with correct from/to (AC #1)", () => {
		const phase = makePhaseWithMessages([
			{ from: "blue", to: "red", content: "player message" },
		]);
		const result = makePassResult();
		const completions = {};

		const events = encodeRoundResult(result, completions, phase, TEST_PERSONAS);

		const messageEvents = events.filter(
			(e): e is Extract<SseEvent, { type: "message" }> => e.type === "message",
		);
		expect(messageEvents).toHaveLength(1);
		expect(messageEvents[0]?.from).toBe("blue");
		expect(messageEvents[0]?.to).toBe("red");
		expect(messageEvents[0]?.content).toBe("player message");
	});
});
