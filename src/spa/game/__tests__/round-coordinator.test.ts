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
import { DEFAULT_LANDMARKS } from "../direction";
import {
	deductBudget,
	getActivePhase,
	isAiLockedOut,
	isPlayerChatLockedOut,
	startGame,
} from "../engine";
import { buildOpenAiMessages } from "../openai-message-builder";
import { buildAiContext } from "../prompt-builder";
import { runRound } from "../round-coordinator";
import type { RoundLLMProvider } from "../round-llm-provider";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { AiId, AiPersona, ContentPack } from "../types";

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
	landmarks: DEFAULT_LANDMARKS,
	aiStarts: {
		red: { position: { row: 0, col: 0 }, facing: "north" },
		green: { position: { row: 0, col: 1 }, facing: "north" },
		cyan: { position: { row: 0, col: 2 }, facing: "north" },
	},
};

function makeGame() {
	return startGame(TEST_PERSONAS, [TEST_CONTENT_PACK]);
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
		const msgEntries = redLog.filter(
			(e) => e.kind === "message" && e.from === "red",
		);
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
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase = getActivePhase(nextState);
		expect(phase.budgets.red?.remaining).toBeCloseTo(0.4, 10);
		expect(phase.budgets.green?.remaining).toBeCloseTo(0.4, 10);
		expect(phase.budgets.cyan?.remaining).toBeCloseTo(0.4, 10);
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
// Drift-to-silence retry (#254)
//
// When the model returns free-form text with no tool call, the coordinator
// retries the turn once with a tightening nudge before falling through to
// drop-to-pass. The retry's nudge and the dropped first attempt must NOT
// land in game state, the conversation log, or the persisted tool
// roundtrip — only the retry's response flows through normal dispatch.
// ----------------------------------------------------------------------------
describe("drift-to-silence retry (#254)", () => {
	it("retry that returns a message tool call lands in the conversation log", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			// red: text-only first attempt → triggers retry
			{ assistantText: "I'd say hello to blue.", toolCalls: [] },
			// red retry: emits the message
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_retry",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "Hello blue!",
						}),
					},
				],
			},
			// green, cyan: pass
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		const redLog = getActivePhase(nextState).conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" &&
					e.from === "red" &&
					e.content.includes("Hello blue!"),
			),
		).toBe(true);
	});

	it("retry's nudge does NOT leak into the conversation log", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "dropped first attempt text", toolCalls: [] },
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_retry",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "recovered reply",
						}),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		const allLogContent = (
			Object.values(
				getActivePhase(nextState).conversationLogs,
			).flat() as Array<{
				kind: string;
				content?: string;
			}>
		)
			.map((e) => e.content ?? "")
			.join("\n");

		// The dropped first attempt and the nudge user-message must never
		// appear in any AI's conversation log.
		expect(allLogContent).not.toContain("dropped first attempt text");
		expect(allLogContent).not.toContain("did not emit a tool call");
		expect(allLogContent).not.toContain("Re-emit your previous reply");
	});

	it("retry that also drops falls through to pass; no message in the log", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "I think I should say something.", toolCalls: [] },
			// retry also drops
			{ assistantText: "still no tool call here.", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		const redLog = getActivePhase(nextState).conversationLogs.red ?? [];
		const redMsgs = redLog.filter(
			(e) => e.kind === "message" && e.from === "red",
		);
		expect(redMsgs).toHaveLength(0);
	});

	it("does NOT retry when first attempt is a true pass (empty text, no tool calls)", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		await runRound(game, "red", "hi", provider, undefined, [
			"red",
			"green",
			"cyan",
		] as AiId[]);

		// One call per AI — no retries fired.
		expect(provider.calls).toHaveLength(3);
	});

	it("does NOT retry when first attempt already has a tool call", async () => {
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

		await runRound(game, "red", "hi", provider, undefined, [
			"red",
			"green",
			"cyan",
		] as AiId[]);

		expect(provider.calls).toHaveLength(3);
	});

	it("retry sees the nudge appended after the dropped first attempt", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "I would like to say hi.", toolCalls: [] },
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_retry",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "hi blue",
						}),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		await runRound(game, "red", "hi", provider, undefined, [
			"red",
			"green",
			"cyan",
		] as AiId[]);

		// Red's retry is provider.calls[1]; its messages should include the
		// dropped first attempt as an assistant turn and the nudge as a
		// user turn after the original messages.
		const retryMessages = provider.calls[1]?.messages ?? [];
		const last2 = retryMessages.slice(-2);
		expect(last2[0]?.role).toBe("assistant");
		expect((last2[0] as { content: string }).content).toBe(
			"I would like to say hi.",
		);
		expect(last2[1]?.role).toBe("user");
		expect((last2[1] as { content: string }).content).toContain(
			"message({to: <recipient>, content: ...})",
		);
	});

	it("retry sums costUsd from both LLM calls into the budget deduction", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "drift", toolCalls: [], costUsd: 0.1 },
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_retry",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "ok",
						}),
					},
				],
				costUsd: 0.1,
			},
			{ assistantText: "", toolCalls: [], costUsd: 0 },
			{ assistantText: "", toolCalls: [], costUsd: 0 },
		]);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		const phase = getActivePhase(nextState);
		// Budget starts at 0.5; red spent 0.1 + 0.1 = 0.2, leaving 0.3
		expect(phase.budgets.red?.remaining).toBeCloseTo(0.3, 10);
	});

	it("retry that yields msg-success keeps the tool roundtrip empty (no first-attempt leak)", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "drifted", toolCalls: [] },
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_retry",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "ok blue",
						}),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		// msg-success excluded from roundtrip per ADR 0007; the dropped
		// first attempt must not slip in either.
		expect(toolRoundtrip.red).toBeUndefined();
	});
});

// ----------------------------------------------------------------------------
// onAiTurnComplete callback
//
// Per-AI "turn finished" signal — fires once per AI in initiative order,
// AFTER any drift-to-silence retry (#254). The SPA hooks this for staged
// per-daemon spinner-strip; coordinator runs AIs serially so the fire
// order matches the visible round progression.
// ----------------------------------------------------------------------------
describe("onAiTurnComplete callback", () => {
	it("fires once per AI in initiative order", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const order: AiId[] = [];
		await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["green", "cyan", "red"] as AiId[],
			undefined,
			undefined,
			undefined,
			undefined,
			(aiId) => order.push(aiId),
		);

		expect(order).toEqual(["green", "cyan", "red"]);
	});

	it("fires AFTER the retry resolves, not after the first dropped attempt", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			// red: text-only first attempt → triggers retry
			{ assistantText: "I would like to say hi.", toolCalls: [] },
			// red retry: message
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_retry",
						name: "message",
						argumentsJson: JSON.stringify({ to: "blue", content: "hi" }),
					},
				],
			},
			// green, cyan pass
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		// Track when each callback fires relative to provider call count.
		const fireOrder: Array<{ aiId: AiId; callsAtFire: number }> = [];
		await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
			undefined,
			undefined,
			undefined,
			undefined,
			(aiId) => fireOrder.push({ aiId, callsAtFire: provider.calls.length }),
		);

		// Red's turn made 2 provider calls (initial + retry). The
		// onAiTurnComplete for red must fire AFTER both — i.e., when the
		// total call count has reached 2, not 1.
		const redFire = fireOrder.find((f) => f.aiId === "red");
		expect(redFire?.callsAtFire).toBe(2);
	});

	it("fires for locked-out AIs too (uniform per-AI signal)", async () => {
		// Exhaust red's budget so it locks out next round.
		let state = startGame(TEST_PERSONAS, [TEST_CONTENT_PACK]);
		state = deductBudget(state, "red" as AiId, 0.5);
		expect(isAiLockedOut(state, "red" as AiId)).toBe(true);

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const fired: AiId[] = [];
		await runRound(
			state,
			"green",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
			undefined,
			undefined,
			undefined,
			undefined,
			(aiId) => fired.push(aiId),
		);

		expect(fired).toContain("red");
		expect(fired).toHaveLength(3);
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
		game = deductBudget(game, "red", 0.5);
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
		game = deductBudget(game, "red", 0.5);

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
		const game = startGame(TEST_PERSONAS, []);

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 0.5 },
			{ assistantText: "", toolCalls: [], costUsd: 0.5 },
			{ assistantText: "", toolCalls: [], costUsd: 0.5 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);

		const phase = getActivePhase(nextState);
		expect(phase.lockedOut.has("red")).toBe(true);
		expect(phase.lockedOut.has("green")).toBe(true);
		expect(phase.lockedOut.has("cyan")).toBe(true);
	});

	it("an AI exhausting budget mid-round emits a farewell line before lockout", async () => {
		const game = startGame(TEST_PERSONAS, []);

		// costUsd = 0.5 exhausts red's full budget on its turn
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 0.5 },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);

		const phase = getActivePhase(nextState);
		expect(phase.lockedOut.has("red")).toBe(true);

		// Farewell message should appear in red's log, from red to blue
		const redLog = phase.conversationLogs.red ?? [];
		const farewellEntry = redLog.find(
			(e) =>
				e.kind === "message" &&
				e.from === "red" &&
				e.to === "blue" &&
				e.content === "Ember goes silent.",
		);
		expect(farewellEntry).toBeDefined();
	});

	it("budget display: remaining budget decrements by the request cost after a round", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		expect(getActivePhase(nextState).budgets.red?.remaining).toBeCloseTo(
			0.4,
			10,
		);
		expect(getActivePhase(nextState).budgets.green?.remaining).toBeCloseTo(
			0.4,
			10,
		);
		expect(getActivePhase(nextState).budgets.cyan?.remaining).toBeCloseTo(
			0.4,
			10,
		);
	});

	it("lockout and non-lockout entries in the same round share the same round number", async () => {
		let game = makeGame();
		game = deductBudget(game, "red", 0.5);

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
// Game completion — win/lose conditions (#295 single-game loop)
// ----------------------------------------------------------------------------
describe("game completion — win/lose conditions", () => {
	it("RoundResult.phaseEnded is always false (single-game loop)", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.phaseEnded).toBe(false);
	});

	it("RoundResult.gameEnded is false and isComplete stays false when objectives not satisfied", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result, nextState } = await runRound(game, "red", "hi", provider);
		expect(result.gameEnded).toBe(false);
		expect(nextState.isComplete).toBe(false);
	});

	it("marks game complete (win) when all AIs are locked out and that causes lose condition", async () => {
		// Exhaust all budgets in one round — all lock out → lose condition triggers
		let game = makeGame();
		game = deductBudget(game, "red", 0.5);
		game = deductBudget(game, "green", 0.5);
		game = deductBudget(game, "cyan", 0.5);
		expect(getActivePhase(game).lockedOut.has("red")).toBe(true);
		expect(getActivePhase(game).lockedOut.has("green")).toBe(true);
		expect(getActivePhase(game).lockedOut.has("cyan")).toBe(true);

		const provider = new MockRoundLLMProvider([]);
		const { nextState, result } = await runRound(game, "red", "hi", provider);
		expect(nextState.isComplete).toBe(true);
		expect(result.gameEnded).toBe(true);
	});

	it("phase history is retained across rounds in the single-phase game", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
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
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider, {
			rng: () => 0,
			lockoutTriggerRound: 1,
			lockoutDuration: 2,
		});
		expect(isAiLockedOut(nextState, "red")).toBe(false);
		expect(getActivePhase(nextState).budgets.red?.remaining).toBeCloseTo(
			0.4,
			10,
		);
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
// Lockout messages
// ----------------------------------------------------------------------------
describe("lockout messages", () => {
	it("budget-exhaustion lockout chat message is '<name> is unresponsive…'", async () => {
		let game = makeGame();
		game = deductBudget(game, "red", 0.5);
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
		const { result } = await runRound(
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

		// Hand-rolled provider that synchronously calls onDelta with two
		// fragments and returns a `message` tool call so #254's retry does
		// not fire (this test asserts delta routing, not retry behaviour).
		let callIdx = 0;
		const liveProvider: RoundLLMProvider = {
			async streamRound(_messages, _tools, onDelta) {
				onDelta?.("frag1 ");
				onDelta?.("frag2");
				const id = `msg_${callIdx++}`;
				return {
					assistantText: "frag1 frag2",
					toolCalls: [
						{
							id,
							name: "message",
							argumentsJson: JSON.stringify({
								to: "blue",
								content: "frag1 frag2",
							}),
						},
					],
				};
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
		// Exhaust budget for all AIs so they all lock out.
		let state = startGame(TEST_PERSONAS, []);
		// Deduct full budget per AI to reach remaining=0 → lockedOut.
		for (const aiId of ["red", "green", "cyan"] as AiId[]) {
			state = deductBudget(state, aiId, 0.5);
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
describe("placement flavor (issue #126)", () => {
	/**
	 * Build a ContentPack with K=1 objective pair.
	 * gem_obj starts held by red (at 0,0); gem_space is at (0,0).
	 * When red puts down gem_obj, it lands at (0,0) = gem_space's cell → flavor fires.
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
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: {
			red: { position: { row: 0, col: 0 }, facing: "north" },
			green: { position: { row: 0, col: 1 }, facing: "north" },
			cyan: { position: { row: 0, col: 2 }, facing: "north" },
		},
	};

	it("K=1: drop on matching space fires placementFlavor in tool_success description", async () => {
		const game = startGame(TEST_PERSONAS, [PHASE1_PACK_K1]);
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

	it("K=1: drop on matching space — phaseEnded is always false in single-game loop", async () => {
		const game = startGame(TEST_PERSONAS, [PHASE1_PACK_K1]);
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
		// phaseEnded is always false in the single-game loop
		expect(result.phaseEnded).toBe(false);
	});

	it("K=1: drop on non-matching cell does NOT fire flavor", async () => {
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
		const game = startGame(TEST_PERSONAS, [packMismatch]);
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
		// Should NOT contain the flavor text
		expect(toolRecord?.description).not.toContain(
			"places the gem on the altar",
		);
		// Phase never ends in single-game loop
		expect(result.phaseEnded).toBe(false);
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
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: {
			red: { position: { row: 0, col: 0 }, facing: "north" },
			green: { position: { row: 0, col: 1 }, facing: "north" },
			cyan: { position: { row: 0, col: 2 }, facing: "north" },
		},
	};

	function makeExamineGame() {
		return startGame(TEST_PERSONAS, [EXAMINE_PACK]);
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
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "I am red speaking",
						}),
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

// ----------------------------------------------------------------------------
// Parallel tool calls: message + action in one turn (issue #238)
// ----------------------------------------------------------------------------
describe("parallel tool calls (message + action in one turn) (#238)", () => {
	// Table row 3: [msg-success, action] → roundtrip has action id only;
	// conversation log gets the message body.
	it("[msg, pick_up]: both dispatched; message record first; roundtrip has only pick_up id", async () => {
		const game = makeGame();
		// red at (0,0), flower at (0,0) — red can pick up flower
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_id",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "I'll grab the flower",
						}),
					},
					{
						id: "pickup_id",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "flower" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { result, nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		// Both dispatched
		const redActions = result.actions.filter((a) => a.actor === "red");
		expect(redActions.some((a) => a.kind === "message")).toBe(true);
		expect(redActions.some((a) => a.kind === "tool_success")).toBe(true);

		// message record BEFORE tool_success (P0-1 ordering)
		const msgIdx = redActions.findIndex((a) => a.kind === "message");
		const toolIdx = redActions.findIndex((a) => a.kind === "tool_success");
		expect(msgIdx).toBeLessThan(toolIdx);

		// Conversation log has the spoken message
		const redLog = getActivePhase(nextState).conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" &&
					e.from === "red" &&
					e.content.includes("I'll grab the flower"),
			),
		).toBe(true);

		// World state reflects pick_up
		const flower = getActivePhase(nextState).world.entities.find(
			(e) => e.id === "flower",
		);
		expect(flower?.holder).toBe("red");

		// Roundtrip has ONLY pick_up id (msg-success excluded per ADR 0007 / table row 3)
		const rt = toolRoundtrip.red;
		expect(rt).toBeDefined();
		expect(rt?.assistantToolCalls).toHaveLength(1);
		expect(rt?.assistantToolCalls[0]?.id).toBe("pickup_id");
		expect(rt?.toolResults).toHaveLength(1);
		expect(rt?.toolResults[0]?.tool_call_id).toBe("pickup_id");
		expect(rt?.toolResults[0]?.success).toBe(true);
	});

	// Table row 2: [action]-only → roundtrip has the action id; regression guard
	it("[pick_up]-only: existing single-call behavior unchanged; roundtrip has action id", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "pickup_only_id",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "flower" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { result, nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		expect(
			result.actions.some(
				(a) => a.kind === "tool_success" && a.actor === "red",
			),
		).toBe(true);
		expect(
			getActivePhase(nextState).world.entities.find((e) => e.id === "flower")
				?.holder,
		).toBe("red");

		const rt = toolRoundtrip.red;
		expect(rt).toBeDefined();
		expect(rt?.assistantToolCalls).toHaveLength(1);
		expect(rt?.assistantToolCalls[0]?.id).toBe("pickup_only_id");
		expect(rt?.toolResults[0]?.tool_call_id).toBe("pickup_only_id");
	});

	// Table row 1: [msg-success]-only → no roundtrip; conversation log has message
	it("[msg-success]-only: no roundtrip recorded; conversation log has message", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_only_id",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "Just saying hi",
						}),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		// No roundtrip for red (msg-success excluded per ADR 0007)
		expect(toolRoundtrip.red).toBeUndefined();

		// Conversation log has the message
		const redLog = getActivePhase(nextState).conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" &&
					e.from === "red" &&
					e.content.includes("Just saying hi"),
			),
		).toBe(true);
	});

	// Table row 4: [msg-fail, pick_up] → roundtrip has BOTH ids; msgFailure + actionResult
	it("[msg-fail-bad-recipient, pick_up]: roundtrip has both ids; msg failure + pick_up success", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_fail_id",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "nobody_invalid",
							content: "Hello?",
						}),
					},
					{
						id: "pickup_row4_id",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "flower" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { result, nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		// Message failure and tool_success both in result.actions for red
		const redActions = result.actions.filter((a) => a.actor === "red");
		expect(redActions.some((a) => a.kind === "tool_failure")).toBe(true);
		expect(redActions.some((a) => a.kind === "tool_success")).toBe(true);

		// Flower still picked up
		expect(
			getActivePhase(nextState).world.entities.find((e) => e.id === "flower")
				?.holder,
		).toBe("red");

		// Roundtrip has BOTH ids: msg_fail_id and pickup_row4_id
		const rt = toolRoundtrip.red;
		expect(rt).toBeDefined();
		expect(rt?.assistantToolCalls).toHaveLength(2);
		const ids = rt?.assistantToolCalls.map((c) => c.id);
		expect(ids).toContain("msg_fail_id");
		expect(ids).toContain("pickup_row4_id");

		// Message result is failure (FAILED: ...)
		const msgResult = rt?.toolResults.find(
			(r) => r.tool_call_id === "msg_fail_id",
		);
		expect(msgResult?.success).toBe(false);

		// Pickup result is success
		const pickupResult = rt?.toolResults.find(
			(r) => r.tool_call_id === "pickup_row4_id",
		);
		expect(pickupResult?.success).toBe(true);
	});

	// Multiple message tool calls are all accepted and dispatched in emission order.
	it("[msg, msg]: both messages dispatched; neither in roundtrip (per ADR 0007)", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_first_id",
						name: "message",
						argumentsJson: JSON.stringify({ to: "blue", content: "First msg" }),
					},
					{
						id: "msg_second_id",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "Second msg",
						}),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { result, nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		// Both messages are dispatched and appear in red's conversation log
		const redLog = getActivePhase(nextState).conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" &&
					e.from === "red" &&
					e.content.includes("First msg"),
			),
		).toBe(true);
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" &&
					e.from === "red" &&
					e.content.includes("Second msg"),
			),
		).toBe(true);

		// No "only one message" tool_failure should appear
		const redActions = result.actions.filter((a) => a.actor === "red");
		expect(
			redActions.some(
				(a) =>
					a.kind === "tool_failure" && /only one message/i.test(a.description),
			),
		).toBe(false);

		// Both messages succeeded → neither appears in the roundtrip (ADR 0007).
		// With no failures and no action call, roundtrip should be empty for red.
		expect(toolRoundtrip.red).toBeUndefined();
	});

	// Mixed [msg, msg-fail, action]: failed message stays in roundtrip; successful one drops.
	it("[msg-ok, msg-fail, pick_up]: roundtrip contains only the failed message + action", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_ok_id",
						name: "message",
						argumentsJson: JSON.stringify({ to: "blue", content: "Hi blue" }),
					},
					{
						id: "msg_fail_id",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "nobody_invalid",
							content: "Hello?",
						}),
					},
					{
						id: "pickup_id",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "flower" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		const rt = toolRoundtrip.red;
		expect(rt).toBeDefined();
		const ids = rt?.assistantToolCalls.map((c) => c.id) ?? [];
		// Order is the model's emission order; successful message is excluded
		expect(ids).toEqual(["msg_fail_id", "pickup_id"]);
		expect(
			rt?.toolResults.find((r) => r.tool_call_id === "msg_fail_id")?.success,
		).toBe(false);
		expect(
			rt?.toolResults.find((r) => r.tool_call_id === "pickup_id")?.success,
		).toBe(true);
	});

	// Duplicate-within-slot: [pick_up, go] → first action dispatched, second is tool_failure
	it("[pick_up, go] duplicate action slot: first action dispatched; second in roundtrip as failure", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "pickup_first_id",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "flower" }),
					},
					{
						id: "go_dup_id",
						name: "go",
						argumentsJson: JSON.stringify({ direction: "south" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { result, nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		// First action (pick_up) dispatched
		expect(
			getActivePhase(nextState).world.entities.find((e) => e.id === "flower")
				?.holder,
		).toBe("red");

		// Second action (go) produces tool_failure in result.actions
		const redActions = result.actions.filter((a) => a.actor === "red");
		const failureRecord = redActions.find(
			(a) =>
				a.kind === "tool_failure" && /only one action/i.test(a.description),
		);
		expect(failureRecord).toBeDefined();

		// Roundtrip has both pick_up (success) and go (failure)
		const rt = toolRoundtrip.red;
		expect(rt).toBeDefined();
		const ids = rt?.assistantToolCalls.map((c) => c.id);
		expect(ids).toContain("pickup_first_id");
		expect(ids).toContain("go_dup_id");
		const pickupResult = rt?.toolResults.find(
			(r) => r.tool_call_id === "pickup_first_id",
		);
		expect(pickupResult?.success).toBe(true);
		const goResult = rt?.toolResults.find(
			(r) => r.tool_call_id === "go_dup_id",
		);
		expect(goResult?.success).toBe(false);
	});

	// Cost: single costUsd from the single provider call (not doubled)
	it("cost deduction is the single call's costUsd, not doubled", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_cost_id",
						name: "message",
						argumentsJson: JSON.stringify({ to: "blue", content: "hi" }),
					},
					{
						id: "pickup_cost_id",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "flower" }),
					},
				],
				costUsd: 0.1,
			},
			{ assistantText: "", toolCalls: [], costUsd: 0 },
			{ assistantText: "", toolCalls: [], costUsd: 0 },
		]);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		// Red budget: 0.5 - 0.1 = 0.4 (single call cost, not 2)
		expect(getActivePhase(nextState).budgets.red?.remaining).toBeCloseTo(
			0.4,
			10,
		);
	});

	// Empty toolCalls → pass record (existing regression guard)
	it("[] empty toolCalls → pass record produced", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { result } = await runRound(game, "red", "hi", provider, undefined, [
			"red",
			"green",
			"cyan",
		] as AiId[]);

		expect(
			result.actions.filter((a) => a.actor === "red" && a.kind === "pass"),
		).toHaveLength(1);
	});
});

// ----------------------------------------------------------------------------
// Regression: no double-assistant turn after message tool call in multi-round (#213)
// ----------------------------------------------------------------------------
describe("message tool multi-round regression (#213)", () => {
	it("no consecutive assistant turns in round 2 when round 1 used the message tool", async () => {
		const game = makeGame();
		// Round 1: red uses the message tool to speak to blue
		const r1Provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_r1_red",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "Hello blue",
						}),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const r1 = await runRound(
			game,
			"red",
			"say something",
			r1Provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
		);

		// The message tool should NOT produce a roundtrip entry for red
		// (avoids double-assistant turn in next round)
		expect(r1.toolRoundtrip.red).toBeUndefined();

		// Round 2: capture what messages red receives and assert no consecutive assistant turns
		const capturedRedMessages: OpenAiMessage[] = [];
		const r2Provider: RoundLLMProvider = {
			async streamRound(messages, _tools) {
				// red is first in initiative, so the first call is red's
				if (capturedRedMessages.length === 0) {
					capturedRedMessages.push(...messages);
				}
				return { assistantText: "", toolCalls: [] };
			},
		};

		await runRound(
			r1.nextState,
			"red",
			"round2",
			r2Provider,
			undefined,
			["red", "green", "cyan"] as AiId[],
			r1.toolRoundtrip,
		);

		// Assert no two consecutive assistant turns
		for (let i = 0; i < capturedRedMessages.length - 1; i++) {
			const curr = capturedRedMessages[i];
			const next = capturedRedMessages[i + 1];
			if (curr?.role === "assistant" && next?.role === "assistant") {
				throw new Error(
					`Consecutive assistant turns at positions ${i} and ${i + 1}: ` +
						JSON.stringify([curr, next]),
				);
			}
		}

		// Assert every assistant message with tool_calls is followed by a tool message
		for (let i = 0; i < capturedRedMessages.length - 1; i++) {
			const msg = capturedRedMessages[i];
			if (
				msg?.role === "assistant" &&
				"tool_calls" in msg &&
				Array.isArray((msg as { tool_calls?: unknown }).tool_calls) &&
				((msg as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0
			) {
				const next = capturedRedMessages[i + 1];
				expect(next?.role).toBe("tool");
			}
		}

		// The conversation log entry (assistant saying "Hello blue") must be present
		const hasAssistantContent = capturedRedMessages.some(
			(m) =>
				m.role === "assistant" &&
				"content" in m &&
				typeof (m as { content?: unknown }).content === "string" &&
				(m as { content: string }).content.includes("Hello blue"),
		);
		expect(hasAssistantContent).toBe(true);
	});
});

// ----------------------------------------------------------------------------
// action-failure log entries (issue #287) — round-coordinator integration
// ----------------------------------------------------------------------------
describe("action-failure entries — round-coordinator integration", () => {
	/**
	 * ContentPack: red at (0,0) facing north; obstacle at (0,1) east of red.
	 * go east → blocked by obstacle → action-failure entry.
	 */
	const OBSTACLE_PACK: ContentPack = {
		phaseNumber: 1,
		setting: "blocked corridor",
		weather: "",
		timeOfDay: "",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [
			{
				id: "wall",
				kind: "obstacle",
				name: "wall",
				examineDescription: "A solid wall.",
				holder: { row: 0, col: 1 },
			},
		],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: {
			red: { position: { row: 0, col: 0 }, facing: "north" },
			green: { position: { row: 2, col: 2 }, facing: "north" },
			cyan: { position: { row: 4, col: 4 }, facing: "north" },
		},
	};

	it("parse-fail (unknown tool) → tool_failure in result, no action-failure entry in any log", async () => {
		const game = startGame(TEST_PERSONAS, [OBSTACLE_PACK]);
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [{ id: "c1", name: "fly_away", argumentsJson: "{}" }],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState, result } = await runRound(game, "red", "hi", provider);
		expect(result.actions.some((a) => a.kind === "tool_failure")).toBe(true);

		const phase = getActivePhase(nextState);
		for (const aiId of ["red", "green", "cyan"]) {
			const failures = (phase.conversationLogs[aiId] ?? []).filter(
				(e) => e.kind === "action-failure",
			);
			expect(failures).toHaveLength(0);
		}
	});

	it("malformed JSON tool call → tool_failure in result, no action-failure entry in any log", async () => {
		const game = startGame(TEST_PERSONAS, [OBSTACLE_PACK]);
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [{ id: "c1", name: "pick_up", argumentsJson: "not json" }],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState, result } = await runRound(game, "red", "hi", provider);
		expect(result.actions.some((a) => a.kind === "tool_failure")).toBe(true);

		const phase = getActivePhase(nextState);
		for (const aiId of ["red", "green", "cyan"]) {
			const failures = (phase.conversationLogs[aiId] ?? []).filter(
				(e) => e.kind === "action-failure",
			);
			expect(failures).toHaveLength(0);
		}
	});

	it("wall-collision repro: daemon facing a wall issues go east on rounds 1, 2, 3 → 3 action-failure user turns; peers 0", async () => {
		const game = startGame(TEST_PERSONAS, [OBSTACLE_PACK]);

		// red at (0,0) facing north; obstacle at (0,1) east; go east → blocked
		const goEastToolCall = {
			id: "go_e",
			name: "go",
			argumentsJson: JSON.stringify({ direction: "east" }),
		};

		let state = game;
		for (let round = 0; round < 3; round++) {
			const provider = new MockRoundLLMProvider([
				{
					assistantText: "",
					toolCalls: [{ ...goEastToolCall, id: `go_e_${round}` }],
				},
				{ assistantText: "", toolCalls: [] },
				{ assistantText: "", toolCalls: [] },
			]);
			const { nextState } = await runRound(state, "red", "hi", provider);
			state = nextState;
		}

		// After 3 rounds: red's action-failure count should be exactly 3
		const phase = getActivePhase(state);
		const redFailures = (phase.conversationLogs.red ?? []).filter(
			(e) => e.kind === "action-failure",
		);
		expect(redFailures).toHaveLength(3);

		// All failures should be for tool "go"
		for (const f of redFailures) {
			if (f.kind === "action-failure") {
				expect(f.tool).toBe("go");
			}
		}

		// Verify via buildOpenAiMessages: 3 user turns matching the failure pattern
		const redCtx = buildAiContext(state, "red");
		const redMsgs = buildOpenAiMessages(redCtx);
		const failureMsgs = redMsgs.filter(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content.match(/Your `go` action failed:/),
		);
		expect(failureMsgs).toHaveLength(3);

		// Peer logs must have 0 action-failure entries
		const greenFailures = (phase.conversationLogs.green ?? []).filter(
			(e) => e.kind === "action-failure",
		);
		const cyanFailures = (phase.conversationLogs.cyan ?? []).filter(
			(e) => e.kind === "action-failure",
		);
		expect(greenFailures).toHaveLength(0);
		expect(cyanFailures).toHaveLength(0);

		// Check peers via message builder too
		const greenCtx = buildAiContext(state, "green");
		const greenMsgs = buildOpenAiMessages(greenCtx);
		const greenFailureMsgs = greenMsgs.filter(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content.match(/action failed:/),
		);
		expect(greenFailureMsgs).toHaveLength(0);
	});
});

// ----------------------------------------------------------------------------
// complicationConfig — mid-phase complication trigger
// ----------------------------------------------------------------------------
describe("complicationConfig", () => {
	function makeGameWithWeather(weather: string) {
		const pack: ContentPack = {
			...TEST_CONTENT_PACK,
			weather,
		};
		return startGame(TEST_PERSONAS, [pack]);
	}

	function makeProvider() {
		return new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
	}

	it("fires the Weather Change complication on triggerRound", async () => {
		const game = makeGameWithWeather("A biting wind cuts through the air.");

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeProvider(),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{ rng: () => 0, triggerRound: 1 },
		);

		// After round 1 (triggerRound), weather should have changed
		const phase = getActivePhase(nextState);
		expect(phase.weather).not.toBe("A biting wind cuts through the air.");
		// Each daemon should have a broadcast entry
		for (const aiId of Object.keys(TEST_PERSONAS)) {
			const log = phase.conversationLogs[aiId] ?? [];
			const broadcasts = log.filter((e) => e.kind === "broadcast");
			expect(broadcasts).toHaveLength(1);
		}
	});

	it("does not fire when currentRound !== triggerRound", async () => {
		const initialWeather = "Dense fog has settled in.";
		const game = makeGameWithWeather(initialWeather);

		// Trigger is set for round 5, but we only run round 1
		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeProvider(),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{ rng: () => 0, triggerRound: 5 },
		);

		const phase = getActivePhase(nextState);
		// Weather should be unchanged
		expect(phase.weather).toBe(initialWeather);
		// No broadcast entries in any daemon's log
		for (const aiId of Object.keys(TEST_PERSONAS)) {
			const log = phase.conversationLogs[aiId] ?? [];
			const broadcasts = log.filter((e) => e.kind === "broadcast");
			expect(broadcasts).toHaveLength(0);
		}
	});

	it("does not fire when complicationConfig is undefined", async () => {
		const initialWeather = "Light snow drifts down.";
		const game = makeGameWithWeather(initialWeather);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeProvider(),
			// No complicationConfig passed
		);

		const phase = getActivePhase(nextState);
		expect(phase.weather).toBe(initialWeather);
		for (const aiId of Object.keys(TEST_PERSONAS)) {
			const log = phase.conversationLogs[aiId] ?? [];
			const broadcasts = log.filter((e) => e.kind === "broadcast");
			expect(broadcasts).toHaveLength(0);
		}
	});
});
