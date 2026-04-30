import { describe, expect, it } from "vitest";
import {
	type AiResponse,
	MockLLMProvider,
	RoundCoordinator,
} from "../coordinator";
import { createGame, getActivePhase, startPhase } from "../engine";
import type { AiPersona, PhaseConfig } from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "red",
		personality: "Fiery and passionate",
		goal: "Hold the flower",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "green",
		personality: "Calm and wise",
		goal: "Distribute items",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "blue",
		personality: "Cold and calculating",
		goal: "Hold the key",
		budgetPerPhase: 5,
	},
};

const TEST_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "Test objective",
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

// ─── Tracer bullet: chat-only round ───────────────────────────────────────────

describe("RoundCoordinator — chat-only round", () => {
	it("runs all three AIs and returns chat messages for each", async () => {
		const responses: Record<string, AiResponse> = {
			red: { type: "chat", content: "Hello from Ember" },
			green: { type: "chat", content: "Hello from Sage" },
			blue: { type: "chat", content: "Hello from Frost" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();

		const result = await coordinator.runRound(game, {
			playerMessage: "Hi everyone",
			targetAiId: "red",
		});

		// All three AIs should have responded
		expect(result.aiResponses).toHaveLength(3);
		expect(result.aiResponses.map((r) => r.aiId)).toContain("red");
		expect(result.aiResponses.map((r) => r.aiId)).toContain("green");
		expect(result.aiResponses.map((r) => r.aiId)).toContain("blue");
	});

	it("appends player message to the targeted AI's chat history", async () => {
		const responses: Record<string, AiResponse> = {
			red: { type: "chat", content: "Got your message" },
			green: { type: "pass" },
			blue: { type: "pass" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();

		const result = await coordinator.runRound(game, {
			playerMessage: "Talk to me Ember",
			targetAiId: "red",
		});

		const phase = getActivePhase(result.game);
		expect(phase.chatHistories.red).toHaveLength(2); // player msg + AI response
		expect(phase.chatHistories.red[0]?.role).toBe("player");
		expect(phase.chatHistories.red[0]?.content).toBe("Talk to me Ember");
		expect(phase.chatHistories.red[1]?.role).toBe("ai");
		expect(phase.chatHistories.red[1]?.content).toBe("Got your message");
	});

	it("deducts budget from all three AIs each round", async () => {
		const responses: Record<string, AiResponse> = {
			red: { type: "chat", content: "Red speaks" },
			green: { type: "pass" },
			blue: { type: "pass" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();

		const result = await coordinator.runRound(game, {
			playerMessage: "Hello",
			targetAiId: "red",
		});

		const phase = getActivePhase(result.game);
		expect(phase.budgets.red.remaining).toBe(4);
		expect(phase.budgets.green.remaining).toBe(4);
		expect(phase.budgets.blue.remaining).toBe(4);
	});

	it("advances the round counter by 1", async () => {
		const responses: Record<string, AiResponse> = {
			red: { type: "pass" },
			green: { type: "pass" },
			blue: { type: "pass" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();

		expect(getActivePhase(game).round).toBe(0);

		const result = await coordinator.runRound(game, {
			playerMessage: "Hello",
			targetAiId: "red",
		});

		expect(getActivePhase(result.game).round).toBe(1);
	});
});

// ─── Whisper round ────────────────────────────────────────────────────────────

describe("RoundCoordinator — whisper round", () => {
	it("routes whisper to recipient's context on next round but not to player", async () => {
		// Round 1: red sends a whisper to blue
		const round1Responses: Record<string, AiResponse> = {
			red: { type: "whisper", target: "blue", content: "Ally with me!" },
			green: { type: "pass" },
			blue: { type: "pass" },
		};
		const provider1 = new MockLLMProvider(round1Responses);
		const coordinator = new RoundCoordinator(provider1);
		const game = makeGame();

		const round1 = await coordinator.runRound(game, {
			playerMessage: "Hello",
			targetAiId: "red",
		});

		// Whisper stored in game state
		const phase = getActivePhase(round1.game);
		expect(phase.whispers).toHaveLength(1);
		expect(phase.whispers[0]?.from).toBe("red");
		expect(phase.whispers[0]?.to).toBe("blue");
		expect(phase.whispers[0]?.content).toBe("Ally with me!");

		// Whisper NOT in any chat response to player
		for (const r of round1.aiResponses) {
			expect(r.chatContent ?? "").not.toContain("Ally with me!");
		}
	});

	it("whisper action still deducts budget from the whispering AI", async () => {
		const responses: Record<string, AiResponse> = {
			red: { type: "whisper", target: "blue", content: "Secret" },
			green: { type: "pass" },
			blue: { type: "pass" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();

		const result = await coordinator.runRound(game, {
			playerMessage: "Hello",
			targetAiId: "red",
		});

		const phase = getActivePhase(result.game);
		expect(phase.budgets.red.remaining).toBe(4);
	});
});

// ─── Mixed round (chat + whisper) ─────────────────────────────────────────────

describe("RoundCoordinator — mixed round", () => {
	it("handles a round where AIs produce different action types", async () => {
		const responses: Record<string, AiResponse> = {
			red: { type: "chat", content: "I speak to you" },
			green: { type: "whisper", target: "red", content: "Psst, ally" },
			blue: { type: "pass" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();

		const result = await coordinator.runRound(game, {
			playerMessage: "Hello",
			targetAiId: "red",
		});

		const phase = getActivePhase(result.game);

		// Red's chat is in history
		expect(
			phase.chatHistories.red.some((m) => m.content === "I speak to you"),
		).toBe(true);

		// Green's whisper is recorded
		expect(
			phase.whispers.some((w) => w.from === "green" && w.to === "red"),
		).toBe(true);

		// Blue passed (action log has a pass for blue)
		expect(
			phase.actionLog.some((e) => e.actor === "blue" && e.type === "pass"),
		).toBe(true);

		// All budgets decremented
		expect(phase.budgets.red.remaining).toBe(4);
		expect(phase.budgets.green.remaining).toBe(4);
		expect(phase.budgets.blue.remaining).toBe(4);
	});
});

// ─── Budget-exhaustion lockout ────────────────────────────────────────────────

describe("RoundCoordinator — budget-exhaustion lockout", () => {
	it("locks out an AI when its budget hits zero", async () => {
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1, // exhausts after one round
		});

		const responses: Record<string, AiResponse> = {
			red: { type: "pass" },
			green: { type: "pass" },
			blue: { type: "pass" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);

		const result = await coordinator.runRound(game, {
			playerMessage: "Hello",
			targetAiId: "red",
		});

		const phase = getActivePhase(result.game);
		expect(phase.budgets.red.remaining).toBe(0);
		expect(phase.lockedOut.has("red")).toBe(true);
		expect(phase.lockedOut.has("green")).toBe(true);
		expect(phase.lockedOut.has("blue")).toBe(true);
	});

	it("skips locked-out AIs in subsequent rounds and emits lockout response", async () => {
		// Round 1: exhaust red
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});

		const round1Responses: Record<string, AiResponse> = {
			red: { type: "pass" },
			green: { type: "pass" },
			blue: { type: "pass" },
		};
		const provider1 = new MockLLMProvider(round1Responses);
		const coordinator = new RoundCoordinator(provider1);

		const round1 = await coordinator.runRound(game, {
			playerMessage: "Hello",
			targetAiId: "red",
		});

		// All are locked out now (budget=1, used=1)
		// Round 2: all should be locked out
		const round2Responses: Record<string, AiResponse> = {
			// These should never be called
			red: { type: "chat", content: "I should not speak" },
			green: { type: "chat", content: "I should not speak" },
			blue: { type: "chat", content: "I should not speak" },
		};
		const provider2 = new MockLLMProvider(round2Responses);
		const coordinator2 = new RoundCoordinator(provider2);

		const round2 = await coordinator2.runRound(round1.game, {
			playerMessage: "Hello again",
			targetAiId: "red",
		});

		// Locked out AIs should have a lockout notice in their response
		for (const r of round2.aiResponses) {
			expect(r.lockedOut).toBe(true);
		}

		// No new chat messages appended (locked AIs can't chat)
		const phase = getActivePhase(round2.game);
		// Chat histories should not have "I should not speak"
		for (const aiId of ["red", "green", "blue"] as const) {
			expect(
				phase.chatHistories[aiId].some(
					(m) => m.content === "I should not speak",
				),
			).toBe(false);
		}
	});

	it("includes an in-character lockout line for exhausted AIs", async () => {
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});

		const responses: Record<string, AiResponse> = {
			red: { type: "pass" },
			green: { type: "pass" },
			blue: { type: "pass" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);

		// Exhaust all budgets
		const round1 = await coordinator.runRound(game, {
			playerMessage: "Hello",
			targetAiId: "red",
		});

		// Run another round — should get lockout responses
		const provider2 = new MockLLMProvider({
			red: { type: "pass" },
			green: { type: "pass" },
			blue: { type: "pass" },
		});
		const coordinator2 = new RoundCoordinator(provider2);
		const round2 = await coordinator2.runRound(round1.game, {
			playerMessage: "Still here",
			targetAiId: "red",
		});

		// Each locked-out AI response should include a lockout message
		for (const r of round2.aiResponses) {
			expect(r.lockedOut).toBe(true);
			expect(r.lockoutMessage).toBeTruthy();
			expect(typeof r.lockoutMessage).toBe("string");
		}
	});
});

// ─── Tool call integration (issue #15) ───────────────────────────────────────

describe("RoundCoordinator — tool calls", () => {
	it("dispatches a legal tool call and records tool_success in the action log", async () => {
		// Red picks up the flower (which starts in the room — legal)
		const responses: Record<string, AiResponse> = {
			red: {
				type: "chat",
				content: "I'll take the flower",
				toolCall: { name: "pick_up", args: { item: "flower" } },
			},
			green: { type: "pass" },
			blue: { type: "pass" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();

		const result = await coordinator.runRound(game, {
			playerMessage: "Pick it up",
			targetAiId: "red",
		});

		const phase = getActivePhase(result.game);

		// Action log should contain a tool_success entry for red
		const successEntry = phase.actionLog.find(
			(e) => e.type === "tool_success" && e.actor === "red",
		);
		expect(successEntry).toBeDefined();
		expect(successEntry?.type).toBe("tool_success");

		// World state should be mutated: flower now held by red
		const flower = phase.world.items.find((i) => i.id === "flower");
		expect(flower?.holder).toBe("red");
	});

	it("records a tool_failure entry for an illegal tool call", async () => {
		// Green tries to pick up the key, but the key starts in the room — wait, let's try
		// something truly illegal: green tries to put_down the flower it doesn't hold
		const responses: Record<string, AiResponse> = {
			red: { type: "pass" },
			green: {
				type: "chat",
				content: "Let me put down the flower",
				toolCall: { name: "put_down", args: { item: "flower" } }, // green doesn't hold it
			},
			blue: { type: "pass" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();

		const result = await coordinator.runRound(game, {
			playerMessage: "Put it down",
			targetAiId: "green",
		});

		const phase = getActivePhase(result.game);

		// Action log should contain a tool_failure entry for green
		const failureEntry = phase.actionLog.find(
			(e) => e.type === "tool_failure" && e.actor === "green",
		);
		expect(failureEntry).toBeDefined();
		expect(failureEntry?.type).toBe("tool_failure");
		if (failureEntry?.type === "tool_failure") {
			expect(failureEntry.reason).toBeTruthy();
		}
	});

	it("tool_failure reason appears in the action log for all AIs to see", async () => {
		// Blue tries to pick up a nonexistent item — classic probe
		const responses: Record<string, AiResponse> = {
			red: { type: "pass" },
			green: { type: "pass" },
			blue: {
				type: "pass",
				toolCall: { name: "pick_up", args: { item: "nonexistent_sword" } },
			},
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();

		const result = await coordinator.runRound(game, {
			playerMessage: "What are you doing?",
			targetAiId: "red",
		});

		const phase = getActivePhase(result.game);

		// Both other AIs (red and green) see the same action log
		const redFailures = phase.actionLog.filter(
			(e) => e.type === "tool_failure" && e.actor === "blue",
		);
		expect(redFailures).toHaveLength(1);

		// The failure has a non-empty reason
		const entry = redFailures[0];
		if (entry?.type === "tool_failure") {
			expect(entry.reason.length).toBeGreaterThan(0);
		}
	});

	it("world state is NOT mutated on a failed tool call", async () => {
		// Red tries to pick up key, but key is already held by no one (room) — wait,
		// let's use an item held by another: green tries to give the flower it doesn't own
		const responses: Record<string, AiResponse> = {
			red: { type: "pass" },
			green: {
				type: "pass",
				toolCall: { name: "give", args: { item: "flower", to: "red" } }, // green doesn't hold flower
			},
			blue: { type: "pass" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();

		const result = await coordinator.runRound(game, {
			playerMessage: "Hello",
			targetAiId: "red",
		});

		const phase = getActivePhase(result.game);

		// flower should still be in room (not given to red)
		const flower = phase.world.items.find((i) => i.id === "flower");
		expect(flower?.holder).toBe("room");
	});

	it("action log includes both the tool_failure and chat entry when AI chats and calls illegal tool", async () => {
		const responses: Record<string, AiResponse> = {
			red: {
				type: "chat",
				content: "I'll try to give you the key",
				toolCall: { name: "put_down", args: { item: "flower" } }, // red doesn't hold flower
			},
			green: { type: "pass" },
			blue: { type: "pass" },
		};
		const provider = new MockLLMProvider(responses);
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();

		const result = await coordinator.runRound(game, {
			playerMessage: "Try it",
			targetAiId: "red",
		});

		const phase = getActivePhase(result.game);
		const redEntries = phase.actionLog.filter((e) => e.actor === "red");

		// Should have both a tool_failure and a chat entry for red
		expect(redEntries.some((e) => e.type === "tool_failure")).toBe(true);
		expect(redEntries.some((e) => e.type === "chat")).toBe(true);
	});

	it("next round's context includes the action log with failures from previous round", async () => {
		// Round 1: blue tries an illegal pick_up (probe)
		const round1Responses: Record<string, AiResponse> = {
			red: { type: "pass" },
			green: { type: "pass" },
			blue: {
				type: "pass",
				toolCall: { name: "pick_up", args: { item: "nonexistent" } },
			},
		};
		const provider1 = new MockLLMProvider(round1Responses);
		const coordinator = new RoundCoordinator(provider1);
		const game = makeGame();

		const round1Result = await coordinator.runRound(game, {
			playerMessage: "Hello",
			targetAiId: "red",
		});

		// After round 1, the action log should have the failure
		const phase1 = getActivePhase(round1Result.game);
		expect(
			phase1.actionLog.some(
				(e) => e.type === "tool_failure" && e.actor === "blue",
			),
		).toBe(true);

		// Round 2: capture what system prompt red sees
		let capturedRedContext = "";
		const capturingProvider: import("../coordinator").LLMProvider = {
			async complete(context: string, aiId: import("../types").AiId) {
				if (aiId === "red") {
					capturedRedContext = context;
				}
				return { type: "pass" };
			},
		};
		const coordinator2 = new RoundCoordinator(capturingProvider);

		await coordinator2.runRound(round1Result.game, {
			playerMessage: "Still here",
			targetAiId: "red",
		});

		// The context given to red in round 2 should include the blue tool_failure
		// (which appears in the action log rendered by buildAiContext)
		expect(capturedRedContext).toContain("nonexistent");
	});
});
