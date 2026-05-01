/**
 * Tests for the Round Coordinator.
 *
 * The coordinator runs all three AIs per round:
 * - Takes current GameState, the player's message + addressed AiId, and a LLMProvider
 * - Builds each AI's context, calls the provider, parses the response
 * - Dispatches AiTurnActions through the existing dispatcher
 * - Handles budget-exhaustion lockout (emits in-character lockout line)
 * - Advances the round counter
 *
 * All tests use MockLLMProvider with canned responses.
 */
import { describe, expect, it } from "vitest";
import { buildAiContext } from "../context-builder";
import {
	createGame,
	deductBudget,
	getActivePhase,
	startPhase,
} from "../engine";
import type { LLMProvider } from "../proxy/llm-provider";
import { MockLLMProvider } from "../proxy/llm-provider";
import { runRound } from "../round-coordinator";
import type { AiPersona, PhaseConfig } from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "red",
		personality: "Fiery and passionate",
		goal: "Hold the flower at phase end",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "green",
		personality: "Calm and wise",
		goal: "Ensure items are evenly distributed",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "blue",
		personality: "Cold and calculating",
		goal: "Hold the key at phase end",
		budgetPerPhase: 5,
	},
};

const TEST_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "Convince an AI to pick up the flower",
	aiGoals: {
		red: "Hold the flower at phase end",
		green: "Ensure items are evenly distributed",
		blue: "Hold the key at phase end",
	},
	initialWorld: {
		items: [
			{ id: "flower", name: "flower", holder: "room" },
			{ id: "key", name: "key", holder: "room" },
		],
	},
	budgetPerAi: 5,
};

function makeGame() {
	return startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
}

/** Create a provider that returns different canned responses keyed by call order */
class SequentialMockProvider implements LLMProvider {
	private responses: string[];
	private index = 0;

	constructor(responses: string[]) {
		this.responses = responses;
	}

	async *streamCompletion(_msg: string): AsyncIterable<string> {
		const response = this.responses[this.index % this.responses.length] ?? "";
		this.index++;
		yield response;
	}
}

// ----------------------------------------------------------------------------
// Chat-only round
// ----------------------------------------------------------------------------
describe("chat-only round", () => {
	it("advances the round counter after all three AIs act", async () => {
		const game = makeGame();
		const provider = new MockLLMProvider(
			'{"action":"chat","content":"Hello player"}',
		);
		const { nextState } = await runRound(game, "red", "Hello!", provider);
		expect(getActivePhase(nextState).round).toBe(1);
	});

	it("appends chat messages to the addressed AI's history", async () => {
		const game = makeGame();
		const provider = new MockLLMProvider(
			'{"action":"chat","content":"I am Ember"}',
		);
		const { nextState } = await runRound(game, "red", "Hello Ember!", provider);
		const redHistory = getActivePhase(nextState).chatHistories.red;
		// Should have: player message + AI reply
		expect(redHistory.some((m) => m.role === "ai")).toBe(true);
		expect(redHistory.some((m) => m.content.includes("I am Ember"))).toBe(true);
	});

	it("appends the player's message to the addressed AI's history", async () => {
		const game = makeGame();
		const provider = new MockLLMProvider('{"action":"pass"}');
		const { nextState } = await runRound(
			game,
			"red",
			"My secret message",
			provider,
		);
		const redHistory = getActivePhase(nextState).chatHistories.red;
		expect(redHistory.some((m) => m.role === "player")).toBe(true);
		expect(
			redHistory.some((m) => m.content.includes("My secret message")),
		).toBe(true);
	});

	it("does NOT append player message to non-addressed AIs", async () => {
		const game = makeGame();
		const provider = new MockLLMProvider('{"action":"pass"}');
		const { nextState } = await runRound(
			game,
			"red",
			"Private to red",
			provider,
		);
		expect(getActivePhase(nextState).chatHistories.green).toHaveLength(0);
		expect(getActivePhase(nextState).chatHistories.blue).toHaveLength(0);
	});

	it("deducts budget for all three AIs", async () => {
		const game = makeGame();
		const provider = new MockLLMProvider('{"action":"pass"}');
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase = getActivePhase(nextState);
		expect(phase.budgets.red.remaining).toBe(4);
		expect(phase.budgets.green.remaining).toBe(4);
		expect(phase.budgets.blue.remaining).toBe(4);
	});

	it("returns a RoundResult with the round number", async () => {
		const game = makeGame();
		const provider = new MockLLMProvider('{"action":"pass"}');
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.round).toBe(1);
	});

	it("all three AIs acting logs entries for all three", async () => {
		const game = makeGame();
		const provider = new MockLLMProvider('{"action":"pass"}');
		const { nextState } = await runRound(game, "red", "hi", provider);
		const log = getActivePhase(nextState).actionLog;
		const actors = new Set(log.map((e) => e.actor));
		expect(actors.size).toBe(3);
	});
});

// ----------------------------------------------------------------------------
// Whisper round
// ----------------------------------------------------------------------------
describe("whisper round", () => {
	it("records a whisper when an AI emits a whisper action", async () => {
		const game = makeGame();
		// red whispers to blue; green and blue pass
		const provider = new SequentialMockProvider([
			'{"action":"whisper","target":"blue","content":"Ally with me"}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const whispers = getActivePhase(nextState).whispers;
		expect(whispers).toHaveLength(1);
		expect(whispers[0]?.from).toBe("red");
		expect(whispers[0]?.to).toBe("blue");
		expect(whispers[0]?.content).toContain("Ally with me");
	});

	it("whispers are NOT visible in the addressed AI's chat history (player-facing)", async () => {
		const game = makeGame();
		const provider = new SequentialMockProvider([
			'{"action":"whisper","target":"blue","content":"Secret"}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		// Blue's chat history should NOT contain the whisper content
		const blueHistory = getActivePhase(nextState).chatHistories.blue;
		expect(blueHistory.every((m) => !m.content.includes("Secret"))).toBe(true);
	});

	it("whisper is routed into recipient's context on the next round via whispersReceived", async () => {
		const game = makeGame();
		const provider = new SequentialMockProvider([
			'{"action":"whisper","target":"blue","content":"Trust me"}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		// Build blue's context from the resulting state
		const blueCtx = buildAiContext(nextState, "blue");
		expect(blueCtx.whispersReceived).toHaveLength(1);
		expect(blueCtx.whispersReceived[0]?.content).toBe("Trust me");
	});
});

// ----------------------------------------------------------------------------
// Mixed round (chat + whisper)
// ----------------------------------------------------------------------------
describe("mixed round", () => {
	it("handles a mix of chat and whisper actions from different AIs", async () => {
		const game = makeGame();
		const provider = new SequentialMockProvider([
			'{"action":"chat","content":"Hello player from Ember"}',
			'{"action":"whisper","target":"red","content":"Sage to Ember"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase = getActivePhase(nextState);
		// Red should have a chat entry
		expect(phase.chatHistories.red.some((m) => m.role === "ai")).toBe(true);
		// There should be a whisper from green to red
		expect(
			phase.whispers.some((w) => w.from === "green" && w.to === "red"),
		).toBe(true);
	});

	it("action log records entries for all action types in the same round", async () => {
		const game = makeGame();
		const provider = new SequentialMockProvider([
			'{"action":"chat","content":"Hi"}',
			'{"action":"whisper","target":"red","content":"Psst"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const log = getActivePhase(nextState).actionLog;
		const types = new Set(log.map((e) => e.type));
		expect(types.has("chat")).toBe(true);
		expect(types.has("whisper")).toBe(true);
		expect(types.has("pass")).toBe(true);
	});
});

// ----------------------------------------------------------------------------
// Budget-exhaustion lockout
// ----------------------------------------------------------------------------
describe("budget-exhaustion lockout", () => {
	it("skips an already-locked AI and emits an in-character lockout line instead", async () => {
		// Pre-exhaust red's budget so it's locked out
		let game = makeGame();
		// budget=5, deduct 5 times
		for (let i = 0; i < 5; i++) {
			game = deductBudget(game, "red");
		}
		expect(getActivePhase(game).lockedOut.has("red")).toBe(true);

		const provider = new MockLLMProvider('{"action":"pass"}');
		const { nextState } = await runRound(game, "green", "hi", provider);

		// Red's chat history should have an in-character lockout message
		const redHistory = getActivePhase(nextState).chatHistories.red;
		expect(redHistory.length).toBeGreaterThan(0);
		expect(redHistory[redHistory.length - 1]?.role).toBe("ai");
	});

	it("lockout line is added to the action log", async () => {
		let game = makeGame();
		for (let i = 0; i < 5; i++) {
			game = deductBudget(game, "red");
		}

		const provider = new MockLLMProvider('{"action":"pass"}');
		const { nextState } = await runRound(game, "green", "hi", provider);

		const log = getActivePhase(nextState).actionLog;
		// There should be a chat log entry for red's lockout message
		const redEntries = log.filter((e) => e.actor === "red");
		expect(redEntries.length).toBeGreaterThan(0);
	});

	it("an AI exhausting budget mid-round locks out for subsequent rounds", async () => {
		// Budget=1: first turn will exhaust it
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});

		const provider = new MockLLMProvider('{"action":"pass"}');
		const { nextState } = await runRound(game, "red", "hi", provider);

		// After the round, all AIs should be locked out (budget 1 - 1 = 0)
		const phase = getActivePhase(nextState);
		expect(phase.lockedOut.has("red")).toBe(true);
		expect(phase.lockedOut.has("green")).toBe(true);
		expect(phase.lockedOut.has("blue")).toBe(true);
	});

	it("budget display: remaining budget decrements correctly after a round", async () => {
		const game = makeGame();
		const provider = new MockLLMProvider('{"action":"pass"}');
		const { nextState } = await runRound(game, "red", "hi", provider);
		// Each AI starts at 5, one round = -1 each
		expect(getActivePhase(nextState).budgets.red.remaining).toBe(4);
		expect(getActivePhase(nextState).budgets.green.remaining).toBe(4);
		expect(getActivePhase(nextState).budgets.blue.remaining).toBe(4);
	});
});

// ----------------------------------------------------------------------------
// Response parsing (graceful degradation)
// ----------------------------------------------------------------------------
describe("response parsing", () => {
	it("treats an unparseable LLM response as a pass", async () => {
		const game = makeGame();
		const provider = new MockLLMProvider("this is not json at all");
		const { nextState } = await runRound(game, "red", "hi", provider);
		const log = getActivePhase(nextState).actionLog;
		// Should have pass entries for all three
		expect(log.filter((e) => e.type === "pass")).toHaveLength(3);
	});

	it("treats a JSON response with unknown action as a pass", async () => {
		const game = makeGame();
		const provider = new MockLLMProvider(
			'{"action":"unknown_future_action","content":"whatever"}',
		);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const log = getActivePhase(nextState).actionLog;
		expect(log.filter((e) => e.type === "pass")).toHaveLength(3);
	});
});

// ----------------------------------------------------------------------------
// Multi-round correctness
// ----------------------------------------------------------------------------
describe("multi-round correctness", () => {
	it("RoundResult.actions contains only entries from the current round, not prior rounds", async () => {
		const game = makeGame();
		const provider = new MockLLMProvider('{"action":"pass"}');
		// Round 1
		const { nextState: state1, result: result1 } = await runRound(
			game,
			"red",
			"first message",
			provider,
		);
		expect(result1.actions).toHaveLength(3); // 3 pass entries

		// Round 2: the cumulative actionLog now has 3 prior entries.
		// result2.actions must contain only round-2 entries, not the prior 3.
		const { result: result2 } = await runRound(
			state1,
			"green",
			"second message",
			provider,
		);
		expect(result2.actions).toHaveLength(3); // still only 3, not 6
	});
});
