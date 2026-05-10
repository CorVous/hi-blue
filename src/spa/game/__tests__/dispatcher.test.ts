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
import type {
	AiPersona,
	AiTurnAction,
	ContentPack,
	PhaseConfig,
	ToolCall,
	WorldEntity,
} from "../types";

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
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
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
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
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
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
	},
};

/**
 * With rng = () => 0 (Fisher-Yates + facing):
 *   red   → (0,0) facing north
 *   green → (0,1) facing north  (adjacent to red)
 *   cyan  → (0,2) facing north
 *
 * Entities:
 *   flower → holder: { row:0, col:0 }  (same cell as red)
 *   key    → holder: "red"             (held by red)
 */
const FIXED_RNG = () => 0;

/** Helper to make a WorldEntity */
function makeEntity(
	id: string,
	kind: WorldEntity["kind"],
	holder: WorldEntity["holder"],
	extra: Partial<WorldEntity> = {},
): WorldEntity {
	return {
		id,
		kind,
		name: id,
		examineDescription: `A ${id}.`,
		holder,
		useOutcome: `You used the ${id}.`,
		...extra,
	};
}

/** Build a ContentPack for phase 1 with specific entities and AI starts. */
function makePackWithEntities(
	entities: {
		flower: WorldEntity["holder"];
		key: WorldEntity["holder"];
	},
	obstaclePositions: Array<{ row: number; col: number }> = [],
): ContentPack {
	const flower = makeEntity("flower", "interesting_object", entities.flower);
	const key = makeEntity("key", "interesting_object", entities.key);
	const obstacles = obstaclePositions.map((pos, i) =>
		makeEntity(`obs${i}`, "obstacle", pos),
	);
	return {
		phaseNumber: 1,
		setting: "test setting",
		weather: "",
		timeOfDay: "",
		objectivePairs: [],
		interestingObjects: [flower, key],
		obstacles,
		aiStarts: {
			red: { position: { row: 0, col: 0 }, facing: "north" },
			green: { position: { row: 0, col: 1 }, facing: "north" },
			cyan: { position: { row: 0, col: 2 }, facing: "north" },
		},
	};
}

const TEST_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	kRange: [0, 0],
	nRange: [2, 2],
	mRange: [0, 0],
	aiGoalPool: ["g1", "g2", "g3"],
	budgetPerAi: 5,
};

/** Create a game with deterministic spatial placement: red→(0,0), green→(0,1), cyan→(0,2) */
function makeGame(obstaclePositions: Array<{ row: number; col: number }> = []) {
	const pack = makePackWithEntities(
		{
			flower: { row: 0, col: 0 },
			key: "red", // held by red
		},
		obstaclePositions,
	);
	const game = createGame(TEST_PERSONAS, [pack]);
	return startPhase(game, TEST_PHASE_CONFIG, FIXED_RNG);
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
		// red at (0,0), cyan at (0,2) — distance 2, not adjacent
		const call: ToolCall = { name: "give", args: { item: "key", to: "cyan" } };
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
		const game = makeGame([{ row: 1, col: 0 }]);
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

	it("allows use of an item held by the AI", () => {
		const game = makeGame();
		// key is held by red
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects use of an item not held by the AI", () => {
		const game = makeGame();
		// flower is on the ground
		const call: ToolCall = { name: "use", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});

	// examine validation tests
	// red is at (0,0) facing north; flower is at (0,0) (own cell = cone); key is held by red
	it("examine: allows examining an item held by the actor", () => {
		const game = makeGame();
		const call: ToolCall = { name: "examine", args: { item: "key" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("examine: allows examining an item in the actor's own cell (cone)", () => {
		const game = makeGame();
		// flower is at (0,0), same as red's position
		const call: ToolCall = { name: "examine", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("examine: rejects examining an item outside the actor's cone", () => {
		const game = makeGame();
		// green is at (0,1) facing north; flower is at (0,0) — not in green's cone
		// green's cone facing north: (0,1), (row-1,col1)=(-1,1)[oob], (-2,0),(-2,1),(-2,2)[oob]
		// Actually (0,1) own cell, directly in front = (-1,1)[oob], two-step cells also oob
		// flower at (0,0) is NOT in green's cone
		const call: ToolCall = { name: "examine", args: { item: "flower" } };
		const result = validateToolCall(game, "green", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/cone/i);
	});

	it("examine: rejects examining a nonexistent item", () => {
		const game = makeGame();
		const call: ToolCall = { name: "examine", args: { item: "dragon" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/does not exist/i);
	});

	it("examine: allows examining an obstacle in the actor's cone", () => {
		// Place obstacle at (0,0) where red stands — own cell is in cone
		const pack = makePackWithEntities(
			{ flower: { row: 3, col: 3 }, key: { row: 4, col: 4 } },
			[{ row: 0, col: 0 }],
		);
		const game = startPhase(
			createGame(TEST_PERSONAS, [pack]),
			TEST_PHASE_CONFIG,
			FIXED_RNG,
		);
		const call: ToolCall = { name: "examine", args: { item: "obs0" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("examine: allows examining an objective_space in the actor's cone", () => {
		// Build a pack with an objective pair where the space is at (0,0) (red's cell)
		const objSpace: WorldEntity = {
			id: "space1",
			kind: "objective_space",
			name: "a space",
			examineDescription: "A place.",
			holder: { row: 0, col: 0 },
		};
		const objObj: WorldEntity = {
			id: "obj1",
			kind: "objective_object",
			name: "an object",
			examineDescription: "An object.",
			holder: { row: 4, col: 4 },
			pairsWithSpaceId: "space1",
		};
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [{ object: objObj, space: objSpace }],
			interestingObjects: [],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		let game = createGame(TEST_PERSONAS, [pack]);
		game = startPhase(game, TEST_PHASE_CONFIG, FIXED_RNG);
		// red at (0,0), space1 at (0,0) — own cell is in cone
		const call: ToolCall = { name: "examine", args: { item: "space1" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});
});

describe("executeToolCall", () => {
	it("moves item from cell to AI holder on pick_up", () => {
		const game = makeGame();
		const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
		const updated = executeToolCall(game, "red", call);
		const item = getActivePhase(updated).world.entities.find(
			(e) => e.id === "flower",
		);
		expect(item?.holder).toBe("red");
	});

	it("moves item from AI to actor's cell on put_down", () => {
		const game = makeGame();
		// red at (0,0), key held by red
		const call: ToolCall = { name: "put_down", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const item = getActivePhase(updated).world.entities.find(
			(e) => e.id === "key",
		);
		expect(item?.holder).toEqual({ row: 0, col: 0 });
	});

	it("transfers item between AIs on give", () => {
		const game = makeGame();
		const call: ToolCall = { name: "give", args: { item: "key", to: "cyan" } };
		const updated = executeToolCall(game, "red", call);
		const item = getActivePhase(updated).world.entities.find(
			(e) => e.id === "key",
		);
		expect(item?.holder).toBe("cyan");
	});

	it("does not mutate world on use", () => {
		const game = makeGame();
		const before = JSON.stringify(getActivePhase(game).world);
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const after = JSON.stringify(getActivePhase(updated).world);
		expect(after).toBe(before);
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

	it("does not mutate world on examine", () => {
		const game = makeGame();
		const before = JSON.stringify(getActivePhase(game).world);
		const call: ToolCall = { name: "examine", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const after = JSON.stringify(getActivePhase(updated).world);
		expect(after).toBe(before);
	});
});

describe("dispatchAiTurn", () => {
	it("rejects a turn from a locked-out AI", () => {
		let game = createGame(TEST_PERSONAS, [
			makePackWithEntities({ flower: { row: 0, col: 0 }, key: "red" }),
		]);
		game = startPhase(
			game,
			{
				...TEST_PHASE_CONFIG,
				budgetPerAi: 0.01,
			},
			FIXED_RNG,
		);
		game = deductBudget(game, "red", 0.01);
		const action: AiTurnAction = { aiId: "red", pass: true };
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(true);
		expect(result.reason).toMatch(/locked out/i);
	});

	it("processes a pass action and deducts budget", () => {
		const game = makeGame();
		const action: AiTurnAction = { aiId: "red", pass: true };
		const result = dispatchAiTurn(game, action, { costUsd: 1 });
		expect(result.rejected).toBe(false);
		expect(getActivePhase(result.game).budgets.red?.remaining).toBeCloseTo(
			4,
			10,
		);
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
		const key = getActivePhase(result.game).world.entities.find(
			(e) => e.id === "key",
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
		const flower = getActivePhase(result.game).world.entities.find(
			(e) => e.id === "flower",
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
		// red at (0,0), cyan at (0,2) — distance 2, not adjacent
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "give", args: { item: "key", to: "cyan" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_failure");
		// Key still held by red
		const key = getActivePhase(result.game).world.entities.find(
			(e) => e.id === "key",
		);
		expect(key?.holder).toBe("red");
	});

	it("use returns tool_success with entity's useOutcome as description", () => {
		const game = makeGame();
		// key has useOutcome: "You used the key."
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_success");
		expect(result.records[0]?.description).toBe("You used the key.");
		// World is byte-identical before and after use
		const beforeEntities = JSON.stringify(getActivePhase(game).world.entities);
		const afterEntities = JSON.stringify(
			getActivePhase(result.game).world.entities,
		);
		expect(afterEntities).toBe(beforeEntities);
	});

	it("use with unknown id is rejected", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "use", args: { item: "nonexistent" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.records[0]?.kind).toBe("tool_failure");
	});

	it("message tool to blue appends entry to sender's log only", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			message: { to: "blue", content: "Hello, I am Ember" },
		};
		const result = dispatchAiTurn(game, action);
		const redLog = getActivePhase(result.game).conversationLogs.red ?? [];
		const msgEntries = redLog.filter((e) => e.kind === "message");
		expect(msgEntries).toHaveLength(1);
		expect(msgEntries[0]?.kind === "message" && msgEntries[0].content).toBe(
			"Hello, I am Ember",
		);
		expect(result.records[0]?.kind).toBe("message");
	});

	it("message tool to peer appends to both sender and recipient conversationLogs", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			message: { to: "cyan", content: "Psst, ally with me" },
		};
		const result = dispatchAiTurn(game, action);
		const phase = getActivePhase(result.game);
		const redMessages = (phase.conversationLogs.red ?? []).filter(
			(e) => e.kind === "message",
		);
		const cyanMessages = (phase.conversationLogs.cyan ?? []).filter(
			(e) => e.kind === "message",
		);
		expect(redMessages).toHaveLength(1);
		expect(cyanMessages).toHaveLength(1);
		// Sender and recipient entries must be deep-equal objects (same round, same fields)
		expect(redMessages[0]).toEqual(cyanMessages[0]);
		expect(redMessages[0]).toMatchObject({
			kind: "message",
			from: "red",
			to: "cyan",
			content: "Psst, ally with me",
		});
		expect("whispers" in phase).toBe(false);
	});

	it("message tool with unknown recipient produces tool_failure and does not mutate any log", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			message: { to: "nobody", content: "Hello?" },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.records[0]?.kind).toBe("tool_failure");
		// No logs should be mutated
		for (const aiId of ["red", "green", "cyan"]) {
			expect(getActivePhase(result.game).conversationLogs[aiId]).toHaveLength(
				0,
			);
		}
	});

	it("put_down of objective_object on its matching space yields placementFlavor as description", () => {
		// Build a pack where gem (held by red at (0,0)) pairs with altar_space (at (0,0))
		const gemObject: WorldEntity = {
			id: "gem",
			kind: "objective_object",
			name: "gem",
			examineDescription: "A gem.",
			holder: "red",
			pairsWithSpaceId: "altar_space",
			placementFlavor: "{actor} places the gem on the altar.",
		};
		const altarSpace: WorldEntity = {
			id: "altar_space",
			kind: "objective_space",
			name: "altar space",
			examineDescription: "A pedestal.",
			holder: { row: 0, col: 0 }, // red's cell
		};
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [{ object: gemObject, space: altarSpace }],
			interestingObjects: [],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		let game = createGame(TEST_PERSONAS, [pack]);
		game = startPhase(game, TEST_PHASE_CONFIG, FIXED_RNG);

		// red is at (0,0) and holds the gem; altar_space is also at (0,0)
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "put_down", args: { item: "gem" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.records[0]?.kind).toBe("tool_success");
		expect(result.records[0]?.description).toBe(
			"you places the gem on the altar.",
		);
	});

	// examine tests
	it("examine: no records produced, actorPrivateToolResult set on success", () => {
		// red holds the key; examine key → private result with examineDescription
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "examine", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		// No tool_success or tool_failure records for examine
		expect(
			result.records.filter(
				(r) => r.kind === "tool_success" || r.kind === "tool_failure",
			),
		).toHaveLength(0);
		// actorPrivateToolResult is set
		expect(result.actorPrivateToolResult).toBeDefined();
		expect(result.actorPrivateToolResult?.success).toBe(true);
		expect(result.actorPrivateToolResult?.description).toBe("A key.");
	});

	it("examine: actorPrivateToolResult.success false and description set on failure", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "examine", args: { item: "nonexistent" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records).toHaveLength(0);
		expect(result.actorPrivateToolResult).toBeDefined();
		expect(result.actorPrivateToolResult?.success).toBe(false);
		expect(result.actorPrivateToolResult?.description).toMatch(
			/does not exist/i,
		);
	});

	it("examine: budget is deducted on examine", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "examine", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action, { costUsd: 1 });
		expect(getActivePhase(result.game).budgets.red?.remaining).toBeCloseTo(
			4,
			10,
		);
	});

	it("put_down of objective_object on a non-matching cell yields default description", () => {
		// gem held by red (at 0,0), altar_space is at (3,3) — different cell
		const gemObject: WorldEntity = {
			id: "gem",
			kind: "objective_object",
			name: "gem",
			examineDescription: "A gem.",
			holder: "red",
			pairsWithSpaceId: "altar_space",
			placementFlavor: "{actor} places the gem on the altar.",
		};
		const altarSpace: WorldEntity = {
			id: "altar_space",
			kind: "objective_space",
			name: "altar space",
			examineDescription: "A pedestal.",
			holder: { row: 3, col: 3 }, // different from red's cell (0,0)
		};
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [{ object: gemObject, space: altarSpace }],
			interestingObjects: [],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		let game = createGame(TEST_PERSONAS, [pack]);
		game = startPhase(game, TEST_PHASE_CONFIG, FIXED_RNG);

		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "put_down", args: { item: "gem" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.records[0]?.kind).toBe("tool_success");
		// Should fall back to the default "X put down the Y" description
		expect(result.records[0]?.description).toMatch(/put down/i);
		expect(result.records[0]?.description).not.toContain(
			"places the gem on the altar",
		);
	});

	// -------------------------------------------------------------------------
	// write-time cone + per-Daemon whispers (issue #195, AC 12 & AC 13)
	// -------------------------------------------------------------------------

	it("AC 12: actor's own pick_up does NOT append witnessed-event to actor's log; in-cone witness receives one", () => {
		/**
		 * Fixture (mirrors conversation-log-integration.test.ts):
		 *   - red at (2,0) facing south — picks up flower
		 *   - green at (0,0) facing south — cone: own (0,0), front (1,0), two-ahead (2,0) ← in cone
		 *   - cyan at (0,2) facing south — cone: own (0,2), front (1,2), two-ahead (2,2) — (2,0) NOT in cone
		 */
		const flower = makeEntity("flower", "interesting_object", {
			row: 2,
			col: 0,
		});
		const packWithCone: ContentPack = {
			phaseNumber: 1,
			setting: "cone test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [flower],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 2, col: 0 }, facing: "south" },
				green: { position: { row: 0, col: 0 }, facing: "south" },
				cyan: { position: { row: 0, col: 2 }, facing: "south" },
			},
		};
		const coneGame = startPhase(
			createGame(TEST_PERSONAS, [packWithCone]),
			TEST_PHASE_CONFIG,
		);

		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "flower" } },
		};
		const result = dispatchAiTurn(coneGame, action);
		const phase = getActivePhase(result.game);

		// Actor (red) must NOT have any witnessed-event in their own log
		const redWitnessed = (phase.conversationLogs.red ?? []).filter(
			(e) => e.kind === "witnessed-event",
		);
		expect(redWitnessed).toHaveLength(0);

		// green's cone at (0,0) facing south includes (2,0) as "two steps ahead"
		// → green must have a witnessed-event entry for the pick_up
		const greenWitnessed = (phase.conversationLogs.green ?? []).filter(
			(e) => e.kind === "witnessed-event",
		);
		expect(greenWitnessed.length).toBeGreaterThanOrEqual(1);
		expect(greenWitnessed[0]).toMatchObject({
			kind: "witnessed-event",
			actor: "red",
			actionKind: "pick_up",
		});
	});

	it("AC 13: examine action leaves all three Daemons' conversationLogs byte-for-byte identical to pre-dispatch state", () => {
		const game = makeGame();
		const phase = getActivePhase(game);
		// Deep-clone pre-dispatch logs for all three Daemons
		const preLogs = {
			red: JSON.parse(JSON.stringify(phase.conversationLogs.red ?? [])),
			green: JSON.parse(JSON.stringify(phase.conversationLogs.green ?? [])),
			cyan: JSON.parse(JSON.stringify(phase.conversationLogs.cyan ?? [])),
		};

		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "examine", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action);
		const afterPhase = getActivePhase(result.game);

		// No log entries must have been added to any Daemon
		expect(afterPhase.conversationLogs.red ?? []).toEqual(preLogs.red);
		expect(afterPhase.conversationLogs.green ?? []).toEqual(preLogs.green);
		expect(afterPhase.conversationLogs.cyan ?? []).toEqual(preLogs.cyan);
	});
});
