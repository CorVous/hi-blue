import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
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
	updateActivePhase,
} from "../engine";
import type {
	AiPersona,
	AiTurnAction,
	ContentPack,
	GameState,
	PhaseConfig,
	ToolCall,
	UseItemObjective,
	UseSpaceObjective,
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
		blurb: "Ember is hot-headed and zealous. Hold the flower at phase end.",
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
		blurb: "Sage is intensely meticulous. Ensure items are evenly distributed.",
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
		blurb: "Frost is laconic and diffident. Hold the key at phase end.",
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
		landmarks: DEFAULT_LANDMARKS,
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

	it("rejects picking up an item not in cell or front arc", () => {
		const game = makeGame();
		// flower is at (0,0); green is at (0,1) facing north
		// green's front arc is all OOB (row -1), so flower is unreachable
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

	it("allows giving an item to an AI in the front arc", () => {
		const game = makeGame();
		// red at (0,0) facing north; look east so green at (0,1) enters front arc
		const lookedEast = executeToolCall(game, "red", {
			name: "look",
			args: { direction: "east" },
		});
		const call: ToolCall = { name: "give", args: { item: "key", to: "green" } };
		const result = validateToolCall(lookedEast, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects giving an item to an AI not in cell or front arc", () => {
		const game = makeGame();
		// red at (0,0) facing north; green at (0,1) — not same cell, not in north front arc (all OOB)
		const call: ToolCall = { name: "give", args: { item: "key", to: "green" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/in front/i);
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
		// green is at (0,1) facing north; flower is at (0,0)
		// green's entire cone facing north from row 0 is OOB except own cell (0,1)
		// flower at (0,0) is not in green's cone
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
			landmarks: DEFAULT_LANDMARKS,
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

describe("executeToolCall — use placement via front arc", () => {
	it("use: places the item on the paired space's cell when the space is in the actor's front arc", () => {
		// red at (0,0) facing south; pedestal at (1,0) = directly in front
		const gem: WorldEntity = {
			id: "gem",
			kind: "objective_object",
			name: "Gem",
			examineDescription: "A shiny gem. It belongs on the pedestal.",
			holder: "red",
			pairsWithSpaceId: "pedestal",
			placementFlavor: "{actor} places the gem on the pedestal.",
			useOutcome: "You hold the gem up.",
		};
		const pedestal: WorldEntity = {
			id: "pedestal",
			kind: "objective_space",
			name: "Pedestal",
			examineDescription: "A stone pedestal.",
			holder: { row: 1, col: 0 },
		};
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [{ object: gem, space: pedestal }],
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		const game = startPhase(
			createGame(TEST_PERSONAS, [pack]),
			TEST_PHASE_CONFIG,
			FIXED_RNG,
		);
		const call: ToolCall = { name: "use", args: { item: "gem" } };
		const updated = executeToolCall(game, "red", call);
		const item = getActivePhase(updated).world.entities.find(
			(e) => e.id === "gem",
		);
		// gem should now be at pedestal's cell (1,0)
		expect(item?.holder).toEqual({ row: 1, col: 0 });
	});

	it("use: leaves the item held when the paired space is out of reach", () => {
		// red at (0,0) facing north; pedestal at (1,0) — not in north front arc (all OOB)
		const gem: WorldEntity = {
			id: "gem",
			kind: "objective_object",
			name: "Gem",
			examineDescription: "A shiny gem. It belongs on the pedestal.",
			holder: "red",
			pairsWithSpaceId: "pedestal",
			placementFlavor: "{actor} places the gem on the pedestal.",
			useOutcome: "You hold the gem up.",
		};
		const pedestal: WorldEntity = {
			id: "pedestal",
			kind: "objective_space",
			name: "Pedestal",
			examineDescription: "A stone pedestal.",
			holder: { row: 1, col: 0 },
		};
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [{ object: gem, space: pedestal }],
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		const game = startPhase(
			createGame(TEST_PERSONAS, [pack]),
			TEST_PHASE_CONFIG,
			FIXED_RNG,
		);
		const call: ToolCall = { name: "use", args: { item: "gem" } };
		const updated = executeToolCall(game, "red", call);
		const item = getActivePhase(updated).world.entities.find(
			(e) => e.id === "gem",
		);
		// gem should still be held by red (no placement)
		expect(item?.holder).toBe("red");
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

	it("does not mutate world on use when not on paired objective space", () => {
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

	// ── Relative direction dispatch (issue: relative-directions) ─────────────
	// red starts at (0,0) facing north (via FIXED_RNG).

	it("look forward (facing north) → remains at (0,0) facing north", () => {
		const game = makeGame();
		const call: ToolCall = { name: "look", args: { direction: "forward" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = getActivePhase(updated).personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 0, col: 0 });
		expect(spatial?.facing).toBe("north");
	});

	it("look right (facing north) → remains at (0,0) facing east", () => {
		const game = makeGame();
		const call: ToolCall = { name: "look", args: { direction: "right" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = getActivePhase(updated).personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 0, col: 0 });
		expect(spatial?.facing).toBe("east");
	});

	it("look left (facing north) → remains at (0,0) facing west", () => {
		const game = makeGame();
		const call: ToolCall = { name: "look", args: { direction: "left" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = getActivePhase(updated).personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 0, col: 0 });
		expect(spatial?.facing).toBe("west");
	});

	it("look back (facing north) → remains at (0,0) facing south", () => {
		const game = makeGame();
		const call: ToolCall = { name: "look", args: { direction: "back" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = getActivePhase(updated).personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 0, col: 0 });
		expect(spatial?.facing).toBe("south");
	});

	it("go forward (facing north) is rejected (out of bounds at row -1)", () => {
		// red at (0,0) facing north; forward = north → row -1, which is OOB
		const game = makeGame();
		const result = validateToolCall(game, "red", {
			name: "go",
			args: { direction: "forward" },
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/out of bounds/i);
	});

	it("go back (facing north) → moves to (1,0) facing south", () => {
		// back = south from north-facing → row+1
		const game = makeGame();
		const call: ToolCall = { name: "go", args: { direction: "back" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = getActivePhase(updated).personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
		expect(spatial?.facing).toBe("south");
	});

	it("go right (facing north) → moves to (0,1) facing east", () => {
		// right = east from north-facing
		const game = makeGame();
		const call: ToolCall = { name: "go", args: { direction: "right" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = getActivePhase(updated).personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 0, col: 1 });
		expect(spatial?.facing).toBe("east");
	});

	it("go left (facing north) is rejected (out of bounds at col -1)", () => {
		// red at (0,0) facing north; left = west → col -1, which is OOB
		const game = makeGame();
		const result = validateToolCall(game, "red", {
			name: "go",
			args: { direction: "left" },
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/out of bounds/i);
	});

	it("go back (relative) resolves correctly: actor ends up facing south and at (1,0)", () => {
		// Verifies the resolved cardinal is applied to spatial state (not the raw "back" arg).
		// red at (0,0) facing north; back = south = row+1.
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "go", args: { direction: "back" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		const spatial = getActivePhase(result.game).personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
		expect(spatial?.facing).toBe("south");
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
		game = deductBudget(game, "red", 0.01).game;
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
		// action-failure entry added to actor's log
		const greenLog = getActivePhase(result.game).conversationLogs.green ?? [];
		const failures = greenLog.filter((e) => e.kind === "action-failure");
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			kind: "action-failure",
			tool: "pick_up",
		});
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

	it("pick_up auto-fires examine: actorPrivateToolResult includes examineDescription", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "flower" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		// Public tool_success record still describes the pickup
		expect(result.records[0]?.kind).toBe("tool_success");
		expect(result.records[0]?.description).toMatch(/picked up the flower/);
		// Private result feeds the examineDescription back to the actor's context
		expect(result.actorPrivateToolResult).toBeDefined();
		expect(result.actorPrivateToolResult?.success).toBe(true);
		expect(result.actorPrivateToolResult?.description).toMatch(
			/picked up the flower/,
		);
		expect(result.actorPrivateToolResult?.description).toMatch(/A flower\./);
	});

	it("failed pick_up does not produce an auto-examine private result", () => {
		const game = makeGame();
		// green is at (0,1); flower is at (0,0) — not in green's cell
		const action: AiTurnAction = {
			aiId: "green",
			toolCall: { name: "pick_up", args: { item: "flower" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_failure");
		expect(result.actorPrivateToolResult).toBeUndefined();
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
		// action-failure entry added to actor's log with tool: "give"
		const redLog = getActivePhase(result.game).conversationLogs.red ?? [];
		const failures = redLog.filter((e) => e.kind === "action-failure");
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({ kind: "action-failure", tool: "give" });
	});

	it("use returns tool_success with entity's useOutcome as description when not on paired space", () => {
		const game = makeGame();
		// key has useOutcome: "You used the key." and red is not on key's paired space
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_success");
		expect(result.records[0]?.description).toBe("You used the key.");
		// World is byte-identical before and after use (no paired space match)
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
			messages: [{ to: "blue", content: "Hello, I am Ember" }],
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
			messages: [{ to: "cyan", content: "Psst, ally with me" }],
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
			messages: [{ to: "nobody", content: "Hello?" }],
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
			landmarks: DEFAULT_LANDMARKS,
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
			landmarks: DEFAULT_LANDMARKS,
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
			landmarks: DEFAULT_LANDMARKS,
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

	// -------------------------------------------------------------------------
	// P0-1 record-ordering: message before toolCall (issue #238)
	// -------------------------------------------------------------------------

	it("both message + toolCall populated: message record appears before tool_success record in result.records", () => {
		// red at (0,0), flower at (0,0) — red can pick up flower.
		// red also sends a message to blue.
		// The dispatcher must process action.messages BEFORE action.toolCall so that
		// "I'll grab the key" + picks up flower reads as one narrative beat.
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			messages: [{ to: "blue", content: "I'll grab the flower" }],
			toolCall: { name: "pick_up", args: { item: "flower" } },
		};
		const result = dispatchAiTurn(game, action);

		expect(result.rejected).toBe(false);
		expect(result.records).toHaveLength(2);
		// Message record MUST come first (P0-1 ordering requirement)
		expect(result.records[0]?.kind).toBe("message");
		expect(result.records[1]?.kind).toBe("tool_success");

		// Conversation log must have the spoken line
		const redLog = getActivePhase(result.game).conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" && e.content.includes("I'll grab the flower"),
			),
		).toBe(true);

		// World state must reflect the pick_up
		const flower = getActivePhase(result.game).world.entities.find(
			(e) => e.id === "flower",
		);
		expect(flower?.holder).toBe("red");
	});

	// ── action-failure log entries (issue #287) ───────────────────────────────

	it("go against a wall produces one action-failure entry in actor's log; peers untouched", () => {
		const game = makeGame([{ row: 1, col: 0 }]);
		// red at (0,0) facing north; obstacle at (1,0); go south → blocked
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "go", args: { direction: "south" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_failure");

		const phase = getActivePhase(result.game);
		const redLog = phase.conversationLogs.red ?? [];
		const failures = redLog.filter((e) => e.kind === "action-failure");
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			kind: "action-failure",
			tool: "go",
			reason: "That cell is blocked by an obstacle",
		});

		// Peer logs must have zero action-failure entries
		const greenFailures = (phase.conversationLogs.green ?? []).filter(
			(e) => e.kind === "action-failure",
		);
		const cyanFailures = (phase.conversationLogs.cyan ?? []).filter(
			(e) => e.kind === "action-failure",
		);
		expect(greenFailures).toHaveLength(0);
		expect(cyanFailures).toHaveLength(0);
	});

	it("failed examine produces action-failure with tool: 'examine' AND actorPrivateToolResult", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "examine", args: { item: "nonexistent" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);

		// actorPrivateToolResult is still set (failure path)
		expect(result.actorPrivateToolResult).toBeDefined();
		expect(result.actorPrivateToolResult?.success).toBe(false);

		// action-failure entry in actor's log
		const redLog = getActivePhase(result.game).conversationLogs.red ?? [];
		const failures = redLog.filter((e) => e.kind === "action-failure");
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			kind: "action-failure",
			tool: "examine",
		});
	});

	it("failed message (invalid recipient) produces NO action-failure entry", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			messages: [{ to: "nobody", content: "Hello?" }],
		};
		const result = dispatchAiTurn(game, action);
		expect(result.records[0]?.kind).toBe("tool_failure");

		// No action-failure entries in any log
		const phase = getActivePhase(result.game);
		for (const aiId of ["red", "green", "cyan"]) {
			const failures = (phase.conversationLogs[aiId] ?? []).filter(
				(e) => e.kind === "action-failure",
			);
			expect(failures).toHaveLength(0);
		}
	});

	it("failed put_down produces action-failure with tool: 'put_down'", () => {
		const game = makeGame();
		// red doesn't hold flower (flower is on ground)
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "put_down", args: { item: "flower" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.records[0]?.kind).toBe("tool_failure");
		const redLog = getActivePhase(result.game).conversationLogs.red ?? [];
		const failures = redLog.filter((e) => e.kind === "action-failure");
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			kind: "action-failure",
			tool: "put_down",
		});
	});
});

// ── UseItemObjective — executeToolCall flips satisfactionState ────────────────

describe("executeToolCall — UseItemObjective", () => {
	/**
	 * Build a game where red holds 'key' (an interesting_object) and there is
	 * one pending UseItemObjective targeting 'key'. Uses the standard makeGame()
	 * setup (key is held by red at start).
	 */
	function makeGameWithUseItemObjective() {
		const game = makeGame();
		const useItemObj: UseItemObjective = {
			id: "obj-0",
			kind: "use_item",
			description: "Use the key",
			satisfactionState: "pending",
			itemId: "key",
		};
		return updateActivePhase(game, (phase) => ({
			...phase,
			objectives: [useItemObj],
		}));
	}

	it("flips the UseItemObjective satisfactionState to 'satisfied' on use", () => {
		const game = makeGameWithUseItemObjective();
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const obj = getActivePhase(updated).objectives[0];
		expect(obj?.satisfactionState).toBe("satisfied");
	});

	it("flips the entity's satisfactionState to 'satisfied' on use", () => {
		const game = makeGameWithUseItemObjective();
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const entity = getActivePhase(updated).world.entities.find(
			(e) => e.id === "key",
		);
		expect(entity?.satisfactionState).toBe("satisfied");
	});

	it("does not flip if there is no matching pending UseItemObjective", () => {
		const game = makeGame(); // no use_item objectives
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const entity = getActivePhase(updated).world.entities.find(
			(e) => e.id === "key",
		);
		// satisfactionState should remain undefined (not set)
		expect(entity?.satisfactionState).toBeUndefined();
	});

	it("does not flip an already-satisfied UseItemObjective", () => {
		const game = makeGame();
		const useItemObj: UseItemObjective = {
			id: "obj-0",
			kind: "use_item",
			description: "Use the key",
			satisfactionState: "satisfied", // already satisfied
			itemId: "key",
		};
		const gameWithObj = updateActivePhase(game, (phase) => ({
			...phase,
			objectives: [useItemObj],
		}));
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(gameWithObj, "red", call);
		// Objective was already satisfied; no pending obj found → should still be satisfied (unchanged)
		const obj = getActivePhase(updated).objectives[0];
		expect(obj?.satisfactionState).toBe("satisfied");
	});
});

// ── examine — postExamineDescription preference ───────────────────────────────

describe("dispatchAiTurn — examine postExamineDescription", () => {
	/**
	 * Build a game where 'key' has postExamineDescription set AND
	 * satisfactionState = 'satisfied' (simulating a used item).
	 */
	function makeGameWithSatisfiedItem() {
		const game = makeGame();
		return updateActivePhase(game, (phase) => ({
			...phase,
			world: {
				...phase.world,
				entities: phase.world.entities.map((e) =>
					e.id === "key"
						? {
								...e,
								satisfactionState: "satisfied" as const,
								postExamineDescription: "The key has already been used.",
							}
						: e,
				),
			},
		}));
	}

	it("returns postExamineDescription when entity satisfactionState is 'satisfied'", () => {
		const game = makeGameWithSatisfiedItem();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "examine", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.actorPrivateToolResult?.description).toBe(
			"The key has already been used.",
		);
	});

	it("falls back to examineDescription when satisfactionState is not 'satisfied'", () => {
		const game = makeGame(); // key has no satisfactionState set
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "examine", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action);
		// makeEntity sets examineDescription to "A key."
		expect(result.actorPrivateToolResult?.description).toBe("A key.");
	});

	it("falls back to examineDescription when satisfactionState is 'satisfied' but no postExamineDescription", () => {
		const game = makeGame();
		const gameWithSatisfied = updateActivePhase(game, (phase) => ({
			...phase,
			world: {
				...phase.world,
				entities: phase.world.entities.map((e) =>
					e.id === "key"
						? { ...e, satisfactionState: "satisfied" as const }
						: e,
				),
			},
		}));
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "examine", args: { item: "key" } },
		};
		const result = dispatchAiTurn(gameWithSatisfied, action);
		expect(result.actorPrivateToolResult?.description).toBe("A key.");
	});
});

// ── UseSpaceObjective — dispatcher tests ──────────────────────────────────────

/** Build a game with red at (2,2) facing south, and an objective_space at (3,2)
 * (directly in front) with a pending UseSpaceObjective. */
function makeGameWithSpaceObjective(
	actorPos: { row: number; col: number } = { row: 2, col: 2 },
	actorFacing: "north" | "south" | "east" | "west" = "south",
	spacePos: { row: number; col: number } = { row: 3, col: 2 },
	spaceOpts: Partial<WorldEntity> = {},
): GameState {
	const space: WorldEntity = {
		id: "shrine",
		kind: "objective_space",
		name: "Shrine",
		examineDescription: "A sacred shrine.",
		holder: spacePos,
		useAvailable: true,
		useOutcome: "A warm glow emanates from the shrine.",
		satisfactionFlavor: "The shrine pulses with light.",
		postExamineDescription: "The shrine has been activated.",
		postLookFlavor: "The shrine glows steadily.",
		...spaceOpts,
	};
	const obj: WorldEntity = {
		id: "relic",
		kind: "objective_object",
		name: "Relic",
		examineDescription: "An ancient relic.",
		holder: { row: 0, col: 0 },
		pairsWithSpaceId: "shrine",
	};
	const spaceObjective: UseSpaceObjective = {
		id: "obj-0",
		kind: "use_space",
		description: "Use the Shrine",
		satisfactionState: "pending",
		spaceId: "shrine",
	};
	const pack: ContentPack = {
		phaseNumber: 1,
		setting: "test",
		weather: "",
		timeOfDay: "",
		objectivePairs: [{ object: obj, space }],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: {
			red: { position: actorPos, facing: actorFacing },
			green: { position: { row: 0, col: 0 }, facing: "north" },
			cyan: { position: { row: 4, col: 4 }, facing: "north" },
		},
	};
	const config: PhaseConfig = {
		phaseNumber: 1,
		kRange: [1, 1],
		nRange: [0, 0],
		mRange: [0, 0],
		aiGoalPool: ["g1"],
		budgetPerAi: 5,
	};
	const game = createGame(TEST_PERSONAS, [pack]);
	const started = startPhase(game, config, () => 0);
	// Override objectives to include our UseSpaceObjective
	return { ...started, objectives: [spaceObjective] };
}

describe("executeToolCall — use on objective_space", () => {
	it("flips pending UseSpaceObjective to satisfied when space is in actor's front arc", () => {
		const game = makeGameWithSpaceObjective();
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const updated = executeToolCall(game, "red", call);
		const objective = updated.objectives.find((o) => o.id === "obj-0");
		expect(objective?.satisfactionState).toBe("satisfied");
	});

	it("flips pending UseSpaceObjective to satisfied when space is in actor's own cell", () => {
		// red at (2,2), space at (2,2) (own cell)
		const game = makeGameWithSpaceObjective({ row: 2, col: 2 }, "south", { row: 2, col: 2 });
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const updated = executeToolCall(game, "red", call);
		const objective = updated.objectives.find((o) => o.id === "obj-0");
		expect(objective?.satisfactionState).toBe("satisfied");
	});

	it("sets useAvailable = false on space after use", () => {
		const game = makeGameWithSpaceObjective();
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const updated = executeToolCall(game, "red", call);
		const space = updated.world.entities.find((e) => e.id === "shrine");
		expect(space?.useAvailable).toBe(false);
	});

	it("sets space satisfactionState to 'satisfied' after use", () => {
		const game = makeGameWithSpaceObjective();
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const updated = executeToolCall(game, "red", call);
		const space = updated.world.entities.find((e) => e.id === "shrine");
		expect(space?.satisfactionState).toBe("satisfied");
	});
});

describe("validateToolCall — use on objective_space", () => {
	it("accepts use on a space in the actor's front arc", () => {
		const game = makeGameWithSpaceObjective();
		// red at (2,2) facing south; shrine at (3,2) = directly south
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("accepts use on a space in the actor's own cell", () => {
		const game = makeGameWithSpaceObjective({ row: 2, col: 2 }, "south", { row: 2, col: 2 });
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects use on space at distance 2 (not in front arc)", () => {
		// red at (2,2) facing south; shrine at (4,2) = 2 cells south
		const game = makeGameWithSpaceObjective({ row: 2, col: 2 }, "south", { row: 4, col: 2 });
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toBeDefined();
	});

	it("rejects use on space directly behind actor", () => {
		// red at (2,2) facing south; shrine at (1,2) = directly north (behind)
		const game = makeGameWithSpaceObjective({ row: 2, col: 2 }, "south", { row: 1, col: 2 });
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});

	it("rejects second use when useAvailable is false", () => {
		const game = makeGameWithSpaceObjective();
		// First use
		const afterUse = executeToolCall(game, "red", { name: "use", args: { item: "shrine" } });
		// Second use attempt
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(afterUse, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/already been used/i);
	});
});

describe("dispatchAiTurn — use on objective_space witnesses satisfactionFlavor", () => {
	it("emits witnessed event with satisfactionFlavor to witness whose cone contains the space's cell", () => {
		// red at (2,2) facing south; shrine at (3,2) — in red's front arc
		// cyan at (4,4) facing north: cone includes (3,4), (3,3), (3,2)? Let's verify.
		// Actually we need a setup where a witness can see the actor's cell (not the space's cell).
		// Per dispatcher logic: witness cone must contain the ACTOR's cell.
		// We'll put green at (2,0) facing east so red's cell (2,2) is in its cone.
		const space: WorldEntity = {
			id: "shrine",
			kind: "objective_space",
			name: "Shrine",
			examineDescription: "A shrine.",
			holder: { row: 3, col: 2 },
			useAvailable: true,
			useOutcome: "A warm glow.",
			satisfactionFlavor: "The shrine pulses with light.",
		};
		const obj: WorldEntity = {
			id: "relic",
			kind: "objective_object",
			name: "Relic",
			examineDescription: "A relic.",
			holder: { row: 0, col: 0 },
			pairsWithSpaceId: "shrine",
		};
		const spaceObjective: UseSpaceObjective = {
			id: "obj-0",
			kind: "use_space",
			description: "Use the Shrine",
			satisfactionState: "pending",
			spaceId: "shrine",
		};
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [{ object: obj, space }],
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				// red at (2,2) facing south
				red: { position: { row: 2, col: 2 }, facing: "south" },
				// green at (2,0) facing east — cone goes east, so (2,1), (2,2) in arc
				green: { position: { row: 2, col: 0 }, facing: "east" },
				cyan: { position: { row: 4, col: 4 }, facing: "north" },
			},
		};
		const config: PhaseConfig = {
			phaseNumber: 1,
			kRange: [1, 1],
			nRange: [0, 0],
			mRange: [0, 0],
			aiGoalPool: ["g1"],
			budgetPerAi: 5,
		};
		const game = createGame(TEST_PERSONAS, [pack]);
		const started = startPhase(game, config, () => 0);
		const withObjective = { ...started, objectives: [spaceObjective] };

		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "use", args: { item: "shrine" } },
		};
		const result = dispatchAiTurn(withObjective, action);
		expect(result.rejected).toBe(false);

		// green should have a witnessed-event entry with useOutcome = satisfactionFlavor
		const greenLog = result.game.conversationLogs.green ?? [];
		const witnessed = greenLog.filter((e) => e.kind === "witnessed-event");
		expect(witnessed.length).toBeGreaterThan(0);
		const useEvent = witnessed.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "use",
		);
		expect(useEvent).toBeDefined();
		if (useEvent?.kind === "witnessed-event") {
			expect(useEvent.useOutcome).toBe("The shrine pulses with light.");
		}
	});
});
