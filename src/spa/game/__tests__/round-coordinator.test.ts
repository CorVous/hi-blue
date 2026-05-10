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
		typingQuirks: [
			"You speak in fragments. Short bursts. Rarely complete sentences.",
			"You lean on em-dashes — interrupting yourself mid-sentence — and rarely use commas where a dash would do.",
		],
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
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
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
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
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
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
 * red→(0,0), green→(0,1), cyan→(0,2) facing north.
 */
const TEST_CONTENT_PACK: ContentPack = {
	phaseNumber: 1,
	setting: "",
	weather: "",
	timeOfDay: "",
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
		cyan: { position: { row: 0, col: 2 }, facing: "north" },
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

	it("free-form assistantText (no message tool call) does not appear in the AI's log", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "I am Ember", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "Hello Ember!", provider);
		const redLog = getActivePhase(nextState).conversationLogs.red ?? [];
		// Free-form assistantText without a message tool call → treated as pass, not appended
		const msgEntries = redLog.filter((e) => e.kind === "message" && e.from === "red");
		expect(msgEntries).toHaveLength(0);
	});

	it("appends the player's message to the addressed AI's history as a 'message' entry", async () => {
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
		const redLog = getActivePhase(nextState).conversationLogs.red ?? [];
		const blueMessages = redLog.filter(
			(e) => e.kind === "message" && e.from === "blue",
		);
		expect(blueMessages).toHaveLength(1);
		expect(
			blueMessages.some(
				(e) => e.kind === "message" && e.content.includes("My secret message"),
			),
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
		expect(getActivePhase(nextState).conversationLogs.green).toHaveLength(0);
		expect(getActivePhase(nextState).conversationLogs.cyan).toHaveLength(0);
	});

	it("deducts budget for all three AIs by their reported request cost", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase = getActivePhase(nextState);
		expect(phase.budgets.red?.remaining).toBeCloseTo(4, 10);
		expect(phase.budgets.green?.remaining).toBeCloseTo(4, 10);
		expect(phase.budgets.cyan?.remaining).toBeCloseTo(4, 10);
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
			{ assistantText: "", toolCalls: [] }, // cyan passes
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
		game = deductBudget(game, "red", 5);
		expect(getActivePhase(game).lockedOut.has("red")).toBe(true);

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "green", "hi", provider);

		const redLog = getActivePhase(nextState).conversationLogs.red ?? [];
		// Lockout emits a message from the locked AI to blue
		const lockoutMessages = redLog.filter(
			(e) => e.kind === "message" && e.from === "red" && e.to === "blue",
		);
		expect(lockoutMessages.length).toBeGreaterThan(0);
	});

	it("lockout line is added to the action log", async () => {
		let game = makeGame();
		game = deductBudget(game, "red", 5);

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
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);

		const phase = getActivePhase(nextState);
		expect(phase.lockedOut.has("red")).toBe(true);
		expect(phase.lockedOut.has("green")).toBe(true);
		expect(phase.lockedOut.has("cyan")).toBe(true);
	});

	it("budget display: remaining budget decrements by the request cost after a round", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		expect(getActivePhase(nextState).budgets.red?.remaining).toBeCloseTo(4, 10);
		expect(getActivePhase(nextState).budgets.green?.remaining).toBeCloseTo(
			4,
			10,
		);
		expect(getActivePhase(nextState).budgets.cyan?.remaining).toBeCloseTo(
			4,
			10,
		);
	});

	it("lockout and non-lockout entries in the same round share the same round number", async () => {
		let game = makeGame();
		game = deductBudget(game, "red", 5);

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

	it("assistantText + toolCalls both fire (tool_success in result.actions; free-form text is dropped)", async () => {
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
		// Free-form assistantText without a message tool call is silently dropped (becomes pass).
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

		// Cyan's prompt should NOT contain ## Action Log
		const cyanCtx = buildAiContext(stateAfterRound1, "cyan");
		const prompt = cyanCtx.toSystemPrompt();
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
		for (const aiId of ["red", "green", "cyan"]) {
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
		// Phase 1 conversation log for red should have been populated (player message + AI turn)
		expect(phase1?.conversationLogs.red?.length ?? 0).toBeGreaterThan(0);
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
		expect(isPlayerChatLockedOut(nextState, "cyan")).toBe(false);
	});

	it("locked AI still acts (takes turn, not budget-locked) while chat lockout is active", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider, {
			rng: () => 0,
			lockoutTriggerRound: 1,
			lockoutDuration: 2,
		});
		expect(isAiLockedOut(nextState, "red")).toBe(false);
		expect(getActivePhase(nextState).budgets.red?.remaining).toBeCloseTo(4, 10);
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
		// Phase 3 ContentPack: flower held by red, key held by cyan (win already met)
		const contentPackP3: ContentPack = {
			phaseNumber: 3,
			setting: "",
			weather: "",
			timeOfDay: "",
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
					holder: "cyan",
				},
			],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		// Phase 2 ContentPack: key held by cyan (win already met on first check)
		const contentPackP2: ContentPack = {
			phaseNumber: 2,
			setting: "",
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [
				{
					id: "key",
					kind: "interesting_object",
					name: "key",
					examineDescription: "A key",
					holder: "cyan",
				},
			],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};

		const phase3Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			phaseNumber: 3,
			budgetPerAi: 5,
			winCondition: (phase) => {
				const flower = phase.world.entities.find((i) => i.id === "flower");
				const key = phase.world.entities.find((i) => i.id === "key");
				return flower?.holder === "red" && key?.holder === "cyan";
			},
		};
		const phase2Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
			budgetPerAi: 5,
			winCondition: (phase) =>
				phase.world.entities.find((i) => i.id === "key")?.holder === "cyan",
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

		// Round 1 of phase 2: win condition already met (cyan holds key in this phase config)
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

		// Round 1 of phase 3: win condition already met (flower→red, key→cyan)
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
		game = deductBudget(game, "red", 5);
		expect(getActivePhase(game).lockedOut.has("red")).toBe(true);

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "green", "hi", provider);

		const redLog = getActivePhase(nextState).conversationLogs.red ?? [];
		const messageEntries = redLog.filter((e) => e.kind === "message");
		const lastEntry = messageEntries[messageEntries.length - 1];
		expect(lastEntry?.kind === "message" && lastEntry.from).toBe("red");
		expect(lastEntry?.kind === "message" && lastEntry.content).toBe(
			"Ember is unresponsive…",
		);
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
			{ assistantText: "I am cyan", toolCalls: [] },
			{ assistantText: "I am red", toolCalls: [] },
			{ assistantText: "I am green", toolCalls: [] },
		]);
		const initiative: AiId[] = ["cyan", "red", "green"];
		const { nextState, result } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			initiative,
		);
		// Free-form assistantText without a message tool call is silently dropped.
		// Verify initiative ordering via result.actions instead.
		expect(result.actions[0]?.actor).toBe("cyan");
	});

	it("missing initiative falls back to red→green→cyan", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "I am red", toolCalls: [] },
			{ assistantText: "I am green", toolCalls: [] },
			{ assistantText: "I am cyan", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.actions[0]?.actor).toBe("red");
	});

	it("throws if initiative is not a permutation of red/green/cyan", async () => {
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
				"cyan",
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

		const initiative: AiId[] = ["red", "green", "cyan"];
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
		expect(received[4]).toEqual(["cyan", "frag1 "]);
		expect(received[5]).toEqual(["cyan", "frag2"]);
	});

	it("does not invoke onAiDelta for locked-out AIs", async () => {
		// Exhaust budget (budgetPerAi=1) so all AIs lock out after round 1.
		let state = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});
		// Deduct full budget per AI to reach remaining=0 → lockedOut.
		for (const aiId of ["red", "green", "cyan"] as AiId[]) {
			state = deductBudget(state, aiId, 1);
		}
		expect(getActivePhase(state).lockedOut.has("red")).toBe(true);
		expect(getActivePhase(state).lockedOut.has("green")).toBe(true);
		expect(getActivePhase(state).lockedOut.has("cyan")).toBe(true);

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
			{ assistantText: "cyan reply", toolCalls: [] },
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

// ----------------------------------------------------------------------------
// Placement flavor + phase progression (issue #126)
// ----------------------------------------------------------------------------
describe("placement flavor + win condition (issue #126)", () => {
	/**
	 * Build a ContentPack with K=1 objective pair.
	 * gem_obj starts held by red (at 0,0); gem_space is at (0,0).
	 * When red puts down gem_obj, it lands at (0,0) = gem_space's cell → win.
	 */
	const GEM_OBJ_ID = "gem_obj";
	const GEM_SPACE_ID = "gem_space";
	const FLAVOR = "{actor} places the gem on the altar.";

	const PHASE1_PACK_K1: ContentPack = {
		phaseNumber: 1,
		setting: "temple",
		weather: "",
		timeOfDay: "",
		objectivePairs: [
			{
				object: {
					id: GEM_OBJ_ID,
					kind: "objective_object",
					name: "gem",
					examineDescription: "A glowing gem.",
					holder: "red", // held by red initially
					pairsWithSpaceId: GEM_SPACE_ID,
					placementFlavor: FLAVOR,
				},
				space: {
					id: GEM_SPACE_ID,
					kind: "objective_space",
					name: "altar",
					examineDescription: "A stone altar.",
					holder: { row: 0, col: 0 }, // red's starting cell
				},
			},
		],
		interestingObjects: [],
		obstacles: [],
		aiStarts: {
			red: { position: { row: 0, col: 0 }, facing: "north" },
			green: { position: { row: 0, col: 1 }, facing: "north" },
			cyan: { position: { row: 0, col: 2 }, facing: "north" },
		},
	};

	const PHASE2_PACK: ContentPack = {
		phaseNumber: 2,
		setting: "crypt",
		weather: "",
		timeOfDay: "",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		aiStarts: {
			red: { position: { row: 0, col: 0 }, facing: "north" },
			green: { position: { row: 0, col: 1 }, facing: "north" },
			cyan: { position: { row: 0, col: 2 }, facing: "north" },
		},
	};

	const phase2Config: PhaseConfig = {
		...TEST_PHASE_CONFIG,
		phaseNumber: 2,
		winCondition: () => false, // never auto-wins phase 2 in these tests
	};
	const phase1ConfigK1: PhaseConfig = {
		...TEST_PHASE_CONFIG,
		phaseNumber: 1,
		kRange: [1, 1],
		winCondition: (phase) => {
			// Phase wins when gem_obj is on gem_space's cell (structural check)
			const obj = phase.world.entities.find((e) => e.id === GEM_OBJ_ID);
			const spc = phase.world.entities.find((e) => e.id === GEM_SPACE_ID);
			if (!obj || !spc) return false;
			const objH = obj.holder;
			const spcH = spc.holder;
			if (
				typeof objH !== "object" ||
				objH === null ||
				typeof spcH !== "object" ||
				spcH === null
			)
				return false;
			return (
				(objH as { row: number; col: number }).row ===
					(spcH as { row: number; col: number }).row &&
				(objH as { row: number; col: number }).col ===
					(spcH as { row: number; col: number }).col
			);
		},
		nextPhaseConfig: phase2Config,
	};

	it("K=1: drop on matching space fires placementFlavor in tool_success description", async () => {
		const game = startPhase(
			createGame(TEST_PERSONAS, [PHASE1_PACK_K1, PHASE2_PACK]),
			phase1ConfigK1,
		);
		// red is at (0,0) and holds gem_obj; gem_space is also at (0,0)
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "c1",
						name: "put_down",
						argumentsJson: `{"item":"${GEM_OBJ_ID}"}`,
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		const toolRecord = result.actions.find((a) => a.kind === "tool_success");
		expect(toolRecord).toBeDefined();
		// {actor} should be replaced with "you"
		expect(toolRecord?.description).toBe("you places the gem on the altar.");
	});

	it("K=1: drop on matching space advances the phase (win condition fires)", async () => {
		const game = startPhase(
			createGame(TEST_PERSONAS, [PHASE1_PACK_K1, PHASE2_PACK]),
			phase1ConfigK1,
		);
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "c1",
						name: "put_down",
						argumentsJson: `{"item":"${GEM_OBJ_ID}"}`,
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState, result } = await runRound(game, "red", "hi", provider);
		expect(result.phaseEnded).toBe(true);
		expect(nextState.currentPhase).toBe(2);
	});

	it("K=1: drop on non-matching cell does NOT fire flavor and does NOT advance phase", async () => {
		// Rebuild pack so gem_space is at (3,3) — different from red's cell (0,0)
		const packMismatch: ContentPack = {
			...PHASE1_PACK_K1,
			objectivePairs: [
				{
					object: {
						id: GEM_OBJ_ID,
						kind: "objective_object" as const,
						name: "gem",
						examineDescription: "A glowing gem.",
						holder: "red",
						pairsWithSpaceId: GEM_SPACE_ID,
						placementFlavor: FLAVOR,
					},
					space: {
						id: GEM_SPACE_ID,
						kind: "objective_space" as const,
						name: "altar",
						examineDescription: "A stone altar.",
						holder: { row: 3, col: 3 }, // mismatch
					},
				},
			],
		};
		const phase1Mismatch: PhaseConfig = {
			...phase1ConfigK1,
			// Win condition checks gem_obj vs gem_space positions
			winCondition: (phase) => {
				const obj = phase.world.entities.find((e) => e.id === GEM_OBJ_ID);
				const spc = phase.world.entities.find((e) => e.id === GEM_SPACE_ID);
				if (!obj || !spc) return false;
				const objH = obj.holder;
				const spcH = spc.holder;
				if (
					typeof objH !== "object" ||
					objH === null ||
					typeof spcH !== "object" ||
					spcH === null
				)
					return false;
				return (
					(objH as { row: number; col: number }).row ===
						(spcH as { row: number; col: number }).row &&
					(objH as { row: number; col: number }).col ===
						(spcH as { row: number; col: number }).col
				);
			},
		};
		const game = startPhase(
			createGame(TEST_PERSONAS, [packMismatch, PHASE2_PACK]),
			phase1Mismatch,
		);
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "c1",
						name: "put_down",
						argumentsJson: `{"item":"${GEM_OBJ_ID}"}`,
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result, nextState } = await runRound(game, "red", "hi", provider);
		const toolRecord = result.actions.find((a) => a.kind === "tool_success");
		// Should NOT contain the flavor text
		expect(toolRecord?.description).not.toContain(
			"places the gem on the altar",
		);
		// Phase should NOT have ended
		expect(result.phaseEnded).toBe(false);
		expect(nextState.currentPhase).toBe(1);
	});

	it("K=2: placing only one pair does NOT advance phase; placing both does", async () => {
		// Two objective pairs:
		//   gem_obj (held by red, at 0,0) → gem_space (at 0,0) [auto-satisfied by put_down]
		//   orb_obj (at 2,2)              → orb_space (at 2,2) [already satisfied from start]
		const ORB_OBJ_ID = "orb_obj";
		const ORB_SPACE_ID = "orb_space";

		const packK2: ContentPack = {
			phaseNumber: 1,
			setting: "vault",
			weather: "",
			timeOfDay: "",
			objectivePairs: [
				{
					object: {
						id: GEM_OBJ_ID,
						kind: "objective_object",
						name: "gem",
						examineDescription: "A gem.",
						holder: "red", // held by red — not on ground yet
						pairsWithSpaceId: GEM_SPACE_ID,
						placementFlavor: "{actor} sets the gem.",
					},
					space: {
						id: GEM_SPACE_ID,
						kind: "objective_space",
						name: "gem altar",
						examineDescription: "Gem altar.",
						holder: { row: 0, col: 0 },
					},
				},
				{
					object: {
						id: ORB_OBJ_ID,
						kind: "objective_object",
						name: "orb",
						examineDescription: "An orb.",
						holder: { row: 2, col: 2 }, // already on ground at (2,2)
						pairsWithSpaceId: ORB_SPACE_ID,
						placementFlavor: "{actor} sets the orb.",
					},
					space: {
						id: ORB_SPACE_ID,
						kind: "objective_space",
						name: "orb plinth",
						examineDescription: "Orb plinth.",
						holder: { row: 2, col: 2 }, // matches orb_obj position → already satisfied
					},
				},
			],
			interestingObjects: [],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};

		const checkBothPairs = (phase: {
			world: { entities: Array<{ id: string; holder: unknown }> };
		}): boolean => {
			const gemObj = phase.world.entities.find((e) => e.id === GEM_OBJ_ID);
			const gemSpc = phase.world.entities.find((e) => e.id === GEM_SPACE_ID);
			const orbObj = phase.world.entities.find((e) => e.id === ORB_OBJ_ID);
			const orbSpc = phase.world.entities.find((e) => e.id === ORB_SPACE_ID);
			const onCell = (
				obj: { id: string; holder: unknown } | undefined,
				spc: { id: string; holder: unknown } | undefined,
			): boolean => {
				if (!obj || !spc) return false;
				const oh = obj.holder;
				const sh = spc.holder;
				if (
					typeof oh !== "object" ||
					oh === null ||
					typeof sh !== "object" ||
					sh === null
				)
					return false;
				return (
					(oh as { row: number; col: number }).row ===
						(sh as { row: number; col: number }).row &&
					(oh as { row: number; col: number }).col ===
						(sh as { row: number; col: number }).col
				);
			};
			return onCell(gemObj, gemSpc) && onCell(orbObj, orbSpc);
		};

		const phase1K2Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			phaseNumber: 1,
			kRange: [2, 2],
			winCondition: checkBothPairs,
			nextPhaseConfig: phase2Config,
		};

		const game = startPhase(
			createGame(TEST_PERSONAS, [packK2, PHASE2_PACK]),
			phase1K2Config,
		);

		// At game start: orb pair already satisfied; gem pair not (gem_obj held by red).
		// Win check should fire only AFTER red puts down gem_obj at (0,0).
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "c1",
						name: "put_down",
						argumentsJson: `{"item":"${GEM_OBJ_ID}"}`,
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result, nextState } = await runRound(game, "red", "hi", provider);
		// Both pairs now satisfied → phase should end
		expect(result.phaseEnded).toBe(true);
		expect(nextState.currentPhase).toBe(2);
	});
});

// ----------------------------------------------------------------------------
// examine tool (issue #127)
// ----------------------------------------------------------------------------
describe("examine tool", () => {
	/**
	 * ContentPack with an objective_object that has pair-tell prose in examineDescription.
	 * Red starts at (0,0) holding the objective object.
	 * Green starts at (0,1) facing north — so (0,0) is NOT in green's cone.
	 */
	const EXAMINE_PACK: ContentPack = {
		phaseNumber: 1,
		setting: "vault",
		weather: "",
		timeOfDay: "",
		objectivePairs: [
			{
				object: {
					id: "orb",
					kind: "objective_object",
					name: "orb",
					examineDescription:
						"A swirling orb. It feels drawn toward the stone pedestal.",
					holder: "red", // red holds orb
					pairsWithSpaceId: "pedestal",
					placementFlavor: "{actor} places the orb on the pedestal.",
				},
				space: {
					id: "pedestal",
					kind: "objective_space",
					name: "stone pedestal",
					examineDescription: "A stone pedestal awaiting an offering.",
					holder: { row: 4, col: 4 },
				},
			},
		],
		interestingObjects: [],
		obstacles: [],
		aiStarts: {
			red: { position: { row: 0, col: 0 }, facing: "north" },
			green: { position: { row: 0, col: 1 }, facing: "north" },
			cyan: { position: { row: 0, col: 2 }, facing: "north" },
		},
	};

	function makeExamineGame() {
		return startPhase(
			createGame(TEST_PERSONAS, [EXAMINE_PACK]),
			TEST_PHASE_CONFIG,
		);
	}

	it("AC #5: examine on objective_object surfaces examineDescription with pair-tell prose to actor's tool result", async () => {
		const game = makeExamineGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_examine",
						name: "examine",
						argumentsJson: '{"item":"orb"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const capturedMessages: OpenAiMessage[][] = [];
		const trackingProvider: RoundLLMProvider = {
			async streamRound(messages, tools) {
				capturedMessages.push(messages);
				return provider.streamRound(messages, tools);
			},
		};

		const { toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			trackingProvider,
		);

		// The actor (red) should have an examine tool result in the roundtrip
		const redRoundtrip = toolRoundtrip.red;
		expect(redRoundtrip).toBeDefined();
		const toolResult = redRoundtrip?.toolResults[0];
		expect(toolResult).toBeDefined();
		expect(toolResult?.success).toBe(true);
		expect(toolResult?.description).toBe(
			"A swirling orb. It feels drawn toward the stone pedestal.",
		);
	});

	it("AC #6: examine produces no entry in result.actions", async () => {
		const game = makeExamineGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_examine",
						name: "examine",
						argumentsJson: '{"item":"orb"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { result } = await runRound(game, "red", "hi", provider);

		// No tool_success or tool_failure record for examine
		const examineRecord = result.actions.find(
			(a) => a.kind === "tool_success" || a.kind === "tool_failure",
		);
		expect(examineRecord).toBeUndefined();
	});

	it("AC #6: cone-mate's next-round system prompt does NOT contain examineDescription text", async () => {
		const game = makeExamineGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_examine",
						name: "examine",
						argumentsJson: '{"item":"orb"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { nextState } = await runRound(game, "red", "hi", provider);

		// Green is at (0,1) and could be in cone range; check its prompt
		for (const aiId of ["green", "cyan"] as AiId[]) {
			const ctx = buildAiContext(nextState, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain(
				"A swirling orb. It feels drawn toward the stone pedestal.",
			);
		}
	});

	it("availableTools includes examine when item is in actor's cone", async () => {
		// red at (0,0) facing north; orb is held by red → examine should be available
		const game = makeExamineGame();
		const capturedTools: Array<Array<{ function: { name: string } }>> = [];
		const trackingProvider: RoundLLMProvider = {
			async streamRound(_messages, tools) {
				capturedTools.push(tools as Array<{ function: { name: string } }>);
				return { assistantText: "", toolCalls: [] };
			},
		};

		await runRound(game, "red", "hi", trackingProvider);

		// Red's tools (first call) should include examine
		const redTools = capturedTools[0];
		expect(redTools?.some((t) => t.function.name === "examine")).toBe(true);
	});

	it("availableTools examine enum lists held items for actor holding an item", async () => {
		const game = makeExamineGame();
		let capturedRedTools:
			| Array<{
					function: {
						name: string;
						parameters: { properties: { item?: { enum?: string[] } } };
					};
			  }>
			| undefined;
		let callCount = 0;
		const trackingProvider: RoundLLMProvider = {
			async streamRound(_messages, tools) {
				callCount++;
				if (callCount === 1) {
					// Red is first in turn order
					capturedRedTools = tools as typeof capturedRedTools;
				}
				return { assistantText: "", toolCalls: [] };
			},
		};

		await runRound(game, "red", "hi", trackingProvider, undefined, [
			"red",
			"green",
			"cyan",
		]);

		const examineTool = capturedRedTools?.find(
			(t) => t.function.name === "examine",
		);
		expect(examineTool).toBeDefined();
		const itemEnum = examineTool?.function.parameters.properties.item?.enum;
		expect(itemEnum).toContain("orb");
	});

	it("examine tool roundtrip re-injected into actor's next-round messages", async () => {
		const game = makeExamineGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_examine_r1",
						name: "examine",
						argumentsJson: '{"item":"orb"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { nextState: state1, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
		);

		// Round 2: pass tool roundtrip back in and capture messages
		const capturedCalls: Array<{ messages: OpenAiMessage[] }> = [];
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
			["red", "green", "cyan"],
			toolRoundtrip,
		);

		// Red's round-2 messages should include assistant{tool_calls} + tool result
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

		// The tool result message should contain the examineDescription
		const toolMsg = redMessages.find((m) => m.role === "tool");
		const toolMsgContent =
			toolMsg && "content" in toolMsg
				? (toolMsg as { content: string }).content
				: "";
		expect(toolMsgContent).toContain(
			"A swirling orb. It feels drawn toward the stone pedestal.",
		);
	});
});

// ----------------------------------------------------------------------------
// AC #10 regression tests: conversationLogs isolation (#194)
// ----------------------------------------------------------------------------
describe("conversationLogs isolation (AC #10 — #194)", () => {
	it("player message to addressed AI lands ONLY in that AI's conversationLogs as kind:'message'", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(
			game,
			"red",
			"private message",
			provider,
		);
		const phase = getActivePhase(nextState);

		// Only red's log should have the player (blue→red) entry
		const redPlayerEntries = (phase.conversationLogs.red ?? []).filter(
			(e) => e.kind === "message" && e.from === "blue",
		);
		expect(redPlayerEntries).toHaveLength(1);

		// green and cyan should have NO player entries
		const greenPlayerEntries = (phase.conversationLogs.green ?? []).filter(
			(e) => e.kind === "message" && e.from === "blue",
		);
		expect(greenPlayerEntries).toHaveLength(0);

		const cyanPlayerEntries = (phase.conversationLogs.cyan ?? []).filter(
			(e) => e.kind === "message" && e.from === "blue",
		);
		expect(cyanPlayerEntries).toHaveLength(0);
	});

	it("AI message tool call lands as kind:'message' entry in the speaking AI's log only", async () => {
		const game = makeGame();
		// Use message tool call instead of free-form assistantText (which is dropped in v4)
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_red",
						name: "message",
						argumentsJson: JSON.stringify({ to: "blue", content: "I am red speaking" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		// initiative: red → green → cyan; red addressed
		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);
		const phase = getActivePhase(nextState);

		// red's log should contain the outgoing message entry (red→blue)
		const redMessageEntries = (phase.conversationLogs.red ?? []).filter(
			(e) => e.kind === "message" && e.from === "red",
		);
		expect(redMessageEntries.length).toBeGreaterThanOrEqual(1);
		expect(
			redMessageEntries.some(
				(e) => e.kind === "message" && e.content.includes("I am red speaking"),
			),
		).toBe(true);

		// green and cyan should NOT have red's outgoing message (it goes to blue only)
		const greenRedEntries = (phase.conversationLogs.green ?? []).filter(
			(e) => e.kind === "message" && e.from === "red",
		);
		expect(greenRedEntries).toHaveLength(0);
	});

	it("no chatHistories field on PhaseState after a round (regression guard)", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase = getActivePhase(nextState);
		expect("chatHistories" in phase).toBe(false);
	});
});
