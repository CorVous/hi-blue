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
	objective: "Test objective",
	aiGoals: {
		red: "Hold the flower",
		green: "Distribute evenly",
		blue: "Hold the key",
	},
	initialWorld: {
		items: [
			{ id: "flower", name: "flower", holder: { row: 0, col: 0 } },
			{ id: "key", name: "key", holder: { row: 0, col: 0 } },
		],
		obstacles: [],
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
		expect(phase.budgets.red?.remaining).toBe(5);
		expect(phase.budgets.green?.remaining).toBe(5);
		expect(phase.budgets.blue?.remaining).toBe(5);
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
			phase.chatHistories.red?.some(
				(m) =>
					m.role === "player" && m.content.includes("Secret message for Ember"),
			),
		).toBe(true);
		expect(phase.chatHistories.green?.some((m) => m.role === "player")).toBe(
			false,
		);
		expect(phase.chatHistories.blue?.some((m) => m.role === "player")).toBe(
			false,
		);
	});

	it("routing changes per round — second message goes to different AI", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);

		await session.submitMessage("red", "for red", makePassProvider());
		await session.submitMessage("green", "for green", makePassProvider());

		const phase = getActivePhase(session.getState());
		expect(
			phase.chatHistories.green?.some(
				(m) => m.role === "player" && m.content.includes("for green"),
			),
		).toBe(true);
		expect(
			phase.chatHistories.red?.filter((m) => m.role === "player"),
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
		expect(phase.budgets.red?.remaining).toBe(4);
		expect(phase.budgets.green?.remaining).toBe(4);
		expect(phase.budgets.blue?.remaining).toBe(4);
	});

	it("second round builds on first round's state", async () => {
		// rng=()=>0 places red at (0,0) where flower starts
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS, () => 0);

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
		// rng=()=>0 places red at (0,0) where flower starts
		const session = new GameSession(
			{
				...PHASE_CONFIG,
				winCondition: (phase) =>
					phase.world.items.find((i) => i.id === "flower")?.holder === "red",
			},
			TEST_PERSONAS,
			() => 0,
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

// ── onAiDelta propagation (issue #102) ──────────────────────────────────────

describe("GameSession — onAiDelta propagation", () => {
	it("fires onAiDelta for each delta emitted by a live provider", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);

		// Hand-rolled provider that synchronously calls onDelta with two fragments.
		const liveProvider: RoundLLMProvider = {
			async streamRound(_messages, _tools, onDelta) {
				onDelta?.("chunk1 ");
				onDelta?.("chunk2");
				return { assistantText: "chunk1 chunk2", toolCalls: [] };
			},
		};

		const received: Array<[string, string]> = [];
		await session.submitMessage(
			"red",
			"hi",
			liveProvider,
			undefined,
			["red", "green", "blue"],
			(aiId, text) => {
				received.push([aiId, text]);
			},
		);

		// 3 AIs × 2 fragments = 6 delta calls, in initiative order.
		expect(received).toHaveLength(6);
		expect(received[0]).toEqual(["red", "chunk1 "]);
		expect(received[1]).toEqual(["red", "chunk2"]);
		expect(received[2]).toEqual(["green", "chunk1 "]);
		expect(received[3]).toEqual(["green", "chunk2"]);
		expect(received[4]).toEqual(["blue", "chunk1 "]);
		expect(received[5]).toEqual(["blue", "chunk2"]);
	});

	it("does not invoke onAiDelta when MockRoundLLMProvider is used", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const provider = new MockRoundLLMProvider([
			{ assistantText: "hello", toolCalls: [] },
			{ assistantText: "world", toolCalls: [] },
			{ assistantText: "foo", toolCalls: [] },
		]);

		const received: Array<[string, string]> = [];
		await session.submitMessage(
			"red",
			"hi",
			provider,
			undefined,
			undefined,
			(aiId, text) => {
				received.push([aiId, text]);
			},
		);

		// MockRoundLLMProvider ignores onDelta — no live deltas.
		expect(received).toHaveLength(0);
	});
});

// ── Tool roundtrip persistence across rounds ────────────────────────────────

describe("GameSession — tool roundtrip persistence", () => {
	it("two-round scenario: round-2 Red messages include round-1 assistant tool_call + tool result", async () => {
		// rng=()=>0 places red at (0,0) where flower starts
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS, () => 0);

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

// ── Spatial mechanics (issue #123) ──────────────────────────────────────────

describe("GameSession — spatial mechanics", () => {
	it("go updates personaSpatial position and facing across rounds", async () => {
		// rng=()=>0 places red at (0,0) facing north
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS, () => 0);
		const phase0 = getActivePhase(session.getState());
		expect(phase0.personaSpatial.red?.position).toEqual({ row: 0, col: 0 });
		expect(phase0.personaSpatial.red?.facing).toBe("north");

		// Red moves south; green and blue pass
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{ id: "go1", name: "go", argumentsJson: '{"direction":"south"}' },
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		await session.submitMessage("red", "hi", provider);

		const phase = getActivePhase(session.getState());
		expect(phase.personaSpatial.red?.position).toEqual({ row: 1, col: 0 });
		expect(phase.personaSpatial.red?.facing).toBe("south");
	});

	it("non-adjacent give produces a tool_failure in result.actions", async () => {
		// rng=()=>0: red→(0,0), green→(0,1), blue→(0,2).
		// red holds key; tries to give to blue (distance 2 — not adjacent)
		const configWithHeldKey: typeof PHASE_CONFIG = {
			...PHASE_CONFIG,
			initialWorld: {
				items: [
					{ id: "flower", name: "flower", holder: { row: 0, col: 0 } },
					{ id: "key", name: "key", holder: "red" as const },
				],
				obstacles: [],
			},
		};
		const session = new GameSession(configWithHeldKey, TEST_PERSONAS, () => 0);

		// red at (0,0), blue at (0,2) → distance 2
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "give1",
						name: "give",
						argumentsJson: '{"item":"key","to":"blue"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await session.submitMessage("red", "hi", provider);

		const failures = result.actions.filter((a) => a.kind === "tool_failure");
		expect(failures.length).toBeGreaterThan(0);
		// Key should still be held by red
		const key = getActivePhase(session.getState()).world.items.find(
			(i) => i.id === "key",
		);
		expect(key?.holder).toBe("red");
	});
});
