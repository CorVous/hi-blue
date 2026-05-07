import { describe, expect, it } from "vitest";
import {
	dispatchAiTurn,
	executeToolCall,
	validateToolCall,
} from "../dispatcher";
import {
	createGame,
	deductBudget,
	getActivePhase,
	startPhase,
} from "../engine";
import type { AiPersona, AiTurnAction, PhaseConfig, ToolCall } from "../types";

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
	objective: "Test objective",
	aiGoals: { red: "g1", green: "g2", blue: "g3" },
	initialWorld: {
		items: [
			{ id: "flower", name: "flower", holder: "room" },
			{ id: "key", name: "key", holder: "red" },
		],
	},
	budgetPerAi: 5,
};

describe("validateToolCall", () => {
	it("allows picking up an item in the room", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects picking up an item not in the room", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const call: ToolCall = { name: "pick_up", args: { item: "key" } };
		const result = validateToolCall(game, "green", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toBeDefined();
	});

	it("rejects picking up a nonexistent item", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const call: ToolCall = { name: "pick_up", args: { item: "sword" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});

	it("allows putting down an item the AI holds", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const call: ToolCall = { name: "put_down", args: { item: "key" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects putting down an item the AI doesn't hold", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const call: ToolCall = { name: "put_down", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});

	it("allows giving an item to another AI", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const call: ToolCall = { name: "give", args: { item: "key", to: "green" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects giving an item not held by the AI", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const call: ToolCall = {
			name: "give",
			args: { item: "flower", to: "green" },
		};
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});

	it("rejects giving to self", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const call: ToolCall = { name: "give", args: { item: "key", to: "red" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});
});

describe("executeToolCall", () => {
	it("moves item from room to AI on pick_up", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
		const updated = executeToolCall(game, "red", call);
		const item = getActivePhase(updated).world.items.find(
			(i) => i.id === "flower",
		);
		expect(item?.holder).toBe("red");
	});

	it("moves item from AI to room on put_down", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const call: ToolCall = { name: "put_down", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const item = getActivePhase(updated).world.items.find(
			(i) => i.id === "key",
		);
		expect(item?.holder).toBe("room");
	});

	it("transfers item between AIs on give", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const call: ToolCall = { name: "give", args: { item: "key", to: "blue" } };
		const updated = executeToolCall(game, "red", call);
		const item = getActivePhase(updated).world.items.find(
			(i) => i.id === "key",
		);
		expect(item?.holder).toBe("blue");
	});
});

describe("dispatchAiTurn", () => {
	it("rejects a turn from a locked-out AI", () => {
		let game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 1,
		});
		game = deductBudget(game, "red");
		const action: AiTurnAction = { aiId: "red", pass: true };
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(true);
		expect(result.reason).toMatch(/locked out/i);
	});

	it("processes a pass action and deducts budget", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const action: AiTurnAction = { aiId: "red", pass: true };
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(getActivePhase(result.game).budgets["red"]!.remaining).toBe(4);
		expect(getActivePhase(result.game).actionLog).toHaveLength(1);
		expect(getActivePhase(result.game).actionLog[0]?.type).toBe("pass");
	});

	it("logs a failed tool call in the action log", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const action: AiTurnAction = {
			aiId: "green",
			toolCall: { name: "pick_up", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		const log = getActivePhase(result.game).actionLog;
		expect(log.some((e) => e.type === "tool_failure")).toBe(true);
	});

	it("executes a valid tool call and logs success", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "flower" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		const phase = getActivePhase(result.game);
		expect(phase.actionLog.some((e) => e.type === "tool_success")).toBe(true);
		const flower = phase.world.items.find((i) => i.id === "flower");
		expect(flower?.holder).toBe("red");
	});

	it("appends chat messages to the correct history", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const action: AiTurnAction = {
			aiId: "red",
			chat: { target: "player", content: "Hello, I am Ember" },
		};
		const result = dispatchAiTurn(game, action);
		expect(getActivePhase(result.game).chatHistories["red"]).toHaveLength(1);
		expect(getActivePhase(result.game).chatHistories["red"]?.[0]?.content).toBe(
			"Hello, I am Ember",
		);
	});

	it("appends whisper messages", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const action: AiTurnAction = {
			aiId: "red",
			whisper: { target: "blue", content: "Psst, ally with me" },
		};
		const result = dispatchAiTurn(game, action);
		expect(getActivePhase(result.game).whispers).toHaveLength(1);
	});
});
