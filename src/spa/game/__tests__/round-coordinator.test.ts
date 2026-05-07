/**
 * Tests for the Round Coordinator.
 *
 * The coordinator runs all three AIs per round:
 * - Takes current GameState, the player's message + addressed AiId, and a RoundLLMProvider
 * - Builds each AI's OpenAI messages, calls streamRound, translates the result
 * - Dispatches AiTurnActions through the existing dispatcher
 * - Handles budget-exhaustion lockout (emits in-character lockout line)
 * - Advances the round counter
 *
 * All tests use MockRoundLLMProvider with canned responses.
 */
import { describe, expect, it } from "vitest";
import type { OpenAiMessage } from "../../llm-client";
import {
	createGame,
	deductBudget,
	getActivePhase,
	isAiLockedOut,
	isPlayerChatLockedOut,
	startPhase,
} from "../engine";
import { buildAiContext } from "../prompt-builder";
import { runRound } from "../round-coordinator";
import type { RoundLLMProvider } from "../round-llm-provider";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { AiId, AiPersona, ContentPack, PhaseConfig } from "../types";

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

const TEST_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	kRange: [1, 1],
	nRange: [1, 1],
	mRange: [0, 0],
	aiGoalPool: [
		"Hold the flower at phase end",
		"Ensure items are evenly distributed",
		"Hold the key at phase end",
	],
	budgetPerAi: 5,
};

/**
 * ContentPack placing flower at (0,0), key at (0,1), with
 * red→(0,0), green→(0,1), blue→(0,2) facing north.
 */
const TEST_CONTENT_PACK: ContentPack = {
	phaseNumber: 1,
	setting: "",
	objectivePairs: [
		{
			object: {
				id: "flower",
				kind: "objective_object",
				name: "flower",
				examineDescription: "A flower",
				holder: { row: 0, col: 0 },
				pairsWithSpaceId: "flower_space",
			},
			space: {
				id: "flower_space",
				kind: "objective_space",
				name: "flower space",
				examineDescription: "A designated space",
				holder: { row: 4, col: 4 },
			},
		},
	],
	interestingObjects: [
		{
			id: "key",
			kind: "interesting_object",
			name: "key",
			examineDescription: "A key",
			holder: { row: 0, col: 1 },
		},
	],
	obstacles: [],
	aiStarts: {
		red: { position: { row: 0, col: 0 }, facing: "north" },
		green: { position: { row: 0, col: 1 }, facing: "north" },
		blue: { position: { row: 0, col: 2 }, facing: "north" },
	},
};

function makeGame() {
	return startPhase(
		createGame(TEST_PERSONAS, [TEST_CONTENT_PACK]),
		TEST_PHASE_CONFIG,
	);
}

// ----------------------------------------------------------------------------
// Chat-only round
// ----------------------------------------------------------------------------
describe("chat-only round", () => {
	it("advances the round counter after all three AIs act", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "Hello player", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "Hello!", provider);
		expect(getActivePhase(nextState).round).toBe(1);
	});

	it("appends chat messages to the addressed AI's history", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "I am Ember", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "Hello Ember!", provider);
		const redHistory = getActivePhase(nextState).chatHistories.red!;
		expect(redHistory.some((m) => m.role === "ai")).toBe(true);
		expect(redHistory.some((m) => m.content.includes("I am Ember"))).toBe(true);
	});

	it("appends the player's message to the addressed AI's history", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(
			game,
			"red",
			"My secret message",
			provider,
		);
		const redHistory = getActivePhase(nextState).chatHistories.red!;
		expect(redHistory.some((m) => m.role === "player")).toBe(true);
		expect(
			redHistory.some((m) => m.content.includes("My secret message")),
		).toBe(true);
	});

	it("does NOT append player message to non-addressed AIs", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
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
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase = getActivePhase(nextState);
		expect(phase.budgets.red?.remaining).toBe(4);
		expect(phase.budgets.green?.remaining).toBe(4);
		expect(phase.budgets.blue?.remaining).toBe(4);
	});

	it("returns a RoundResult with the round number", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.round).toBe(1);
	});

	it("all three AIs acting logs entries for all three", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		const actors = new Set(result.actions.map((e) => e.actor));
		expect(actors.size).toBe(3);
	});
});

// ----------------------------------------------------------------------------
// Whisper round
// NOTE: whispers are now implemented via assistantText containing "whisper to X: ..."
// The new coordinator maps assistantText → chat action. Whispers are no longer
// supported through the LLM (they were part of the old custom-JSON protocol).
// These tests are updated to reflect that whispers can only be sent via chat text.
// ----------------------------------------------------------------------------
describe("whisper round — via dispatcher only", () => {
	it("non-chat non-tool response produces a pass entry", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] }, // red passes
			{ assistantText: "", toolCalls: [] }, // green passes
			{ assistantText: "", toolCalls: [] }, // blue passes
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.actions.filter((e) => e.kind === "pass")).toHaveLength(3);
	});
});

// ----------------------------------------------------------------------------
// Budget-exhaustion lockout
// ----------------------------------------------------------------------------
describe("budget-exhaustion lockout", () => {
	it("skips an already-locked AI and emits an in-character lockout line instead", async () => {
		let game = makeGame();
		for (let i = 0; i < 5; i++) {
			game = deductBudget(game, "red");
		}
		expect(getActivePhase(game).lockedOut.has("red")).toBe(true);

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "green", "hi", provider);

		const redHistory = getActivePhase(nextState).chatHistories.red!;
		expect(redHistory.length).toBeGreaterThan(0);
		expect(redHistory[redHistory.length - 1]?.role).toBe("ai");
	});

	it("lockout line is added to the action log", async () => {
		let game = makeGame();
		for (let i = 0; i < 5; i++) {
			game = deductBudget(game, "red");
		}

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "green", "hi", provider);

		expect(
			result.actions.some((a) => a.actor === "red" && a.kind === "lockout"),
		).toBe(true);
	});

	it("an AI exhausting budget mid-round locks out for subsequent rounds", async () => {
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);

		const phase = getActivePhase(nextState);
		expect(phase.lockedOut.has("red")).toBe(true);
		expect(phase.lockedOut.has("green")).toBe(true);
		expect(phase.lockedOut.has("blue")).toBe(true);
	});

	it("budget display: remaining budget decrements correctly after a round", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		expect(getActivePhase(nextState).budgets.red?.remaining).toBe(4);
		expect(getActivePhase(nextState).budgets.green?.remaining).toBe(4);
		expect(getActivePhase(nextState).budgets.blue?.remaining).toBe(4);
	});

	it("lockout and non-lockout entries in the same round share the same round number", async () => {
		let game = makeGame();
		for (let i = 0; i < 5; i++) {
			game = deductBudget(game, "red");
		}

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "green", "hi", provider);

		const roundNumbers = new Set(result.actions.map((e) => e.round));
		expect(roundNumbers.size).toBe(1);
	});
});

// ----------------------------------------------------------------------------
// Multi-round correctness
// ----------------------------------------------------------------------------
describe("multi-round correctness", () => {
	it("RoundResult.actions contains only entries from the current round, not prior rounds", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		// Round 1
		const { nextState: state1, result: result1 } = await runRound(
			game,
			"red",
			"first message",
			provider,
		);
		expect(result1.actions).toHaveLength(3); // 3 pass entries

		// Round 2
		const provider2 = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result: result2 } = await runRound(
			state1,
			"green",
			"second message",
			provider2,
		);
		expect(result2.actions).toHaveLength(3); // still only 3, not 6
	});
});

// ----------------------------------------------------------------------------
// Tool-call dispatch (OpenAI tools protocol)
// ----------------------------------------------------------------------------
describe("tool-call dispatch", () => {
	it("pick_up tool call mutates world state when item is in the room", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "I will take the flower",
				toolCalls: [
					{
						id: "call_1",
						name: "pick_up",
						argumentsJson: '{"item":"flower"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase = getActivePhase(nextState);
		const flower = phase.world.entities.find((i) => i.id === "flower");
		expect(flower?.holder).toBe("red");
	});

	it("appends tool_success to action log when valid tool call executes", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_1",
						name: "pick_up",
						argumentsJson: '{"item":"flower"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.actions.some((e) => e.kind === "tool_success")).toBe(true);
	});

	it("appends tool_failure when item is not in room (pick_up on non-existent)", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_2",
						name: "pick_up",
						argumentsJson: '{"item":"nonexistent"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.actions.some((e) => e.kind === "tool_failure")).toBe(true);
	});

	it("tool_failure description is non-empty", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_3",
						name: "pick_up",
						argumentsJson: '{"item":"nonexistent"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		const failure = result.actions.find((e) => e.kind === "tool_failure");
		expect(failure?.description).toBeTruthy();
	});

	it("assistantText + toolCalls both fire (chat + tool_success in result.actions)", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "Taking the flower",
				toolCalls: [
					{
						id: "call_4",
						name: "pick_up",
						argumentsJson: '{"item":"flower"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState, result } = await runRound(game, "red", "hi", provider);
		expect(result.actions.some((e) => e.kind === "chat")).toBe(true);
		expect(result.actions.some((e) => e.kind === "tool_success")).toBe(true);
		expect(
			getActivePhase(nextState).world.entities.find((i) => i.id === "flower")
				?.holder,
		).toBe("red");
	});

	it("tool_failure is NOT exposed in any other AI's prompt the following round", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_fail",
						name: "pick_up",
						argumentsJson: '{"item":"nonexistent"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: stateAfterRound1 } = await runRound(
			game,
			"red",
			"hi",
			provider,
		);

		// Blue's prompt should NOT contain ## Action Log
		const blueCtx = buildAiContext(stateAfterRound1, "blue");
		const prompt = blueCtx.toSystemPrompt();
		expect(prompt).not.toContain("## Action Log");
	});

	it("tool_failure is NOT rendered into the system prompt for any AI", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_fail",
						name: "pick_up",
						argumentsJson: '{"item":"nonexistent"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: stateAfterRound1 } = await runRound(
			game,
			"red",
			"hi",
			provider,
		);

		// No AI's prompt should contain Action Log or the failure
		for (const aiId of ["red", "green", "blue"]) {
			const ctx = buildAiContext(stateAfterRound1, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Action Log");
		}
	});

	it("unknown tool name → tool_failure, world unchanged", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_unk",
						name: "fly_away",
						argumentsJson: "{}",
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState, result } = await runRound(game, "red", "hi", provider);
		// Unknown tool: parseToolCallArguments returns "Unknown tool" failure
		expect(result.actions.some((e) => e.kind === "tool_failure")).toBe(true);
		const flower = getActivePhase(nextState).world.entities.find(
			(i) => i.id === "flower",
		);
		// flower still on the ground (a GridPosition), not held by an AI
		expect(typeof flower?.holder).toBe("object");
	});

	it("malformed JSON → tool_failure with description matching /malformed/i", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_bad",
						name: "pick_up",
						argumentsJson: "not json",
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		const failure = result.actions.find((e) => e.kind === "tool_failure");
		expect(failure).toBeDefined();
		expect(failure?.description).toMatch(/malformed/i);
	});

	it("tool_failure surfaces in RoundResult for the SPA debug panel", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_probe",
						name: "pick_up",
						argumentsJson: '{"item":"nonexistent"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.actions.some((e) => e.kind === "tool_failure")).toBe(true);
	});

	it("next round messages include prior assistant{tool_calls} + matching tool result", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_r1",
						name: "pick_up",
						argumentsJson: '{"item":"flower"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		// Capture what gets passed to the provider
		const capturedCalls: Array<{
			messages: OpenAiMessage[];
		}> = [];
		const trackingProvider: RoundLLMProvider = {
			async streamRound(messages, _tools) {
				capturedCalls.push({ messages });
				// First 3 calls: use the mock results; subsequent: return pass
				const inner = capturedCalls.length <= 3 ? provider : undefined;
				if (inner) {
					return inner.streamRound(messages, _tools);
				}
				return { assistantText: "", toolCalls: [] };
			},
		};

		const { nextState: state1, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			trackingProvider,
		);

		// Round 2: pass the tool roundtrip back in
		capturedCalls.length = 0; // reset captures
		const provider2: RoundLLMProvider = {
			async streamRound(messages, _tools) {
				capturedCalls.push({ messages });
				return { assistantText: "", toolCalls: [] };
			},
		};
		await runRound(
			state1,
			"red",
			"round 2",
			provider2,
			undefined,
			undefined,
			toolRoundtrip,
		);

		// Red's round-2 messages (first call in round 2) should contain:
		// - system
		// - user (player message from round 1)
		// - assistant{tool_calls} from round 1
		// - tool result from round 1
		// - user (player message from round 2)
		const redMessages = capturedCalls[0]?.messages ?? [];
		const hasAssistantWithToolCalls = redMessages.some(
			(m) =>
				m.role === "assistant" &&
				"tool_calls" in m &&
				Array.isArray((m as { tool_calls?: unknown }).tool_calls),
		);
		const hasToolResult = redMessages.some((m) => m.role === "tool");
		expect(hasAssistantWithToolCalls).toBe(true);
		expect(hasToolResult).toBe(true);
	});

	it("availableTools(...) is sent on every provider call (filtered per AI)", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		await runRound(game, "red", "hi", provider);

		// All three AI calls should receive tools from availableTools
		expect(provider.calls).toHaveLength(3);
		// All three calls should include "look" in their tool list
		for (const call of provider.calls) {
			expect(call.tools).toBeDefined();
			expect(call.tools?.some((t) => t.function.name === "look")).toBe(true);
		}
	});
});

// ----------------------------------------------------------------------------
// Phase progression and the "wipe" lie
// ----------------------------------------------------------------------------
describe("phase progression — win-condition triggering", () => {
	it("RoundResult.phaseEnded is false when win condition is not met", async () => {
		const game = startPhase(createGame(TEST_PERSONAS, [TEST_CONTENT_PACK]), {
			...TEST_PHASE_CONFIG,
			winCondition: (phase) =>
				phase.world.entities.find((i) => i.id === "flower")?.holder === "red",
		});
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.phaseEnded).toBe(false);
	});

	it("RoundResult.phaseEnded is true when win condition is met after the round", async () => {
		const game = startPhase(createGame(TEST_PERSONAS, [TEST_CONTENT_PACK]), {
			...TEST_PHASE_CONFIG,
			winCondition: (phase) =>
				phase.world.entities.find((i) => i.id === "flower")?.holder === "red",
		});
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_win",
						name: "pick_up",
						argumentsJson: '{"item":"flower"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.phaseEnded).toBe(true);
	});

	it("advances to next phase when win condition met and nextPhaseConfig provided", async () => {
		const phase2Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
		};
		const game = startPhase(createGame(TEST_PERSONAS, [TEST_CONTENT_PACK]), {
			...TEST_PHASE_CONFIG,
			winCondition: (phase) =>
				phase.world.entities.find((i) => i.id === "flower")?.holder === "red",
			nextPhaseConfig: phase2Config,
		});
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_win",
						name: "pick_up",
						argumentsJson: '{"item":"flower"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		expect(nextState.phases).toHaveLength(2);
		expect(nextState.currentPhase).toBe(2);
	});

	it("marks game complete when win condition met and no nextPhaseConfig", async () => {
		const contentPackP3: ContentPack = { ...TEST_CONTENT_PACK, phaseNumber: 3 };
		const game = startPhase(createGame(TEST_PERSONAS, [contentPackP3]), {
			...TEST_PHASE_CONFIG,
			phaseNumber: 3 as const,
			winCondition: (phase) =>
				phase.world.entities.find((i) => i.id === "flower")?.holder === "red",
		});
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_win",
						name: "pick_up",
						argumentsJson: '{"item":"flower"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
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
		};
		const game = startPhase(createGame(TEST_PERSONAS, [TEST_CONTENT_PACK]), {
			...TEST_PHASE_CONFIG,
			winCondition: (phase) =>
				phase.world.entities.find((i) => i.id === "flower")?.holder === "red",
			nextPhaseConfig: phase2Config,
		});
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_win",
						name: "pick_up",
						argumentsJson: '{"item":"flower"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase1 = nextState.phases[0];
		expect(phase1?.phaseNumber).toBe(1);
		// Phase 1 chat history for red should have been populated (player message + AI turn)
		expect(phase1?.chatHistories.red?.length ?? 0).toBeGreaterThan(0);
	});
});

// ----------------------------------------------------------------------------
// Chat-lockout event
// ----------------------------------------------------------------------------
describe("chat lockout — coordinator triggering", () => {
	it("triggers a chat lockout at the configured round when RNG selects that round", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider, {
			rng: () => 0,
			lockoutTriggerRound: 1,
			lockoutDuration: 2,
		});
		expect(isPlayerChatLockedOut(nextState, "red")).toBe(true);
	});

	it("does not trigger a chat lockout before the configured round", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider, {
			rng: () => 0,
			lockoutTriggerRound: 2,
			lockoutDuration: 2,
		});
		expect(isPlayerChatLockedOut(nextState, "red")).toBe(false);
		expect(isPlayerChatLockedOut(nextState, "green")).toBe(false);
		expect(isPlayerChatLockedOut(nextState, "blue")).toBe(false);
	});

	it("locked AI still acts (takes turn, not budget-locked) while chat lockout is active", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider, {
			rng: () => 0,
			lockoutTriggerRound: 1,
			lockoutDuration: 2,
		});
		expect(isAiLockedOut(nextState, "red")).toBe(false);
		expect(getActivePhase(nextState).budgets.red?.remaining).toBe(4);
	});

	it("chat lockout resolves automatically after lockoutDuration rounds", async () => {
		const game = makeGame();
		const makeProvider = () =>
			new MockRoundLLMProvider([
				{ assistantText: "", toolCalls: [] },
				{ assistantText: "", toolCalls: [] },
				{ assistantText: "", toolCalls: [] },
			]);
		const lockoutCfg = {
			rng: () => 0,
			lockoutTriggerRound: 1,
			lockoutDuration: 2,
		};

		const { nextState: afterR1 } = await runRound(
			game,
			"red",
			"hi",
			makeProvider(),
			lockoutCfg,
		);
		expect(isPlayerChatLockedOut(afterR1, "red")).toBe(true);

		const { nextState: afterR2 } = await runRound(
			afterR1,
			"green",
			"hi",
			makeProvider(),
			lockoutCfg,
		);
		expect(isPlayerChatLockedOut(afterR2, "red")).toBe(true);

		const { nextState: afterR3 } = await runRound(
			afterR2,
			"green",
			"hi",
			makeProvider(),
			lockoutCfg,
		);
		expect(isPlayerChatLockedOut(afterR3, "red")).toBe(false);
	});

	it("RoundResult includes chatLockoutTriggered when lockout fires", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider, {
			rng: () => 0,
			lockoutTriggerRound: 1,
			lockoutDuration: 2,
		});
		expect(result.chatLockoutTriggered).toBeDefined();
		expect(result.chatLockoutTriggered?.aiId).toBe("red");
	});

	it("RoundResult chatLockoutTriggered is undefined when no lockout fires", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider, {
			rng: () => 0,
			lockoutTriggerRound: 5,
			lockoutDuration: 2,
		});
		expect(result.chatLockoutTriggered).toBeUndefined();
	});

	it("RoundResult includes chatLockoutResolved when a lockout expires this round", async () => {
		const game = makeGame();
		const makeProvider = () =>
			new MockRoundLLMProvider([
				{ assistantText: "", toolCalls: [] },
				{ assistantText: "", toolCalls: [] },
				{ assistantText: "", toolCalls: [] },
			]);
		const lockoutCfg = {
			rng: () => 0,
			lockoutTriggerRound: 1,
			lockoutDuration: 1,
		};

		const { nextState: afterR1 } = await runRound(
			game,
			"red",
			"hi",
			makeProvider(),
			lockoutCfg,
		);

		const { result: r2Result } = await runRound(
			afterR1,
			"green",
			"hi",
			makeProvider(),
			lockoutCfg,
		);
		expect(r2Result.chatLockoutsResolved).toBeDefined();
		expect(r2Result.chatLockoutsResolved).toContain("red");
	});
});

// ----------------------------------------------------------------------------
// Phase walk (three phases)
// ----------------------------------------------------------------------------
describe("phase progression — three-phase walk", () => {
	it("walks through all three phases correctly, each with its own win condition", async () => {
		// Items start held by the AIs so pick_up spatial validation is not needed.
		// Win conditions check holder by AI id, which is spatial-independent.
		// Phase 3 ContentPack: flower held by red, key held by blue (win already met)
		const contentPackP3: ContentPack = {
			phaseNumber: 3,
			setting: "",
			objectivePairs: [
				{
					object: {
						id: "flower",
						kind: "objective_object",
						name: "flower",
						examineDescription: "A flower",
						holder: "red",
						pairsWithSpaceId: "flower_space",
					},
					space: {
						id: "flower_space",
						kind: "objective_space",
						name: "flower space",
						examineDescription: "A space",
						holder: { row: 4, col: 4 },
					},
				},
			],
			interestingObjects: [
				{
					id: "key",
					kind: "interesting_object",
					name: "key",
					examineDescription: "A key",
					holder: "blue",
				},
			],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				blue: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		// Phase 2 ContentPack: key held by blue (win already met on first check)
		const contentPackP2: ContentPack = {
			phaseNumber: 2,
			setting: "",
			objectivePairs: [],
			interestingObjects: [
				{
					id: "key",
					kind: "interesting_object",
					name: "key",
					examineDescription: "A key",
					holder: "blue",
				},
			],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				blue: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};

		const phase3Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			phaseNumber: 3,
			budgetPerAi: 5,
			winCondition: (phase) => {
				const flower = phase.world.entities.find((i) => i.id === "flower");
				const key = phase.world.entities.find((i) => i.id === "key");
				return flower?.holder === "red" && key?.holder === "blue";
			},
		};
		const phase2Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
			budgetPerAi: 5,
			winCondition: (phase) =>
				phase.world.entities.find((i) => i.id === "key")?.holder === "blue",
			nextPhaseConfig: phase3Config,
		};
		const phase1Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			winCondition: (phase) =>
				phase.world.entities.find((i) => i.id === "flower")?.holder === "red",
			nextPhaseConfig: phase2Config,
		};

		const game = startPhase(
			createGame(TEST_PERSONAS, [
				TEST_CONTENT_PACK,
				contentPackP2,
				contentPackP3,
			]),
			phase1Config,
		);

		// Round 1: red picks up flower (red is at (0,0); flower starts at (0,0)) → phase 1 ends
		const r1Provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "c1",
						name: "pick_up",
						argumentsJson: '{"item":"flower"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: afterP1, result: r1 } = await runRound(
			game,
			"red",
			"hi",
			r1Provider,
		);
		expect(r1.phaseEnded).toBe(true);
		expect(afterP1.currentPhase).toBe(2);

		// Round 1 of phase 2: win condition already met (blue holds key in this phase config)
		// Use pass provider — phase ends immediately.
		const r2Provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: afterP2, result: r2 } = await runRound(
			afterP1,
			"red",
			"hi",
			r2Provider,
		);
		expect(r2.phaseEnded).toBe(true);
		expect(afterP2.currentPhase).toBe(3);

		// Round 1 of phase 3: win condition already met (flower→red, key→blue)
		const r3Provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
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
		expect(afterP3.phases).toHaveLength(3);
	});
});

// ----------------------------------------------------------------------------
// Lockout messages
// ----------------------------------------------------------------------------
describe("lockout messages", () => {
	it("budget-exhaustion lockout chat message is '<name> is unresponsive…'", async () => {
		let game = makeGame();
		for (let i = 0; i < 5; i++) {
			game = deductBudget(game, "red");
		}
		expect(getActivePhase(game).lockedOut.has("red")).toBe(true);

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "green", "hi", provider);

		const redHistory = getActivePhase(nextState).chatHistories.red!;
		const lastMessage = redHistory[redHistory.length - 1];
		expect(lastMessage?.role).toBe("ai");
		expect(lastMessage?.content).toBe("Ember is unresponsive…");
	});

	it("chat-lockout message is '<name> is unresponsive…'", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider, {
			rng: () => 0,
			lockoutTriggerRound: 1,
			lockoutDuration: 2,
		});

		expect(result.chatLockoutTriggered).toBeDefined();
		expect(result.chatLockoutTriggered?.aiId).toBe("red");
		expect(result.chatLockoutTriggered?.message).toBe("Ember is unresponsive…");
	});
});

// ----------------------------------------------------------------------------
// Initiative parameter
// ----------------------------------------------------------------------------
describe("initiative parameter", () => {
	it("respects the initiative parameter — order of actions matches the supplied permutation", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "I am blue", toolCalls: [] },
			{ assistantText: "I am red", toolCalls: [] },
			{ assistantText: "I am green", toolCalls: [] },
		]);
		const initiative: AiId[] = ["blue", "red", "green"];
		const { nextState, result } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			initiative,
		);
		const phase = getActivePhase(nextState);
		expect(
			phase.chatHistories.blue?.some((m) => m.content === "I am blue"),
		).toBe(true);
		expect(result.actions[0]?.actor).toBe("blue");
	});

	it("missing initiative falls back to red→green→blue", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "I am red", toolCalls: [] },
			{ assistantText: "I am green", toolCalls: [] },
			{ assistantText: "I am blue", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.actions[0]?.actor).toBe("red");
	});

	it("throws if initiative is not a permutation of red/green/blue", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([]);
		await expect(
			runRound(game, "red", "hi", provider, undefined, [
				"red",
				"green",
			] as AiId[]),
		).rejects.toThrow(/permutation/);
	});

	it("throws if initiative contains duplicate AI ids", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([]);
		await expect(
			runRound(game, "red", "hi", provider, undefined, [
				"red",
				"red",
				"blue",
			] as AiId[]),
		).rejects.toThrow(/permutation/);
	});
});

// ----------------------------------------------------------------------------
// onAiDelta callback routing (issue #102)
// ----------------------------------------------------------------------------
describe("runRound — onAiDelta callback", () => {
	it("fires onAiDelta with (aiId, text) for each delta from a live provider", async () => {
		const game = makeGame();

		// Hand-rolled provider that synchronously calls onDelta with two fragments.
		const liveProvider: RoundLLMProvider = {
			async streamRound(_messages, _tools, onDelta) {
				onDelta?.("frag1 ");
				onDelta?.("frag2");
				return { assistantText: "frag1 frag2", toolCalls: [] };
			},
		};

		const received: Array<[AiId, string]> = [];
		const onAiDelta = (aiId: AiId, text: string): void => {
			received.push([aiId, text]);
		};

		const initiative: AiId[] = ["red", "green", "blue"];
		await runRound(
			game,
			"red",
			"hello",
			liveProvider,
			undefined,
			initiative,
			undefined,
			undefined,
			onAiDelta,
		);

		// Each AI should have fired two deltas, in initiative order.
		expect(received).toHaveLength(6);
		expect(received[0]).toEqual(["red", "frag1 "]);
		expect(received[1]).toEqual(["red", "frag2"]);
		expect(received[2]).toEqual(["green", "frag1 "]);
		expect(received[3]).toEqual(["green", "frag2"]);
		expect(received[4]).toEqual(["blue", "frag1 "]);
		expect(received[5]).toEqual(["blue", "frag2"]);
	});

	it("does not invoke onAiDelta for locked-out AIs", async () => {
		// Exhaust budget (budgetPerAi=1) so all AIs lock out after round 1.
		let state = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});
		// Deduct budget 1× per AI to reach remaining=0 → lockedOut.
		for (const aiId of ["red", "green", "blue"] as AiId[]) {
			state = deductBudget(state, aiId);
		}
		expect(getActivePhase(state).lockedOut.has("red")).toBe(true);
		expect(getActivePhase(state).lockedOut.has("green")).toBe(true);
		expect(getActivePhase(state).lockedOut.has("blue")).toBe(true);

		const liveProvider: RoundLLMProvider = {
			async streamRound(_messages, _tools, onDelta) {
				onDelta?.("should not fire");
				return { assistantText: "should not fire", toolCalls: [] };
			},
		};

		const received: Array<[AiId, string]> = [];
		await runRound(
			state,
			"red",
			"hi",
			liveProvider,
			undefined,
			undefined,
			undefined,
			undefined,
			(aiId, text) => {
				received.push([aiId, text]);
			},
		);

		// All AIs locked — no deltas.
		expect(received).toHaveLength(0);
	});

	it("MockRoundLLMProvider ignores onDelta — no live deltas fired", async () => {
		const game = makeGame();
		const mockProvider = new MockRoundLLMProvider([
			{ assistantText: "red reply", toolCalls: [] },
			{ assistantText: "green reply", toolCalls: [] },
			{ assistantText: "blue reply", toolCalls: [] },
		]);

		const received: Array<[AiId, string]> = [];
		await runRound(
			game,
			"red",
			"hi",
			mockProvider,
			undefined,
			undefined,
			undefined,
			undefined,
			(aiId, text) => {
				received.push([aiId, text]);
			},
		);

		// MockRoundLLMProvider ignores onDelta — no deltas.
		expect(received).toHaveLength(0);
	});
});
