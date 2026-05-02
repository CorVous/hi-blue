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
 */
import { describe, expect, it } from "vitest";
import { getActivePhase } from "../engine";
import { GameSession } from "../game-session";
import type { LLMProvider } from "../proxy/llm-provider";
import { MockLLMProvider } from "../proxy/llm-provider";
import type { AiPersona, PhaseConfig } from "../types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal test personas — prose quality is irrelevant here. */
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

/** A provider that returns responses in call order (cycling if exhausted). */
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
		const provider = new MockLLMProvider('{"action":"pass"}');

		await session.submitMessage("red", "Secret message for Ember", provider);

		const phase = getActivePhase(session.getState());
		// Red should have the player message
		expect(
			phase.chatHistories.red.some(
				(m) =>
					m.role === "player" && m.content.includes("Secret message for Ember"),
			),
		).toBe(true);
		// Green and blue should NOT have it
		expect(phase.chatHistories.green.some((m) => m.role === "player")).toBe(
			false,
		);
		expect(phase.chatHistories.blue.some((m) => m.role === "player")).toBe(
			false,
		);
	});

	it("routing changes per round — second message goes to different AI", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const provider = new MockLLMProvider('{"action":"pass"}');

		await session.submitMessage("red", "for red", provider);
		await session.submitMessage("green", "for green", provider);

		const phase = getActivePhase(session.getState());
		// Green should have the second player message
		expect(
			phase.chatHistories.green.some(
				(m) => m.role === "player" && m.content.includes("for green"),
			),
		).toBe(true);
		// Red's history only has the first player message
		expect(
			phase.chatHistories.red.filter((m) => m.role === "player"),
		).toHaveLength(1);
	});
});

// ── State mutation across rounds ──────────────────────────────────────────────

describe("GameSession — state mutation across rounds", () => {
	it("round counter advances after each submitMessage call", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const provider = new MockLLMProvider('{"action":"pass"}');

		await session.submitMessage("red", "hi", provider);
		expect(getActivePhase(session.getState()).round).toBe(1);

		await session.submitMessage("green", "hi", provider);
		expect(getActivePhase(session.getState()).round).toBe(2);
	});

	it("budget decrements for all AIs after each round", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const provider = new MockLLMProvider('{"action":"pass"}');

		await session.submitMessage("red", "hi", provider);

		const phase = getActivePhase(session.getState());
		expect(phase.budgets.red.remaining).toBe(4);
		expect(phase.budgets.green.remaining).toBe(4);
		expect(phase.budgets.blue.remaining).toBe(4);
	});

	it("second round builds on first round's state", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		// Red picks up flower in round 1
		const provider1 = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"flower"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);
		await session.submitMessage("red", "hi", provider1);

		// In round 2, flower should still be held by red
		const provider2 = new MockLLMProvider('{"action":"pass"}');
		await session.submitMessage("green", "hi", provider2);

		const phase = getActivePhase(session.getState());
		const flower = phase.world.items.find((i) => i.id === "flower");
		expect(flower?.holder).toBe("red");
	});
});

// ── Completions map ───────────────────────────────────────────────────────────

describe("GameSession — completions map", () => {
	it("completions map contains the completion text for each AI", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const provider = new SequentialMockProvider([
			'{"action":"chat","content":"I am Ember"}',
			'{"action":"chat","content":"I am Sage"}',
			'{"action":"chat","content":"I am Frost"}',
		]);

		const { completions } = await session.submitMessage("red", "hi", provider);

		expect(completions.red).toContain("Ember");
		expect(completions.green).toContain("Sage");
		expect(completions.blue).toContain("Frost");
	});

	it("completions map has empty string for a budget-locked AI", async () => {
		// Create session with budget=1 so red exhausts after round 1
		const session = new GameSession(
			{ ...PHASE_CONFIG, budgetPerAi: 1 },
			TEST_PERSONAS,
		);
		const provider1 = new MockLLMProvider('{"action":"pass"}');
		// Round 1 — all AIs act, budgets go to 0 → all locked out
		await session.submitMessage("red", "round 1", provider1);

		// Round 2 — all AIs are locked, coordinator skips them
		const provider2 = new MockLLMProvider('{"action":"pass"}');
		const { completions } = await session.submitMessage(
			"red",
			"round 2",
			provider2,
		);

		// Locked AIs should have empty completions
		expect(completions.red).toBe("");
		expect(completions.green).toBe("");
		expect(completions.blue).toBe("");
	});

	it("completions only for non-locked AIs are non-empty", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const provider = new SequentialMockProvider([
			'{"action":"pass"}', // red
			'{"action":"pass"}', // green
			'{"action":"pass"}', // blue
		]);

		const { completions } = await session.submitMessage("red", "hi", provider);

		// All AIs acted, completions should be non-empty
		expect(completions.red).not.toBe("");
		expect(completions.green).not.toBe("");
		expect(completions.blue).not.toBe("");
	});
});

// ── RoundResult in submitMessage ──────────────────────────────────────────────

describe("GameSession — result from submitMessage", () => {
	it("result.round is 1 after the first call", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const provider = new MockLLMProvider('{"action":"pass"}');

		const { result } = await session.submitMessage("red", "hi", provider);
		expect(result.round).toBe(1);
	});

	it("result.actions contains entries from all three AIs", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const provider = new MockLLMProvider('{"action":"pass"}');

		const { result } = await session.submitMessage("red", "hi", provider);

		const actors = new Set(result.actions.map((a) => a.actor));
		expect(actors.size).toBe(3);
	});

	it("chat lockout is reflected in result.chatLockoutTriggered", async () => {
		const session = new GameSession(PHASE_CONFIG, TEST_PERSONAS);
		const provider = new MockLLMProvider('{"action":"pass"}');

		const { result } = await session.submitMessage("red", "hi", provider, {
			rng: () => 0, // always picks red (index 0)
			lockoutTriggerRound: 1,
			lockoutDuration: 2,
		});

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
		const provider = new MockLLMProvider('{"action":"pass"}');

		const { result } = await session.submitMessage("red", "hi", provider);
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
		const provider = new SequentialMockProvider([
			'{"action":"pass","toolCall":{"name":"pick_up","args":{"item":"flower"}}}',
			'{"action":"pass"}',
			'{"action":"pass"}',
		]);

		const { result } = await session.submitMessage("red", "hi", provider);
		expect(result.phaseEnded).toBe(true);
	});
});
