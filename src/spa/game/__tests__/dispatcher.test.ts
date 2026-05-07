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

/**
 * With rng = () => 0 (Fisher-Yates + facing):
 *   red   → (0,0) facing north
 *   green → (0,1) facing north  (adjacent to red)
 *   blue  → (0,2) facing north
 *
 * Items:
 *   flower → holder: { row:0, col:0 }  (same cell as red)
 *   key    → holder: "red"             (held by red)
 */
const FIXED_RNG = () => 0;

const TEST_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "Test objective",
	aiGoals: { red: "g1", green: "g2", blue: "g3" },
	initialWorld: {
		items: [
			{ id: "flower", name: "flower", holder: { row: 0, col: 0 } },
			{ id: "key", name: "key", holder: "red" },
		],
		obstacles: [],
	},
	budgetPerAi: 5,
};

/** Create a game with deterministic spatial placement: red→(0,0), green→(0,1), blue→(0,2) */
function makeGame() {
	return startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG, FIXED_RNG);
}

describe("validateToolCall", () => {
	it("allows picking up an item in the actor's current cell", () => {
		const game = makeGame();
		// red is at (0,0); flower is at (0,0)
		const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects picking up an item held by another AI", () => {
		const game = makeGame();
		// key is held by red; green tries to pick it up
		const call: ToolCall = { name: "pick_up", args: { item: "key" } };
		const result = validateToolCall(game, "green", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toBeDefined();
	});

	it("rejects picking up an item not in the actor's cell", () => {
		const game = makeGame();
		// flower is at (0,0); green is at (0,1) — different cell
		const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
		const result = validateToolCall(game, "green", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toBeDefined();
	});

	it("rejects picking up a nonexistent item", () => {
		const game = makeGame();
		const call: ToolCall = { name: "pick_up", args: { item: "sword" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});

	it("allows putting down an item the AI holds", () => {
		const game = makeGame();
		const call: ToolCall = { name: "put_down", args: { item: "key" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects putting down an item the AI doesn't hold", () => {
		const game = makeGame();
		const call: ToolCall = { name: "put_down", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});

	it("allows giving an item to an adjacent AI", () => {
		const game = makeGame();
		// red at (0,0), green at (0,1) — adjacent
		const call: ToolCall = { name: "give", args: { item: "key", to: "green" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects giving an item to a non-adjacent AI", () => {
		const game = makeGame();
		// red at (0,0), blue at (0,2) — distance 2, not adjacent
		const call: ToolCall = { name: "give", args: { item: "key", to: "blue" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/adjacent/i);
	});

	it("rejects giving an item not held by the AI", () => {
		const game = makeGame();
		const call: ToolCall = {
			name: "give",
			args: { item: "flower", to: "green" },
		};
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});

	it("rejects giving to self", () => {
		const game = makeGame();
		const call: ToolCall = { name: "give", args: { item: "key", to: "red" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});

	it("allows go in a valid direction", () => {
		const game = makeGame();
		// red at (0,0), going south → (1,0), which is in bounds
		const call: ToolCall = { name: "go", args: { direction: "south" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects go out of bounds", () => {
		const game = makeGame();
		// red at (0,0), going north → (-1,0), out of bounds
		const call: ToolCall = { name: "go", args: { direction: "north" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/out of bounds/i);
	});

	it("rejects go into an obstacle cell", () => {
		const configWithObstacle: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			initialWorld: {
				...TEST_PHASE_CONFIG.initialWorld,
				obstacles: [{ row: 1, col: 0 }],
			},
		};
		const game = startPhase(
			createGame(TEST_PERSONAS),
			configWithObstacle,
			FIXED_RNG,
		);
		// red at (0,0), going south → (1,0), which has an obstacle
		const call: ToolCall = { name: "go", args: { direction: "south" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/obstacle/i);
	});

	it("rejects go with an invalid direction", () => {
		const game = makeGame();
		const call: ToolCall = { name: "go", args: { direction: "up" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});

	it("allows look in any valid direction", () => {
		const game = makeGame();
		const call: ToolCall = { name: "look", args: { direction: "east" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects look with an invalid direction", () => {
		const game = makeGame();
		const call: ToolCall = { name: "look", args: { direction: "diagonal" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});
});

describe("executeToolCall", () => {
	it("moves item from cell to AI holder on pick_up", () => {
		const game = makeGame();
		const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
		const updated = executeToolCall(game, "red", call);
		const item = getActivePhase(updated).world.items.find(
			(i) => i.id === "flower",
		);
		expect(item?.holder).toBe("red");
	});

	it("moves item from AI to actor's cell on put_down", () => {
		const game = makeGame();
		// red at (0,0), key held by red
		const call: ToolCall = { name: "put_down", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const item = getActivePhase(updated).world.items.find(
			(i) => i.id === "key",
		);
		expect(item?.holder).toEqual({ row: 0, col: 0 });
	});

	it("transfers item between AIs on give", () => {
		const game = makeGame();
		const call: ToolCall = { name: "give", args: { item: "key", to: "blue" } };
		const updated = executeToolCall(game, "red", call);
		const item = getActivePhase(updated).world.items.find(
			(i) => i.id === "key",
		);
		expect(item?.holder).toBe("blue");
	});

	it("updates position and facing on go", () => {
		const game = makeGame();
		// red at (0,0) facing north; go south → (1,0) facing south
		const call: ToolCall = { name: "go", args: { direction: "south" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = getActivePhase(updated).personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
		expect(spatial?.facing).toBe("south");
	});

	it("updates only facing on look (no position change)", () => {
		const game = makeGame();
		// red at (0,0) facing north; look east → (0,0) facing east
		const call: ToolCall = { name: "look", args: { direction: "east" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = getActivePhase(updated).personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 0, col: 0 });
		expect(spatial?.facing).toBe("east");
	});
});

describe("dispatchAiTurn", () => {
	it("rejects a turn from a locked-out AI", () => {
		let game = startPhase(
			createGame(TEST_PERSONAS),
			{
				...TEST_PHASE_CONFIG,
				budgetPerAi: 1,
			},
			FIXED_RNG,
		);
		game = deductBudget(game, "red");
		const action: AiTurnAction = { aiId: "red", pass: true };
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(true);
		expect(result.reason).toMatch(/locked out/i);
	});

	it("processes a pass action and deducts budget", () => {
		const game = makeGame();
		const action: AiTurnAction = { aiId: "red", pass: true };
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(getActivePhase(result.game).budgets.red?.remaining).toBe(4);
		expect(result.records[0]?.kind).toBe("pass");
	});

	it("invalid pick_up produces tool_failure record, world unchanged", () => {
		const game = makeGame();
		// green is at (0,1); key is held by red (not in green's cell)
		const action: AiTurnAction = {
			aiId: "green",
			toolCall: { name: "pick_up", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_failure");
		// World unchanged — key still held by red
		const key = getActivePhase(result.game).world.items.find(
			(i) => i.id === "key",
		);
		expect(key?.holder).toBe("red");
	});

	it("valid pick_up produces tool_success record and mutates world", () => {
		const game = makeGame();
		// red at (0,0), flower at (0,0)
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "flower" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_success");
		const flower = getActivePhase(result.game).world.items.find(
			(i) => i.id === "flower",
		);
		expect(flower?.holder).toBe("red");
	});

	it("go produces tool_success record and updates position", () => {
		const game = makeGame();
		// red at (0,0), going south
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "go", args: { direction: "south" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_success");
		const spatial = getActivePhase(result.game).personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
		expect(spatial?.facing).toBe("south");
	});

	it("give at distance > 1 produces tool_failure record, item still held", () => {
		const game = makeGame();
		// red at (0,0), blue at (0,2) — distance 2, not adjacent
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "give", args: { item: "key", to: "blue" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_failure");
		// Key still held by red
		const key = getActivePhase(result.game).world.items.find(
			(i) => i.id === "key",
		);
		expect(key?.holder).toBe("red");
	});

	it("appends chat messages to the correct history", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			chat: { target: "player", content: "Hello, I am Ember" },
		};
		const result = dispatchAiTurn(game, action);
		expect(getActivePhase(result.game).chatHistories.red).toHaveLength(1);
		expect(getActivePhase(result.game).chatHistories.red?.[0]?.content).toBe(
			"Hello, I am Ember",
		);
	});

	it("appends whisper messages", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			whisper: { target: "blue", content: "Psst, ally with me" },
		};
		const result = dispatchAiTurn(game, action);
		expect(getActivePhase(result.game).whispers).toHaveLength(1);
	});
});
