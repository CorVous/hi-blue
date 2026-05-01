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
	startPhase,
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

	it("retains the full phase-1 state (chatHistories, actionLog, whispers) after advancing to phase 2", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		// Add some history to phase 1
		game = appendChat(game, "red", {
			role: "player",
			content: "Hello from phase 1",
		});
		game = appendWhisper(game, {
			from: "red",
			to: "green",
			content: "Phase 1 secret",
			round: 1,
		});
		const p1Entry: import("../types").ActionLogEntry = {
			round: 1,
			actor: "red",
			type: "pass",
			description: "red passed in p1",
		};
		game = appendActionLog(game, p1Entry);

		// Advance to phase 2
		game = advancePhase(game, {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
			objective: "P2",
		});

		// Phase 1 state must still be intact at index 0
		const phase1 = game.phases[0];
		expect(phase1).toBeDefined();
		expect(phase1?.phaseNumber).toBe(1);
		expect(phase1?.chatHistories.red).toHaveLength(1);
		expect(phase1?.chatHistories.red[0]?.content).toBe("Hello from phase 1");
		expect(phase1?.whispers).toHaveLength(1);
		expect(phase1?.whispers[0]?.content).toBe("Phase 1 secret");
		expect(phase1?.actionLog).toHaveLength(1);
	});

	it("after two advancePhase calls, game.phases has 3 entries with correct phaseNumbers", () => {
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

		expect(game.phases).toHaveLength(3);
		expect(game.phases[0]?.phaseNumber).toBe(1);
		expect(game.phases[1]?.phaseNumber).toBe(2);
		expect(game.phases[2]?.phaseNumber).toBe(3);
	});

	it("phase 1 chatHistories are not mutated by phase 2 activity", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendChat(game, "red", { role: "player", content: "Phase 1 chat" });

		game = advancePhase(game, {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
			objective: "P2",
		});

		// Add a chat in phase 2
		game = appendChat(game, "red", { role: "player", content: "Phase 2 chat" });

		// Phase 1 chat history is unchanged
		expect(game.phases[0]?.chatHistories.red).toHaveLength(1);
		expect(game.phases[0]?.chatHistories.red[0]?.content).toBe("Phase 1 chat");
		// Active phase (phase 2) has its own history
		expect(getActivePhase(game).chatHistories.red).toHaveLength(1);
		expect(getActivePhase(game).chatHistories.red[0]?.content).toBe(
			"Phase 2 chat",
		);
	});
});
