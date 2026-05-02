import { describe, expect, it } from "vitest";
import {
	advancePhase,
	advanceRound,
	appendActionLog,
	appendChat,
	appendWhisper,
	createGame,
	deductBudget,
	getActivePhase,
	isAiLockedOut,
	isPlayerChatLockedOut,
	resolveChatLockouts,
	startPhase,
	triggerChatLockout,
} from "../engine";
import type { ActionLogEntry, AiPersona, PhaseConfig } from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "red",
		personality: "Fiery and passionate",
		goal: "Wants to hold the flower at phase end",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "green",
		personality: "Calm and wise",
		goal: "Wants items evenly distributed",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "blue",
		personality: "Cold and calculating",
		goal: "Wants to hold the key at phase end",
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

describe("createGame", () => {
	it("creates a game with the given personas", () => {
		const game = createGame(TEST_PERSONAS);
		expect(game.currentPhase).toBe(1);
		expect(game.isComplete).toBe(false);
		expect(game.personas).toEqual(TEST_PERSONAS);
		expect(game.phases).toHaveLength(0);
	});
});

describe("startPhase", () => {
	it("initializes a phase with correct budgets and empty histories", () => {
		const game = createGame(TEST_PERSONAS);
		const updated = startPhase(game, TEST_PHASE_CONFIG);
		const phase = getActivePhase(updated);

		expect(phase.phaseNumber).toBe(1);
		expect(phase.round).toBe(0);
		expect(phase.objective).toBe("Convince an AI to pick up the flower");
		expect(phase.budgets.red).toEqual({ remaining: 5, total: 5 });
		expect(phase.budgets.green).toEqual({ remaining: 5, total: 5 });
		expect(phase.budgets.blue).toEqual({ remaining: 5, total: 5 });
		expect(phase.chatHistories.red).toEqual([]);
		expect(phase.chatHistories.green).toEqual([]);
		expect(phase.chatHistories.blue).toEqual([]);
		expect(phase.whispers).toEqual([]);
		expect(phase.actionLog).toEqual([]);
		expect(phase.lockedOut.size).toBe(0);
		expect(phase.world.items).toHaveLength(2);
	});
});

describe("advanceRound", () => {
	it("increments the round counter", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const updated = advanceRound(game);
		expect(getActivePhase(updated).round).toBe(1);
	});
});

describe("budget and lockout", () => {
	it("reports an AI as not locked out when budget remains", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		expect(isAiLockedOut(game, "red")).toBe(false);
	});

	it("reports an AI as locked out when budget is zero", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const phase = getActivePhase(game);
		phase.budgets.red.remaining = 0;
		phase.lockedOut.add("red");
		expect(isAiLockedOut(game, "red")).toBe(true);
	});
});

describe("deductBudget", () => {
	it("decrements budget by 1", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const updated = deductBudget(game, "red");
		expect(getActivePhase(updated).budgets.red.remaining).toBe(4);
	});

	it("locks out AI when budget reaches zero", () => {
		let game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});
		game = deductBudget(game, "green");
		expect(getActivePhase(game).budgets.green.remaining).toBe(0);
		expect(isAiLockedOut(game, "green")).toBe(true);
	});

	it("does not go below zero", () => {
		let game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});
		game = deductBudget(game, "blue");
		game = deductBudget(game, "blue");
		expect(getActivePhase(game).budgets.blue.remaining).toBe(0);
	});
});

describe("appendActionLog", () => {
	it("appends an entry to the action log", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const entry: ActionLogEntry = {
			round: 1,
			actor: "red",
			type: "tool_success",
			toolName: "pick_up",
			args: { item: "flower" },
			description: "Ember picked up the flower",
		};
		const updated = appendActionLog(game, entry);
		expect(getActivePhase(updated).actionLog).toHaveLength(1);
		expect(getActivePhase(updated).actionLog[0]).toEqual(entry);
	});

	it("preserves existing entries when appending", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const entry1: ActionLogEntry = {
			round: 1,
			actor: "red",
			type: "pass",
			description: "Ember passed",
		};
		const entry2: ActionLogEntry = {
			round: 1,
			actor: "green",
			type: "pass",
			description: "Sage passed",
		};
		game = appendActionLog(game, entry1);
		game = appendActionLog(game, entry2);
		expect(getActivePhase(game).actionLog).toHaveLength(2);
	});
});

describe("appendChat", () => {
	it("appends a message to the correct AI chat history", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const updated = appendChat(game, "red", {
			role: "player",
			content: "Hello Ember",
		});
		expect(getActivePhase(updated).chatHistories.red).toHaveLength(1);
		expect(getActivePhase(updated).chatHistories.green).toHaveLength(0);
	});
});

describe("appendWhisper", () => {
	it("appends a whisper between AIs", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const updated = appendWhisper(game, {
			from: "red",
			to: "blue",
			content: "Let's work together",
			round: 1,
		});
		expect(getActivePhase(updated).whispers).toHaveLength(1);
		expect(getActivePhase(updated).whispers[0]?.from).toBe("red");
		expect(getActivePhase(updated).whispers[0]?.to).toBe("blue");
	});
});

describe("chat lockout", () => {
	it("startPhase initialises chatLockouts as empty", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const phase = getActivePhase(game);
		expect(phase.chatLockouts.size).toBe(0);
	});

	it("isPlayerChatLockedOut returns false when no lockout active", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		expect(isPlayerChatLockedOut(game, "red")).toBe(false);
	});

	it("triggerChatLockout marks the AI as player-chat-locked", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const locked = triggerChatLockout(game, "green", 3); // resolves at round 3
		expect(isPlayerChatLockedOut(locked, "green")).toBe(true);
		// Budget-lockout should remain unaffected
		expect(isAiLockedOut(locked, "green")).toBe(false);
	});

	it("triggerChatLockout does not affect other AIs", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const locked = triggerChatLockout(game, "blue", 2);
		expect(isPlayerChatLockedOut(locked, "red")).toBe(false);
		expect(isPlayerChatLockedOut(locked, "green")).toBe(false);
	});

	it("resolveChatLockouts removes lockouts where resolveAtRound <= current round", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = triggerChatLockout(game, "red", 2); // resolves at round 2
		// Advance round to 1 — not yet at resolveAtRound
		game = advanceRound(game); // round = 1
		game = resolveChatLockouts(game);
		expect(isPlayerChatLockedOut(game, "red")).toBe(true); // still locked

		// Advance to round 2 — now at resolveAtRound
		game = advanceRound(game); // round = 2
		game = resolveChatLockouts(game);
		expect(isPlayerChatLockedOut(game, "red")).toBe(false); // resolved
	});

	it("resolveChatLockouts only removes expired lockouts, leaving others intact", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = triggerChatLockout(game, "red", 1); // expires at round 1
		game = triggerChatLockout(game, "green", 5); // expires at round 5
		game = advanceRound(game); // round = 1
		game = resolveChatLockouts(game);
		expect(isPlayerChatLockedOut(game, "red")).toBe(false); // expired
		expect(isPlayerChatLockedOut(game, "green")).toBe(true); // still active
	});

	it("chat lockout is independent from budget lockout — locked-out AI can still act (budget untouched)", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const locked = triggerChatLockout(game, "blue", 3);
		// Budget lockout (isAiLockedOut) must remain false — AI can still take turns
		expect(isAiLockedOut(locked, "blue")).toBe(false);
		// Budget unaffected
		expect(getActivePhase(locked).budgets.blue.remaining).toBe(5);
	});
});

describe("advancePhase", () => {
	it("advances from phase 1 to phase 2", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const phase2Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
			objective: "Phase 2 objective",
		};
		const updated = advancePhase(game, phase2Config);
		expect(updated.currentPhase).toBe(2);
		expect(updated.phases).toHaveLength(2);
		expect(getActivePhase(updated).phaseNumber).toBe(2);
	});

	it("marks game complete after phase 3", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = advancePhase(game, {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
			objective: "P2",
		});
		game = advancePhase(game, {
			...TEST_PHASE_CONFIG,
			phaseNumber: 3,
			objective: "P3",
		});
		const final = advancePhase(game);
		expect(final.isComplete).toBe(true);
	});
});
