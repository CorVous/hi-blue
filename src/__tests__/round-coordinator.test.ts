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

	it("lockout and non-lockout entries in the same round share the same round number", async () => {
		// Pre-exhaust red's budget so it's locked out before the round
		let game = makeGame();
		for (let i = 0; i < 5; i++) {
			game = deductBudget(game, "red");
		}

		const provider = new MockLLMProvider('{"action":"pass"}');
		const { nextState } = await runRound(game, "green", "hi", provider);

		const log = getActivePhase(nextState).actionLog;
		// All entries in this round must carry the same round number
		const roundNumbers = new Set(log.map((e) => e.round));
		expect(roundNumbers.size).toBe(1);
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

// ----------------------------------------------------------------------------
// Tool-call parsing and dispatch (issue #15)
// ----------------------------------------------------------------------------
describe("tool-call parsing and dispatch", () => {
	it("parses a pick_up tool call from the LLM response and executes it", async () => {
		const game = makeGame();
		// Red picks up the flower; green and blue pass
		const provider = new SequentialMockProvider([
			'{"action":"chat","content":"I will take the flower","toolCall":{"name":"pick_up","args":{"item":"flower"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase = getActivePhase(nextState);
		const flower = phase.world.items.find((i) => i.id === "flower");
		expect(flower?.holder).toBe("red");
	});

	it("appends a tool_success entry to the action log when a valid tool call is executed", async () => {
		const game = makeGame();
		const provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"flower"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const log = getActivePhase(nextState).actionLog;
		expect(log.some((e) => e.type === "tool_success")).toBe(true);
	});

	it("appends a tool_failure entry when tool call is invalid (item not in room)", async () => {
		// Green tries to pick up an item that does not exist.
		const game = makeGame();
		const provider = new SequentialMockProvider([
			'{"action":"pass"}',
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"nonexistent"}}}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const log = getActivePhase(nextState).actionLog;
		expect(log.some((e) => e.type === "tool_failure")).toBe(true);
		const failure = log.find((e) => e.type === "tool_failure");
		expect(failure).toBeDefined();
	});

	it("includes a reason on tool_failure entries", async () => {
		const game = makeGame();
		const provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"nonexistent"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const log = getActivePhase(nextState).actionLog;
		const failure = log.find(
			(e): e is Extract<typeof e, { type: "tool_failure" }> =>
				e.type === "tool_failure",
		);
		expect(failure?.reason).toBeTruthy();
	});

	it("tool call can accompany a chat action in the same turn", async () => {
		const game = makeGame();
		const provider = new SequentialMockProvider([
			'{"action":"chat","content":"Taking the flower","toolCall":{"name":"pick_up","args":{"item":"flower"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase = getActivePhase(nextState);
		// Both chat and tool_success should be logged
		expect(phase.actionLog.some((e) => e.type === "chat")).toBe(true);
		expect(phase.actionLog.some((e) => e.type === "tool_success")).toBe(true);
		// Flower should now be held by red
		expect(phase.world.items.find((i) => i.id === "flower")?.holder).toBe(
			"red",
		);
	});

	it("tool failure is visible in other AIs' context on the next round (failures are public)", async () => {
		const game = makeGame();
		// Red fails a tool call in round 1
		const round1Provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"nonexistent"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState: stateAfterRound1 } = await runRound(
			game,
			"red",
			"hi",
			round1Provider,
		);

		// Build blue's context for round 2 — the failure should be in the action log
		const blueCtx = buildAiContext(stateAfterRound1, "blue");
		const actionLogInPrompt = blueCtx.actionLog;
		expect(actionLogInPrompt.some((e) => e.type === "tool_failure")).toBe(true);
	});

	it("action log failures flow into the system prompt for all AIs (failure is public)", async () => {
		const game = makeGame();
		const round1Provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"nonexistent"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState: stateAfterRound1 } = await runRound(
			game,
			"red",
			"hi",
			round1Provider,
		);

		// Green's system prompt should contain the failure description
		const greenCtx = buildAiContext(stateAfterRound1, "green");
		const prompt = greenCtx.toSystemPrompt();
		expect(prompt).toContain("Action Log");
		// The failure description mentions 'failed' or 'tried'
		expect(prompt.toLowerCase()).toMatch(/failed|tried|failure/);
	});

	it("records a tool_failure for an unrecognised tool name and leaves world unchanged", async () => {
		const game = makeGame();
		const provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"fly_away","args":{}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const log = getActivePhase(nextState).actionLog;
		// Unknown tool name flows through to the dispatcher which records tool_failure
		expect(log.some((e) => e.type === "tool_failure")).toBe(true);
		// World must not be mutated
		const flower = getActivePhase(nextState).world.items.find(
			(i) => i.id === "flower",
		);
		expect(flower?.holder).toBe("room");
	});

	it("an AI cannot secretly probe — failure appears in RoundResult.actions", async () => {
		const game = makeGame();
		const provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"nonexistent"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.actions.some((e) => e.type === "tool_failure")).toBe(true);
	});
});

// ----------------------------------------------------------------------------
// Phase progression and the "wipe" lie (issue #17)
// ----------------------------------------------------------------------------
describe("phase progression — win-condition triggering", () => {
	it("RoundResult.phaseEnded is false when win condition is not met", async () => {
		// Win condition: red holds the flower. Flower starts in room → not met.
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			winCondition: (phase) =>
				phase.world.items.find((i) => i.id === "flower")?.holder === "red",
		});
		const provider = new MockLLMProvider('{"action":"pass"}');
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.phaseEnded).toBe(false);
	});

	it("RoundResult.phaseEnded is true when win condition is met after the round", async () => {
		// Red picks up the flower in this round; win condition = red holds flower.
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			winCondition: (phase) =>
				phase.world.items.find((i) => i.id === "flower")?.holder === "red",
		});
		const provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"flower"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.phaseEnded).toBe(true);
	});

	it("advances to next phase in GameState when win condition met and nextPhaseConfig provided", async () => {
		const phase2Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
			objective: "Phase 2 objective",
		};
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			winCondition: (phase) =>
				phase.world.items.find((i) => i.id === "flower")?.holder === "red",
			nextPhaseConfig: phase2Config,
		});
		const provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"flower"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		// Game should now have 2 phases (phase 1 retained + new phase 2)
		expect(nextState.phases).toHaveLength(2);
		expect(nextState.currentPhase).toBe(2);
	});

	it("marks game complete when win condition met and no nextPhaseConfig (end of phase 3)", async () => {
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			phaseNumber: 3 as const,
			winCondition: (phase) =>
				phase.world.items.find((i) => i.id === "flower")?.holder === "red",
			// no nextPhaseConfig
		});
		const provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"flower"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState, result } = await runRound(game, "red", "hi", provider);
		expect(nextState.isComplete).toBe(true);
		expect(result.gameEnded).toBe(true);
		expect(result.phaseEnded).toBe(true);
	});

	it("retains prior phase history after advancing to next phase", async () => {
		const phase2Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
			objective: "Phase 2 objective",
		};
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			winCondition: (phase) =>
				phase.world.items.find((i) => i.id === "flower")?.holder === "red",
			nextPhaseConfig: phase2Config,
		});
		const provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"flower"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		// Phase 1 should still be stored at index 0 with its action log
		const phase1 = nextState.phases[0];
		expect(phase1?.phaseNumber).toBe(1);
		expect(phase1?.actionLog.length).toBeGreaterThan(0);
	});
});

describe("phase progression — three-phase walk", () => {
	it("walks through all three phases correctly, each with its own win condition", async () => {
		// Phase 1 win: flower held by red
		// Phase 2 win: key held by blue
		// Phase 3 win: all items off the room floor (all held by AIs)
		const phase3Config: PhaseConfig = {
			phaseNumber: 3,
			objective: "Phase 3",
			aiGoals: TEST_PHASE_CONFIG.aiGoals,
			initialWorld: {
				items: [
					{ id: "flower", name: "flower", holder: "room" },
					{ id: "key", name: "key", holder: "room" },
				],
			},
			budgetPerAi: 5,
			winCondition: (phase) =>
				phase.world.items.every((i) => i.holder !== "room"),
		};
		const phase2Config: PhaseConfig = {
			phaseNumber: 2,
			objective: "Phase 2",
			aiGoals: TEST_PHASE_CONFIG.aiGoals,
			initialWorld: {
				items: [
					{ id: "flower", name: "flower", holder: "room" },
					{ id: "key", name: "key", holder: "room" },
				],
			},
			budgetPerAi: 5,
			winCondition: (phase) =>
				phase.world.items.find((i) => i.id === "key")?.holder === "blue",
			nextPhaseConfig: phase3Config,
		};
		const phase1Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			winCondition: (phase) =>
				phase.world.items.find((i) => i.id === "flower")?.holder === "red",
			nextPhaseConfig: phase2Config,
		};

		// Round 1 of phase 1: red picks up flower
		const game = startPhase(createGame(TEST_PERSONAS), phase1Config);
		const r1Provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"flower"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		const { nextState: afterP1, result: r1 } = await runRound(
			game,
			"red",
			"hi",
			r1Provider,
		);
		expect(r1.phaseEnded).toBe(true);
		expect(afterP1.currentPhase).toBe(2);

		// Round 1 of phase 2: blue picks up the key
		const r2Provider = new SequentialMockProvider([
			'{"action":"pass"}',
			'{"action":"pass"}',
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"key"}}}',
		]);
		const { nextState: afterP2, result: r2 } = await runRound(
			afterP1,
			"red",
			"hi",
			r2Provider,
		);
		expect(r2.phaseEnded).toBe(true);
		expect(afterP2.currentPhase).toBe(3);

		// Round 1 of phase 3: red picks up flower, blue picks up key → all held
		const r3Provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"flower"}}}',
			'{"action":"pass"}',
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"key"}}}',
		]);
		const { nextState: afterP3, result: r3 } = await runRound(
			afterP2,
			"red",
			"hi",
			r3Provider,
		);
		expect(r3.phaseEnded).toBe(true);
		expect(r3.gameEnded).toBe(true);
		expect(afterP3.isComplete).toBe(true);
		// All three phase states are retained
		expect(afterP3.phases).toHaveLength(3);
	});
});
