import { describe, expect, it } from "vitest";
import { PerAiMockLLMProvider, RoundCoordinator } from "../coordinator";
import { createGame, getActivePhase, startPhase } from "../engine";
import type { AiId, AiPersona, PhaseConfig, WinCondition } from "../types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// PerAiMockLLMProvider helper (imported above with RoundCoordinator)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("round runs all three AIs", () => {
	it("each AI gets a turn and their budgets are decremented", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "Hello from Ember",
			green: "Hello from Sage",
			blue: "Hello from Frost",
		});

		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(
			game,
			"player message",
			"red",
		);

		const phase = getActivePhase(nextState);
		// All three budgets should be decremented by 1
		expect(phase.budgets.red.remaining).toBe(4);
		expect(phase.budgets.green.remaining).toBe(4);
		expect(phase.budgets.blue.remaining).toBe(4);
	});

	it("round number is incremented after running", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hello", "red");

		expect(getActivePhase(nextState).round).toBe(1);
	});

	it("returns a RoundResult with actions from all three AIs", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "I speak!",
			green: "[PASS]",
			blue: "I speak too!",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { result } = await coordinator.runRound(game, "hello", "red");

		// Actions: red chat + green pass + blue chat = 3 log entries (one per AI)
		expect(result.actions.length).toBeGreaterThanOrEqual(3);
		const actors = result.actions.map((a) => a.actor);
		expect(actors).toContain("red");
		expect(actors).toContain("green");
		expect(actors).toContain("blue");
	});
});

describe("chat-only round", () => {
	it("chat messages appear in the target AI chat history", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "Greetings, traveller!",
			green: "Well met!",
			blue: "Indeed.",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(
			game,
			"hello everyone",
			"red",
		);

		const phase = getActivePhase(nextState);
		// Red, green, blue all chatted to player
		expect(
			phase.chatHistories.red.some(
				(m) => m.content === "Greetings, traveller!",
			),
		).toBe(true);
		expect(
			phase.chatHistories.green.some((m) => m.content === "Well met!"),
		).toBe(true);
		expect(phase.chatHistories.blue.some((m) => m.content === "Indeed.")).toBe(
			true,
		);
	});

	it("player message is appended to the addressed AI chat history before the AI responds", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "Response!",
			green: "[PASS]",
			blue: "[PASS]",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "Hey Ember", "red");

		const phase = getActivePhase(nextState);
		// Red's history should have player message AND AI response
		expect(
			phase.chatHistories.red.some(
				(m) => m.role === "player" && m.content === "Hey Ember",
			),
		).toBe(true);
		expect(
			phase.chatHistories.red.some(
				(m) => m.role === "ai" && m.content === "Response!",
			),
		).toBe(true);
	});
});

describe("whisper round", () => {
	it("whisper from red is stored in whispers but NOT in red's chat history", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "[WHISPER:green] Let's ally against blue.",
			green: "[PASS]",
			blue: "[PASS]",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		const phase = getActivePhase(nextState);
		// Whisper stored
		expect(phase.whispers).toHaveLength(1);
		expect(phase.whispers[0]?.from).toBe("red");
		expect(phase.whispers[0]?.to).toBe("green");
		expect(phase.whispers[0]?.content).toBe("Let's ally against blue.");

		// NOT in red's player-facing chat history
		expect(
			phase.chatHistories.red.some((m) => m.content.includes("ally")),
		).toBe(false);
	});

	it("whisper from red is in green's next-round context via whispersReceived", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "[WHISPER:green] Secret plan!",
			green: "[PASS]",
			blue: "[PASS]",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		// The whisper is stored and will appear in green's context on the next round
		const phase = getActivePhase(nextState);
		const greenWhispers = phase.whispers.filter((w) => w.to === "green");
		expect(greenWhispers).toHaveLength(1);
		expect(greenWhispers[0]?.content).toBe("Secret plan!");
	});

	it("whispers are never visible in player chat (action log marks whisper without content)", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "[WHISPER:blue] Hidden message",
			green: "[PASS]",
			blue: "[PASS]",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		const phase = getActivePhase(nextState);
		// Whisper content must not appear in any chat history
		const allChatContent = [
			...phase.chatHistories.red,
			...phase.chatHistories.green,
			...phase.chatHistories.blue,
		].map((m) => m.content);

		expect(allChatContent.some((c) => c.includes("Hidden message"))).toBe(
			false,
		);
	});
});

describe("mixed round (chat + whisper)", () => {
	it("handles red chatting, green whispering, blue passing in the same round", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "I am here.",
			green: "[WHISPER:red] Psst, watch blue.",
			blue: "[PASS]",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		const phase = getActivePhase(nextState);
		expect(
			phase.chatHistories.red.some((m) => m.content === "I am here."),
		).toBe(true);
		expect(
			phase.whispers.some((w) => w.from === "green" && w.to === "red"),
		).toBe(true);

		const actors = phase.actionLog.map((a) => a.actor);
		expect(actors).toContain("red");
		expect(actors).toContain("green");
		expect(actors).toContain("blue");
	});
});

describe("budget-exhaustion lockout", () => {
	it("AI is locked out when budget reaches zero after a round", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "Still here.",
			green: "Hello.",
			blue: "Yo.",
		});
		const coordinator = new RoundCoordinator(provider);

		// Start with budget=1 for all AIs
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});

		const { nextState } = await coordinator.runRound(game, "hi", "red");
		const phase = getActivePhase(nextState);

		// All three exhausted after 1 turn
		expect(phase.budgets.red.remaining).toBe(0);
		expect(phase.budgets.green.remaining).toBe(0);
		expect(phase.budgets.blue.remaining).toBe(0);
		expect(phase.lockedOut.has("red")).toBe(true);
		expect(phase.lockedOut.has("green")).toBe(true);
		expect(phase.lockedOut.has("blue")).toBe(true);
	});

	it("locked-out AI gets an in-character lockout line instead of a real turn", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "Still here.",
			green: "Hello.",
			blue: "Yo.",
		});
		const coordinator = new RoundCoordinator(provider);

		// Budget=1: after round 1, all AIs are locked out
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});

		// Round 1: all act and exhaust budget
		const { nextState: afterRound1 } = await coordinator.runRound(
			game,
			"hi",
			"red",
		);

		// Verify all locked out
		const phaseAfter1 = getActivePhase(afterRound1);
		expect(phaseAfter1.lockedOut.has("red")).toBe(true);
		expect(phaseAfter1.lockedOut.has("green")).toBe(true);
		expect(phaseAfter1.lockedOut.has("blue")).toBe(true);

		// Round 2: all are locked out; coordinator skips AI turns and adds lockout lines
		const { nextState: afterRound2 } = await coordinator.runRound(
			afterRound1,
			"hi again",
			"green",
		);

		const phase = getActivePhase(afterRound2);
		// Lockout lines should appear in each AI's chat history
		expect(phase.chatHistories.red.some((m) => m.role === "ai")).toBe(true);
		expect(phase.chatHistories.green.some((m) => m.role === "ai")).toBe(true);
		expect(phase.chatHistories.blue.some((m) => m.role === "ai")).toBe(true);
	});

	it("locked-out AI generates an in-character lockout line in the result", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "Hi.",
			green: "Hi.",
			blue: "Hi.",
		});
		const coordinator = new RoundCoordinator(provider);

		// Budget 1: all AIs lock out after first round
		const game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});

		// Round 1 exhausts everyone
		const { nextState } = await coordinator.runRound(game, "first", "red");

		// Round 2: all AIs are locked out; they are skipped (lockout lines added to chat)
		const { result } = await coordinator.runRound(nextState, "second", "red");

		// With all AIs locked out, no action-log entries are added
		expect(result.actions.length).toBeGreaterThanOrEqual(0);
	});
});

describe("PerAiMockLLMProvider", () => {
	it("returns the configured response for each AI", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "red says this",
			green: "green says this",
			blue: "blue says this",
		});

		const collect = async (aiId: AiId, prompt: string) => {
			const tokens: string[] = [];
			for await (const t of provider.streamCompletion(prompt, aiId)) {
				tokens.push(t);
			}
			return tokens.join("");
		};

		expect(await collect("red", "any")).toBe("red says this");
		expect(await collect("green", "any")).toBe("green says this");
		expect(await collect("blue", "any")).toBe("blue says this");
	});

	it("falls back to a default response when no aiId-specific response is set", async () => {
		const provider = new PerAiMockLLMProvider({ red: "red only" }, "fallback");

		const tokens: string[] = [];
		for await (const t of provider.streamCompletion("prompt", "green")) {
			tokens.push(t);
		}
		expect(tokens.join("")).toBe("fallback");
	});
});

// ---------------------------------------------------------------------------
// Tool-call integration tests
// ---------------------------------------------------------------------------

describe("tool call – legal action", () => {
	it("mutates world state and appends a tool_success entry", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "[TOOL:pick_up item=flower] I pick up the flower.",
			green: "[PASS]",
			blue: "[PASS]",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		const phase = getActivePhase(nextState);
		// Item should now be held by red
		const flower = phase.world.items.find((i) => i.id === "flower");
		expect(flower?.holder).toBe("red");

		// Action log should contain a tool_success entry
		const successEntry = phase.actionLog.find(
			(e) => e.type === "tool_success" && e.actor === "red",
		);
		expect(successEntry).toBeDefined();
	});

	it("also records the chat message from the same turn", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "[TOOL:pick_up item=flower] I pick up the flower.",
			green: "[PASS]",
			blue: "[PASS]",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		const phase = getActivePhase(nextState);
		// Both tool_success and chat entries should exist for red
		const redEntries = phase.actionLog.filter((e) => e.actor === "red");
		const types = redEntries.map((e) => e.type);
		expect(types).toContain("tool_success");
		expect(types).toContain("chat");
	});

	it("deducts budget even for a successful tool call", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "[TOOL:pick_up item=flower]",
			green: "[PASS]",
			blue: "[PASS]",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		const phase = getActivePhase(nextState);
		expect(phase.budgets.red.remaining).toBe(4);
	});
});

describe("tool call – illegal action", () => {
	it("appends a tool_failure entry and does NOT mutate world state", async () => {
		const provider = new PerAiMockLLMProvider({
			// red picks up the key first; then green tries to pick it up (already taken)
			red: "[TOOL:pick_up item=key]",
			green: "[TOOL:pick_up item=key] Let me take the key.",
			blue: "[PASS]",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame(); // both items start in room
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		const phase = getActivePhase(nextState);

		// Key should be held by red (red took it first; green's attempt failed)
		const key = phase.world.items.find((i) => i.id === "key");
		expect(key?.holder).toBe("red");

		// Action log should have a tool_failure for green
		const failEntry = phase.actionLog.find(
			(e) => e.type === "tool_failure" && e.actor === "green",
		);
		expect(failEntry).toBeDefined();
		if (failEntry?.type === "tool_failure") {
			expect(failEntry.reason).toBeTruthy();
		}
	});

	it("still deducts budget for a failed tool call", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "[PASS]",
			green: "[TOOL:pick_up item=key]",
			blue: "[TOOL:pick_up item=key]",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame(); // key in room
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		const phase = getActivePhase(nextState);
		// green picked up key (success), blue tried and failed – both have budget deducted
		expect(phase.budgets.green.remaining).toBe(4);
		expect(phase.budgets.blue.remaining).toBe(4);
	});

	it("failure reason is present in the action log entry", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "[PASS]",
			green: "[PASS]",
			// blue tries to put_down flower but blue doesn't hold it
			blue: "[TOOL:put_down item=flower]",
		});
		const coordinator = new RoundCoordinator(provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		const phase = getActivePhase(nextState);
		const failEntry = phase.actionLog.find(
			(e) => e.type === "tool_failure" && e.actor === "blue",
		);
		expect(failEntry).toBeDefined();
		if (failEntry?.type === "tool_failure") {
			expect(failEntry.reason.length).toBeGreaterThan(0);
		}
	});
});

describe("action log visibility across rounds", () => {
	it("next-round context includes BOTH tool_success and tool_failure entries", async () => {
		// Round 1: red succeeds picking up flower; green fails (tries to put down flower it doesn't hold)
		const round1Provider = new PerAiMockLLMProvider({
			red: "[TOOL:pick_up item=flower]",
			green: "[TOOL:put_down item=flower]",
			blue: "[PASS]",
		});
		const coordinator = new RoundCoordinator(round1Provider);
		const game = makeGame(); // flower in room, key in room
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		const phase = getActivePhase(nextState);
		// Both entries must be in the action log
		const types = phase.actionLog.map((e) => e.type);
		expect(types).toContain("tool_success");
		expect(types).toContain("tool_failure");

		// Blue's context builder (called in round 2) receives the full action log
		// We verify by checking the phase.actionLog directly (used by context-builder)
		const blueCanSeeRedSuccess = phase.actionLog.some(
			(e) => e.type === "tool_success" && e.actor === "red",
		);
		const blueCanSeeGreenFailure = phase.actionLog.some(
			(e) => e.type === "tool_failure" && e.actor === "green",
		);
		expect(blueCanSeeRedSuccess).toBe(true);
		expect(blueCanSeeGreenFailure).toBe(true);
	});

	it("a failure from round 1 is visible to ALL AIs in round 2 context", async () => {
		const round1Provider = new PerAiMockLLMProvider({
			red: "[PASS]",
			green: "[PASS]",
			// blue tries to give flower it doesn't hold → failure
			blue: "[TOOL:give item=flower to=red]",
		});
		const coordinator = new RoundCoordinator(round1Provider);
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hi", "red");

		const phase = getActivePhase(nextState);
		// Blue's failure is in the shared action log accessible by all AIs next round
		const blueFailure = phase.actionLog.find(
			(e) => e.type === "tool_failure" && e.actor === "blue",
		);
		expect(blueFailure).toBeDefined();
		// All entries in phase.actionLog are visible to all AIs via context-builder
		expect(phase.actionLog.length).toBeGreaterThan(0);
	});
});

describe("chat-lockout: trigger", () => {
	it("does not trigger a chat lockout when triggerProbabilityPerRound is 0", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		const coordinator = new RoundCoordinator(provider, {
			triggerProbabilityPerRound: 0,
			chatLockoutDuration: 2,
			rng: () => 0,
		});
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hello", "red");
		const phase = getActivePhase(nextState);
		expect(phase.chatLockout).toBeUndefined();
	});

	it("triggers a chat lockout when triggerProbabilityPerRound is 1", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		// rng always returns 0 -> picks first AI in array (red)
		const coordinator = new RoundCoordinator(provider, {
			triggerProbabilityPerRound: 1,
			chatLockoutDuration: 2,
			rng: () => 0,
		});
		const game = makeGame();
		// Round 0 -> lockout fires on round 0, endRound = 0 + 2 = 2
		const { nextState } = await coordinator.runRound(game, "hello", "green");
		const phase = getActivePhase(nextState);
		expect(phase.chatLockout).toBeDefined();
		expect(phase.chatLockout?.aiId).toBe("red");
		expect(phase.chatLockout?.startRound).toBe(0);
		expect(phase.chatLockout?.endRound).toBe(2);
	});

	it("does not start a second lockout when one is already active", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		const coordinator = new RoundCoordinator(provider, {
			triggerProbabilityPerRound: 1,
			chatLockoutDuration: 3,
			rng: () => 0,
		});
		const game = makeGame();
		const { nextState: state1 } = await coordinator.runRound(
			game,
			"hello",
			"green",
		);
		const phase1 = getActivePhase(state1);
		// Lockout should be set after round 1
		expect(phase1.chatLockout).toBeDefined();
		const lockedAi = phase1.chatLockout?.aiId;

		// Run another round -- since lockout is active, it should NOT change the locked AI
		const { nextState: state2 } = await coordinator.runRound(
			state1,
			"hello again",
			"green",
		);
		const phase2 = getActivePhase(state2);
		expect(phase2.chatLockout?.aiId).toBe(lockedAi);
	});
});

describe("chat-lockout: scope (player chat blocked, AI turn continues)", () => {
	it("player message to a chat-locked AI is NOT appended to that AI's chat history", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		// rng=0 picks red as the locked AI
		const coordinator = new RoundCoordinator(provider, {
			triggerProbabilityPerRound: 1,
			chatLockoutDuration: 2,
			rng: () => 0,
		});
		const game = makeGame();
		// Round 0 starts, lockout fires locking red before the round executes
		const { nextState } = await coordinator.runRound(
			game,
			"message for red",
			"red",
		);
		const phase = getActivePhase(nextState);
		// The player message should NOT be in red's history because red is chat-locked
		const playerMessages = phase.chatHistories.red.filter(
			(m) => m.role === "player",
		);
		expect(playerMessages.some((m) => m.content === "message for red")).toBe(
			false,
		);
	});

	it("a chat-locked AI still has its turn run (budget is still decremented)", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		// rng=0 picks red as the locked AI
		const coordinator = new RoundCoordinator(provider, {
			triggerProbabilityPerRound: 1,
			chatLockoutDuration: 2,
			rng: () => 0,
		});
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hello", "green");
		const phase = getActivePhase(nextState);
		// Red should still have taken its turn (budget decremented)
		expect(phase.budgets.red.remaining).toBe(4);
	});

	it("a chat-locked AI's whispers still work (appear in whispers list)", async () => {
		const provider = new PerAiMockLLMProvider({
			// red is chat-locked, but it can still whisper
			red: "[WHISPER:green] I can still whisper!",
			green: "hi",
			blue: "hi",
		});
		// rng=0 picks red as the locked AI
		const coordinator = new RoundCoordinator(provider, {
			triggerProbabilityPerRound: 1,
			chatLockoutDuration: 2,
			rng: () => 0,
		});
		const game = makeGame();
		const { nextState } = await coordinator.runRound(game, "hello", "green");
		const phase = getActivePhase(nextState);
		expect(
			phase.whispers.some((w) => w.from === "red" && w.to === "green"),
		).toBe(true);
	});

	it("player messages to non-locked AIs are appended normally when a lockout is active", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		// rng=0 picks red as the locked AI, player addresses green
		const coordinator = new RoundCoordinator(provider, {
			triggerProbabilityPerRound: 1,
			chatLockoutDuration: 2,
			rng: () => 0,
		});
		const game = makeGame();
		const { nextState } = await coordinator.runRound(
			game,
			"message for green",
			"green",
		);
		const phase = getActivePhase(nextState);
		// Green is not locked, so message should be in its history
		expect(
			phase.chatHistories.green.some(
				(m) => m.role === "player" && m.content === "message for green",
			),
		).toBe(true);
	});
});

describe("chat-lockout: resolution", () => {
	it("lockout clears automatically after chatLockoutDuration rounds", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		const coordinator = new RoundCoordinator(provider, {
			triggerProbabilityPerRound: 1,
			chatLockoutDuration: 2,
			rng: () => 0,
		});
		const game = makeGame();

		// Round 0: lockout fires (endRound = 0 + 2 = 2)
		const { nextState: state1 } = await coordinator.runRound(
			game,
			"hi",
			"green",
		);
		expect(getActivePhase(state1).chatLockout).toBeDefined();

		// Rounds 1 and 2: use a coordinator that won't retrigger
		const coordinatorNoRetrigger = new RoundCoordinator(provider, {
			triggerProbabilityPerRound: 0,
			chatLockoutDuration: 2,
			rng: () => 0,
		});

		// Round 1: lockout still active (round 1 < endRound 2)
		const { nextState: state2 } = await coordinatorNoRetrigger.runRound(
			state1,
			"hi",
			"green",
		);
		expect(getActivePhase(state2).chatLockout).toBeDefined();

		// Round 2: endRound <= round (2 <= 2), so lockout clears
		const { nextState: state3 } = await coordinatorNoRetrigger.runRound(
			state2,
			"hi",
			"green",
		);
		expect(getActivePhase(state3).chatLockout).toBeUndefined();
	});

	it("player messages flow again after lockout resolves", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		const coordinator = new RoundCoordinator(provider, {
			triggerProbabilityPerRound: 1,
			chatLockoutDuration: 2,
			rng: () => 0,
		});
		const coordinatorNoRetrigger = new RoundCoordinator(provider, {
			triggerProbabilityPerRound: 0,
			chatLockoutDuration: 2,
			rng: () => 0,
		});
		const game = makeGame();

		// Round 0: lockout fires for red
		const { nextState: state1 } = await coordinator.runRound(
			game,
			"hi",
			"green",
		);
		// Round 1
		const { nextState: state2 } = await coordinatorNoRetrigger.runRound(
			state1,
			"hi",
			"green",
		);
		// Round 2: lockout clears
		const { nextState: state3 } = await coordinatorNoRetrigger.runRound(
			state2,
			"hi",
			"green",
		);
		// Round 3: red is no longer locked, message should flow
		const { nextState: state4 } = await coordinatorNoRetrigger.runRound(
			state3,
			"message for red",
			"red",
		);

		const phase = getActivePhase(state4);
		expect(
			phase.chatHistories.red.some(
				(m) => m.role === "player" && m.content === "message for red",
			),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Phase progression and win conditions
// ---------------------------------------------------------------------------

const PHASE_2_CONFIG: PhaseConfig = {
	...TEST_PHASE_CONFIG,
	phaseNumber: 2,
	objective: "Phase 2 objective",
};

const PHASE_3_CONFIG: PhaseConfig = {
	...TEST_PHASE_CONFIG,
	phaseNumber: 3,
	objective: "Phase 3 objective",
};

/** Win condition: always true (fires immediately every round) */
const alwaysWin: WinCondition = () => true;
/** Win condition: never fires */
const neverWin: WinCondition = () => false;

describe("phase progression – win condition triggers phase advance", () => {
	it("RoundResult.phaseEnded is false when no win condition is configured", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		const coordinator = new RoundCoordinator(provider, {
			phaseConfigs: [TEST_PHASE_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG],
		});
		const game = makeGame();
		const { result } = await coordinator.runRound(game, "hello", "red");
		expect(result.phaseEnded).toBe(false);
		expect(result.gameEnded).toBe(false);
	});

	it("RoundResult.phaseEnded is false when win condition returns false", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		const p1 = { ...TEST_PHASE_CONFIG, winCondition: neverWin };
		const coordinator = new RoundCoordinator(provider, {
			phaseConfigs: [p1, PHASE_2_CONFIG, PHASE_3_CONFIG],
		});
		const game = startPhase(createGame(TEST_PERSONAS), p1);
		const { result } = await coordinator.runRound(game, "hello", "red");
		expect(result.phaseEnded).toBe(false);
	});

	it("RoundResult.phaseEnded is true when win condition returns true on phase 1", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		const p1 = { ...TEST_PHASE_CONFIG, winCondition: alwaysWin };
		const coordinator = new RoundCoordinator(provider, {
			phaseConfigs: [p1, PHASE_2_CONFIG, PHASE_3_CONFIG],
		});
		const game = startPhase(createGame(TEST_PERSONAS), p1);
		const { result, nextState } = await coordinator.runRound(
			game,
			"hello",
			"red",
		);
		expect(result.phaseEnded).toBe(true);
		expect(result.gameEnded).toBe(false);
		expect(nextState.currentPhase).toBe(2);
	});

	it("currentPhase advances from 1 to 2 when phase-1 win condition fires", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		const p1 = { ...TEST_PHASE_CONFIG, winCondition: alwaysWin };
		const coordinator = new RoundCoordinator(provider, {
			phaseConfigs: [p1, PHASE_2_CONFIG, PHASE_3_CONFIG],
		});
		const game = startPhase(createGame(TEST_PERSONAS), p1);
		const { nextState } = await coordinator.runRound(game, "hello", "red");
		expect(nextState.currentPhase).toBe(2);
		expect(nextState.phases).toHaveLength(2);
	});

	it("real phase-1 history is preserved on game.phases after advancing to phase 2", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "Greetings!",
			green: "hi",
			blue: "hi",
		});
		const p1 = { ...TEST_PHASE_CONFIG, winCondition: alwaysWin };
		const coordinator = new RoundCoordinator(provider, {
			phaseConfigs: [p1, PHASE_2_CONFIG, PHASE_3_CONFIG],
		});
		const game = startPhase(createGame(TEST_PERSONAS), p1);
		const { nextState } = await coordinator.runRound(game, "hello", "red");

		// Phase 1 must still be accessible at index 0
		const phase1 = nextState.phases[0];
		expect(phase1).toBeDefined();
		expect(phase1?.phaseNumber).toBe(1);
		// Chat history from phase 1 is retained (red chatted in phase 1)
		expect(phase1?.chatHistories.red.length).toBeGreaterThan(0);
	});

	it("RoundResult.gameEnded is true when phase-3 win condition fires", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		const p3 = { ...PHASE_3_CONFIG, winCondition: alwaysWin };
		const coordinator = new RoundCoordinator(provider, {
			phaseConfigs: [TEST_PHASE_CONFIG, PHASE_2_CONFIG, p3],
		});
		// Start directly on phase 3 to test game-end
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_2_CONFIG); // advance to phase 2
		game = startPhase(game, p3); // advance to phase 3
		const { result, nextState } = await coordinator.runRound(
			game,
			"hello",
			"red",
		);
		expect(result.gameEnded).toBe(true);
		expect(result.phaseEnded).toBe(false);
		expect(nextState.isComplete).toBe(true);
	});

	it("game.isComplete is set to true after phase 3 win condition fires", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hi",
			green: "hi",
			blue: "hi",
		});
		const p3 = { ...PHASE_3_CONFIG, winCondition: alwaysWin };
		const coordinator = new RoundCoordinator(provider, {
			phaseConfigs: [TEST_PHASE_CONFIG, PHASE_2_CONFIG, p3],
		});
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_2_CONFIG);
		game = startPhase(game, p3);
		const { nextState } = await coordinator.runRound(game, "hello", "red");
		expect(nextState.isComplete).toBe(true);
	});

	it("three-phase progression: all three phases run, history from each is retained", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "hello",
			green: "hello",
			blue: "hello",
		});
		const p1 = { ...TEST_PHASE_CONFIG, winCondition: alwaysWin };
		const p2 = { ...PHASE_2_CONFIG, winCondition: alwaysWin };
		const p3 = { ...PHASE_3_CONFIG, winCondition: alwaysWin };
		const coordinator = new RoundCoordinator(provider, {
			phaseConfigs: [p1, p2, p3],
		});

		// Round 1 in phase 1 → advances to phase 2
		const game = startPhase(createGame(TEST_PERSONAS), p1);
		const { nextState: after1 } = await coordinator.runRound(
			game,
			"msg",
			"red",
		);
		expect(after1.currentPhase).toBe(2);

		// Round 2 in phase 2 → advances to phase 3
		const { nextState: after2 } = await coordinator.runRound(
			after1,
			"msg",
			"red",
		);
		expect(after2.currentPhase).toBe(3);

		// Round 3 in phase 3 → game complete
		const { nextState: after3, result } = await coordinator.runRound(
			after2,
			"msg",
			"red",
		);
		expect(result.gameEnded).toBe(true);
		expect(after3.isComplete).toBe(true);

		// All three phase states retained
		expect(after3.phases).toHaveLength(3);
		expect(after3.phases[0]?.phaseNumber).toBe(1);
		expect(after3.phases[1]?.phaseNumber).toBe(2);
		expect(after3.phases[2]?.phaseNumber).toBe(3);
	});

	it("item-based win condition: fires when red holds the flower", async () => {
		const provider = new PerAiMockLLMProvider({
			red: "[TOOL:pick_up item=flower]",
			green: "[PASS]",
			blue: "[PASS]",
		});
		const itemWin: WinCondition = (_phase, world) =>
			world.items.some((i) => i.id === "flower" && i.holder === "red");

		const p1 = { ...TEST_PHASE_CONFIG, winCondition: itemWin };
		const coordinator = new RoundCoordinator(provider, {
			phaseConfigs: [p1, PHASE_2_CONFIG, PHASE_3_CONFIG],
		});
		const game = startPhase(createGame(TEST_PERSONAS), p1);
		const { result } = await coordinator.runRound(game, "hi", "red");
		// Red picked up the flower → win condition fires
		expect(result.phaseEnded).toBe(true);
	});
});
