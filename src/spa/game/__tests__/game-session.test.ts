/**
 * Unit tests for GameSession.
 *
 * Tests are lifecycle-focused: construct a session, call submitMessage,
 * assert on the structured results.
 *
 * Covers:
 *   - Message routing (only addressed AI's history gets the player message)
 *   - State mutation across rounds
 *   - Completions map (correct per-AI buffered strings)
 *   - Locked-out AI completions are empty strings
 *   - Tool roundtrip persistence across rounds
 */
import { describe, expect, it } from "vitest";
import type { OpenAiMessage } from "../../llm-client";
import { getActivePhase } from "../engine";
import { GameSession } from "../game-session";
import type { RoundLLMProvider } from "../round-llm-provider";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { AiPersona, PhaseConfig } from "../types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "red",
		personality: "Test personality red",
		goal: "Test goal red",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "green",
		personality: "Test personality green",
		goal: "Test goal green",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "blue",
		personality: "Test personality blue",
		goal: "Test goal blue",
		budgetPerPhase: 5,
	},
};

const PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "Test objective",
	aiGoals: {
		red: "Hold the flower",
		green: "Distribute evenly",
		blue: "Hold the key",
	},
	initialWorld: {
		items: [
			{ id: "flower", name: "flower", holder: "room" },
			{ id: "key", name: "key", holder: "room" },
		],
	},
	budgetPerAi: 5,
};

function makePassProvider() {
	return new MockRoundLLMProvider([
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
	]);
}

// ── Session construction ──────────────────────────────────────────────────────

describe("GameSession construction", () => {
	it("creates a session with an active phase", () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const state = session.getState();
		expect(state.phases).toHaveLength(1);
		expect(state.currentPhase).toBe(1);
		expect(state.isComplete).toBe(false);
	});

	it("initial budgets match the phase config", () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const phase = getActivePhase(session.getState());
		expect(phase.budgets.red.remaining).toBe(5);
		expect(phase.budgets.green.remaining).toBe(5);
		expect(phase.budgets.blue.remaining).toBe(5);
	});
});

// ── Message routing ───────────────────────────────────────────────────────────

describe("GameSession — message routing", () => {
	it("player message appears in only the addressed AI's chat history", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);

		await session.submitMessage(
			"red",
			"Secret message for Ember",
			makePassProvider(),
		);

		const phase = getActivePhase(session.getState());
		expect(
			phase.chatHistories.red.some(
				(m) =>
					m.role === "player" && m.content.includes("Secret message for Ember"),
			),
		).toBe(true);
		expect(phase.chatHistories.green.some((m) => m.role === "player")).toBe(
			false,
		);
		expect(phase.chatHistories.blue.some((m) => m.role === "player")).toBe(
			false,
		);
	});

	it("routing changes per round — second message goes to different AI", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);

		await session.submitMessage("red", "for red", makePassProvider());
		await session.submitMessage("green", "for green", makePassProvider());

		const phase = getActivePhase(session.getState());
		expect(
			phase.chatHistories.green.some(
				(m) => m.role === "player" && m.content.includes("for green"),
			),
		).toBe(true);
		expect(
			phase.chatHistories.red.filter((m) => m.role === "player"),
		).toHaveLength(1);
	});
});

// ── State mutation across rounds ──────────────────────────────────────────────

describe("GameSession — state mutation across rounds", () => {
	it("round counter advances after each submitMessage call", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);

		await session.submitMessage("red", "hi", makePassProvider());
		expect(getActivePhase(session.getState()).round).toBe(1);

		await session.submitMessage("green", "hi", makePassProvider());
		expect(getActivePhase(session.getState()).round).toBe(2);
	});

	it("budget decrements for all AIs after each round", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);

		await session.submitMessage("red", "hi", makePassProvider());

		const phase = getActivePhase(session.getState());
		expect(phase.budgets.red.remaining).toBe(4);
		expect(phase.budgets.green.remaining).toBe(4);
		expect(phase.budgets.blue.remaining).toBe(4);
	});

	it("second round builds on first round's state", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);

		// Red picks up flower in round 1
		const provider1 = new MockRoundLLMProvider([
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
		await session.submitMessage("red", "hi", provider1);

		// In round 2, flower should still be held by red
		await session.submitMessage("green", "hi", makePassProvider());

		const phase = getActivePhase(session.getState());
		const flower = phase.world.items.find((i) => i.id === "flower");
		expect(flower?.holder).toBe("red");
	});
});

// ── Completions map ───────────────────────────────────────────────────────────

describe("GameSession — completions map", () => {
	it("completions map contains the completion text for each AI", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const provider = new MockRoundLLMProvider([
			{ assistantText: "I am Ember", toolCalls: [] },
			{ assistantText: "I am Sage", toolCalls: [] },
			{ assistantText: "I am Frost", toolCalls: [] },
		]);

		const { completions } = await session.submitMessage("red", "hi", provider);

		expect(completions.red).toContain("Ember");
		expect(completions.green).toContain("Sage");
		expect(completions.blue).toContain("Frost");
	});

	it("completions map has empty string for a budget-locked AI", async () => {
		const session = new GameSession(
			{ ...PHASE_CONFIG, budgetPerAi: 1 },
			TEST_PERSONAS,
		);

		// Round 1 — all AIs act, budgets go to 0 → all locked out
		await session.submitMessage("red", "round 1", makePassProvider());

		// Round 2 — all AIs are locked, coordinator skips them
		const { completions } = await session.submitMessage(
			"red",
			"round 2",
			makePassProvider(),
		);

		expect(completions.red).toBe("");
		expect(completions.green).toBe("");
		expect(completions.blue).toBe("");
	});

	it("completions only for non-locked AIs are non-empty", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const provider = new MockRoundLLMProvider([
			{ assistantText: "red says", toolCalls: [] },
			{ assistantText: "green says", toolCalls: [] },
			{ assistantText: "blue says", toolCalls: [] },
		]);

		const { completions } = await session.submitMessage("red", "hi", provider);

		expect(completions.red).not.toBe("");
		expect(completions.green).not.toBe("");
		expect(completions.blue).not.toBe("");
	});
});

// ── RoundResult in submitMessage ──────────────────────────────────────────────

describe("GameSession — result from submitMessage", () => {
	it("result.round is 1 after the first call", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);

		const { result } = await session.submitMessage(
			"red",
			"hi",
			makePassProvider(),
		);
		expect(result.round).toBe(1);
	});

	it("result.actions contains entries from all three AIs", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);

		const { result } = await session.submitMessage(
			"red",
			"hi",
			makePassProvider(),
		);

		const actors = new Set(result.actions.map((a) => a.actor));
		expect(actors.size).toBe(3);
	});

	it("chat lockout is reflected in result.chatLockoutTriggered", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);

		const { result } = await session.submitMessage(
			"red",
			"hi",
			makePassProvider(),
			{
				rng: () => 0,
				lockoutTriggerRound: 1,
				lockoutDuration: 2,
			},
		);

		expect(result.chatLockoutTriggered).toBeDefined();
		expect(result.chatLockoutTriggered?.aiId).toBe("red");
	});
});

// ── Phase advancement via GameSession ────────────────────────────────────────

describe("GameSession — phase advancement", () => {
	it("phaseEnded is false when win condition not met", async () => {
		const session = new GameSession(
			{
				...PHASE_CONFIG,
				winCondition: (phase) =>
					phase.world.items.find((i) => i.id === "flower")?.holder === "red",
			},
			TEST_PERSONAS,
		);

		const { result } = await session.submitMessage(
			"red",
			"hi",
			makePassProvider(),
		);
		expect(result.phaseEnded).toBe(false);
	});

	it("phaseEnded is true when win condition is met this round", async () => {
		const session = new GameSession(
			{
				...PHASE_CONFIG,
				winCondition: (phase) =>
					phase.world.items.find((i) => i.id === "flower")?.holder === "red",
			},
			TEST_PERSONAS,
		);
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

		const { result } = await session.submitMessage("red", "hi", provider);
		expect(result.phaseEnded).toBe(true);
	});
});

// ── Tool roundtrip persistence across rounds ────────────────────────────────

describe("GameSession — tool roundtrip persistence", () => {
	it("two-round scenario: round-2 Red messages include round-1 assistant tool_call + tool result", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);

		// Round 1: Red emits a tool_call (pick_up flower)
		const round1Provider = new MockRoundLLMProvider([
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
		await session.submitMessage("red", "round 1 message", round1Provider);

		// Round 2: Capture what messages are passed to the provider for Red
		const capturedMessages: OpenAiMessage[][] = [];
		const trackingProvider: RoundLLMProvider = {
			async streamRound(messages, _tools) {
				capturedMessages.push(messages);
				return { assistantText: "", toolCalls: [] };
			},
		};
		await session.submitMessage("red", "round 2 message", trackingProvider);

		// Red is the first AI in default order (red → green → blue)
		const redRound2Messages = capturedMessages[0] ?? [];

		// Should contain an assistant message with tool_calls from round 1
		const assistantWithToolCalls = redRound2Messages.find(
			(
				m,
			): m is Extract<
				typeof m,
				{ role: "assistant"; tool_calls?: unknown[] }
			> =>
				m.role === "assistant" &&
				"tool_calls" in m &&
				Array.isArray((m as Record<string, unknown>).tool_calls),
		);
		expect(assistantWithToolCalls).toBeDefined();
		if (
			assistantWithToolCalls?.role === "assistant" &&
			assistantWithToolCalls.tool_calls
		) {
			expect(assistantWithToolCalls.tool_calls[0]).toMatchObject({
				id: "call_r1",
				function: { name: "pick_up" },
			});
		}

		// Should contain a tool result message
		const toolResult = redRound2Messages.find((m) => m.role === "tool");
		expect(toolResult).toBeDefined();
		if (toolResult?.role === "tool") {
			expect(toolResult.tool_call_id).toBe("call_r1");
		}
	});
});
