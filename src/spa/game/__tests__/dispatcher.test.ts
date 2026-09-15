import { describe, expect, it } from "vitest";
import { availableTools } from "../available-tools";
import type { CardinalDirection } from "../direction";
import {
	dispatchAiTurn,
	executeToolCall,
	validateToolCall,
} from "../dispatcher";
import { deductBudget, startGame } from "../engine";
import type {
	AiId,
	AiPersona,
	AiTurnAction,
	CarryObjective,
	ContentPack,
	ConvergenceObjective,
	GameState,
	Objective,
	ToolCall,
	UseItemObjective,
	UseSpaceObjective,
	WorldEntity,
} from "../types";
import {
	checkConvergenceTier,
	isCarryObjectiveSatisfied,
	isUseItemObjectiveSatisfied,
} from "../win-condition";
import { makeTestPack } from "./fixtures/make-test-pack";

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

/**
 * A raw tool call as an LLM could hand it over: a name outside `ToolName`
 * (e.g. the retired `face` tool) reaching the dispatcher without the tool
 * enum having filtered it out.
 */
function rawToolCall(name: string, args: Record<string, string>): ToolCall {
	return { name, args } as unknown as ToolCall;
}

/**
 * Test-only: set a Daemon's stored facing without a tool call. Daemons still
 * keep a `facing` field and the witness-cone fan-out still reads it, but no
 * tool turns a Daemon any more — this stands in for the retired `face` tool
 * when a test needs to arrange an observer's cone.
 */
function withFacing(
	game: GameState,
	aiId: AiId,
	facing: CardinalDirection,
): GameState {
	const spatial = game.personaSpatial[aiId];
	if (!spatial) throw new Error(`No spatial state for ${aiId}`);
	return {
		...game,
		personaSpatial: {
			...game.personaSpatial,
			[aiId]: { ...spatial, facing },
		},
	};
}

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

const RGC_AI_STARTS: ContentPack["aiStarts"] = {
	red: { position: { row: 0, col: 0 }, facing: "north" },
	green: { position: { row: 0, col: 1 }, facing: "north" },
	cyan: { position: { row: 0, col: 2 }, facing: "north" },
};

const RGC_AI_STARTS_RED_SOUTH: ContentPack["aiStarts"] = {
	red: { position: { row: 0, col: 0 }, facing: "south" },
	green: { position: { row: 0, col: 1 }, facing: "north" },
	cyan: { position: { row: 0, col: 2 }, facing: "north" },
};

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
	return makeTestPack([flower, key, ...obstacles], {
		setting: "test setting",
		wallName: "wall",
		aiStarts: RGC_AI_STARTS,
	});
}

/** Create a game with deterministic spatial placement: red→(0,0), green→(0,1), cyan→(0,2) */
function makeGame(obstaclePositions: Array<{ row: number; col: number }> = []) {
	const pack = makePackWithEntities(
		{
			flower: { row: 0, col: 0 },
			key: "red", // held by red
		},
		obstaclePositions,
	);
	return startGame(TEST_PERSONAS, pack, { budgetPerAi: 5, rng: FIXED_RNG });
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

	it("rejects picking up an item outside interaction range", () => {
		const game = makeGame();
		// flower is at (0,0); cyan is at (0,2) — two cells west, visible but
		// outside the own-cell-plus-eight-neighbours range.
		const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
		const result = validateToolCall(game, "cyan", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toBeDefined();
	});

	it("allows picking up an item one step away, whatever the facing", () => {
		const game = makeGame();
		// flower is at (0,0); green is at (0,1) facing north — west of green,
		// so the retired front arc excluded it and the interaction range includes it.
		const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
		expect(validateToolCall(game, "green", call).valid).toBe(true);
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

	it("allows go in a valid cardinal direction", () => {
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

	it("rejects every retired relative `go` argument supplied as a raw tool call", () => {
		const game = makeGame();
		// These bypass the tool enum (and `go`'s cardinal-only direction enum)
		// exactly as a hand-supplied raw tool call would.
		for (const direction of ["forward", "back", "left", "right"]) {
			const result = validateToolCall(
				game,
				"red",
				rawToolCall("go", { direction }),
			);
			expect(result.valid, `relative direction "${direction}"`).toBe(false);
			expect(result.reason, `relative direction "${direction}"`).toMatch(
				/north, south, east, or west/i,
			);
		}
	});

	it("rejects a manually supplied `face` tool call as an unknown tool", () => {
		const game = makeGame();
		// `face` is no longer in `ToolName`; a raw call can still carry the name.
		const call = rawToolCall("face", { direction: "right" });
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/unknown tool/i);
		expect(result.reason).toContain("face");
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

	it("use on ground item in own cell returns friendlier message suggesting pick_up", () => {
		const game = makeGame();
		// flower is on the ground in red's own cell (0,0)
		const call: ToolCall = { name: "use", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/on the ground/);
		expect(result.reason).toMatch(/pick_up/i);
	});

	it("use on ground item in interaction range (one step ahead) returns friendlier message", () => {
		// Place a ground item at (1,0); red faces south from (0,0)
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 1, col: 0 })],
			{
				setting: "test",
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const call: ToolCall = { name: "use", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/on the ground/);
		expect(result.reason).toMatch(/pick_up/i);
	});

	it("use on ground item at distance 2 (outside interaction range) returns generic message", () => {
		// Place a ground item at (2,0); red faces south from (0,0).
		// Offset (2,0) is visible in the Vista but outside interaction range,
		// so `use` must not advise pick_up.
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 2, col: 0 })],
			{
				setting: "test",
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const call: ToolCall = { name: "use", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toContain("You are not holding");
	});

	it("use on item held by another AI retains generic not-holding message", () => {
		const game = makeGame();
		// key is held by red (a string AiId, not a GridPosition)
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const result = validateToolCall(game, "green", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toContain("You are not holding");
	});

	it("use on ground item outside the cone retains generic not-holding message", () => {
		// Place flower at (4,4). Red faces south from (0,0) — cone only covers
		// rows 0-2, cols -2..2. (4,4) is far outside.
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 4, col: 4 })],
			{
				setting: "test",
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const call: ToolCall = { name: "use", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toContain("You are not holding");
	});
});

describe("executeToolCall — use placement within interaction range", () => {
	it("use: places the item on the paired space's cell when the space is in the actor's own cell or adjacent", () => {
		// red at (0,0) facing south; pedestal at (1,0) = one step away
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
		const pack = makeTestPack([gem, pedestal], {
			setting: "test",
			wallName: "wall",
			aiStarts: RGC_AI_STARTS_RED_SOUTH,
		});
		const game = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: FIXED_RNG,
		});
		const call: ToolCall = { name: "use", args: { item: "gem" } };
		const updated = executeToolCall(game, "red", call);
		const item = updated.world.entities.find((e) => e.id === "gem");
		// gem should now be at pedestal's cell (1,0)
		expect(item?.holder).toEqual({ row: 1, col: 0 });
	});

	it("use: places the item when the paired space is diagonal and behind the actor", () => {
		// red at (0,0) facing south; pedestal at (1,1) = diagonal south-east
		// (retired front arc: directly in front, left, right only)
		const gem: WorldEntity = {
			id: "gem",
			kind: "objective_object",
			name: "Gem",
			examineDescription: "A shiny gem. It belongs on the pedestal.",
			holder: "red",
			pairsWithSpaceId: "pedestal",
			useOutcome: "You hold the gem up.",
		};
		const pedestal: WorldEntity = {
			id: "pedestal",
			kind: "objective_space",
			name: "Pedestal",
			examineDescription: "A stone pedestal.",
			holder: { row: 1, col: 1 },
		};
		const pack = makeTestPack([gem, pedestal], {
			setting: "test",
			wallName: "wall",
			aiStarts: RGC_AI_STARTS_RED_SOUTH,
		});
		const game = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: FIXED_RNG,
		});
		const updated = executeToolCall(game, "red", {
			name: "use",
			args: { item: "gem" },
		});
		const item = updated.world.entities.find((e) => e.id === "gem");
		expect(item?.holder).toEqual({ row: 1, col: 1 });
	});

	it("use: leaves the item held when the paired space is outside interaction range", () => {
		// red at (2,2) facing north; pedestal at offset (2,0) = (2,4), two
		// cardinal steps east — visible but out of reach.
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
			holder: { row: 2, col: 4 },
		};
		const pack = makeTestPack([gem, pedestal], {
			setting: "test",
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 2 }, facing: "north" },
				green: { position: { row: 0, col: 0 }, facing: "north" },
				cyan: { position: { row: 4, col: 4 }, facing: "north" },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: FIXED_RNG,
		});
		const call: ToolCall = { name: "use", args: { item: "gem" } };
		const updated = executeToolCall(game, "red", call);
		const item = updated.world.entities.find((e) => e.id === "gem");
		// gem should still be held by red (no placement)
		expect(item?.holder).toBe("red");
	});
});

describe("executeToolCall", () => {
	it("moves item from cell to AI holder on pick_up", () => {
		const game = makeGame();
		const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
		const updated = executeToolCall(game, "red", call);
		const item = updated.world.entities.find((e) => e.id === "flower");
		expect(item?.holder).toBe("red");
	});

	it("moves item from AI to actor's cell on put_down", () => {
		const game = makeGame();
		// red at (0,0), key held by red
		const call: ToolCall = { name: "put_down", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const item = updated.world.entities.find((e) => e.id === "key");
		expect(item?.holder).toEqual({ row: 0, col: 0 });
	});

	it("does not mutate world on use when not on paired objective space", () => {
		const game = makeGame();
		const before = JSON.stringify(game.world);
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const after = JSON.stringify(updated.world);
		expect(after).toBe(before);
	});

	it("updates position and facing on go", () => {
		const game = makeGame();
		// red at (0,0); go south → (1,0), facing tracked as the direction walked
		const call: ToolCall = { name: "go", args: { direction: "south" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = updated.personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
		expect(spatial?.facing).toBe("south");
	});

	// ── Cardinal direction dispatch (ADR 0015: cardinal-only movement) ────────
	// red starts at (0,0) facing north (via FIXED_RNG).

	it("go south moves to (1,0)", () => {
		const game = makeGame();
		const call: ToolCall = { name: "go", args: { direction: "south" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = updated.personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
		expect(spatial?.facing).toBe("south");
	});

	it("go east moves to (0,1)", () => {
		const game = makeGame();
		const call: ToolCall = { name: "go", args: { direction: "east" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = updated.personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 0, col: 1 });
		expect(spatial?.facing).toBe("east");
	});

	it("go west from (0,0) is rejected (out of bounds at col -1)", () => {
		const game = makeGame();
		const result = validateToolCall(game, "red", {
			name: "go",
			args: { direction: "west" },
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/out of bounds/i);
	});

	it("a retired relative go argument never moves the actor", () => {
		for (const direction of ["forward", "back", "left", "right"]) {
			const game = makeGame();
			const result = dispatchAiTurn(game, {
				aiId: "red",
				toolCall: rawToolCall("go", { direction }),
			});
			expect(result.records[0]?.kind).toBe("tool_failure");
			expect(result.game.personaSpatial.red?.position).toEqual({
				row: 0,
				col: 0,
			});
		}
	});

	it("go south via dispatchAiTurn leaves red at (1,0)", () => {
		// Verifies the cardinal direction is applied to spatial state.
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "go", args: { direction: "south" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		const spatial = result.game.personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
		expect(spatial?.facing).toBe("south");
	});
});

describe("dispatchAiTurn", () => {
	it("rejects a turn from a locked-out AI", () => {
		let game = startGame(
			TEST_PERSONAS,
			makePackWithEntities({ flower: { row: 0, col: 0 }, key: "red" }),
			{ budgetPerAi: 0.01, rng: FIXED_RNG },
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
		expect(result.game.budgets.red?.remaining).toBeCloseTo(4, 10);
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
		const key = result.game.world.entities.find((e) => e.id === "key");
		expect(key?.holder).toBe("red");
		// action-failure entry added to actor's log
		const greenLog = result.game.conversationLogs.green ?? [];
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
		const flower = result.game.world.entities.find((e) => e.id === "flower");
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
		// cyan is at (0,2); flower is at (0,0) — two cells away, out of range
		const action: AiTurnAction = {
			aiId: "cyan",
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
		const spatial = result.game.personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
		expect(spatial?.facing).toBe("south");
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
		const beforeEntities = JSON.stringify(game.world.entities);
		const afterEntities = JSON.stringify(result.game.world.entities);
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
		const redLog = result.game.conversationLogs.red ?? [];
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
		const phase = result.game;
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
			expect(result.game.conversationLogs[aiId]).toHaveLength(0);
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
		const pack = makeTestPack([gemObject, altarSpace], {
			setting: "test",
			wallName: "wall",
			aiStarts: RGC_AI_STARTS,
		});
		const game = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: FIXED_RNG,
		});

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
		const pack = makeTestPack([gemObject, altarSpace], {
			setting: "test",
			wallName: "wall",
			aiStarts: RGC_AI_STARTS,
		});
		const game = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: FIXED_RNG,
		});

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
	// write-time Vista fan-out + per-Daemon whispers (issue #195, AC 12 & AC 13)
	// -------------------------------------------------------------------------

	it("AC 12: actor's own pick_up does NOT append witnessed-event to actor's log; in-Vista witness receives one", () => {
		/**
		 * Fixture (mirrors conversation-log-integration.test.ts):
		 *   - red at (2,0) — picks up flower (facing no longer gates witnesses)
		 *   - green at (0,0) — Vista offset of (2,0) is (0,2): 0² + 2² = 4 ≤ 4 ← in Vista
		 *   - cyan at (0,2) — Vista offset of (2,0) is (2,2): 2² + 2² = 8 > 4 — NOT in Vista
		 */
		const flower = makeEntity("flower", "interesting_object", {
			row: 2,
			col: 0,
		});
		const packWithVista = makeTestPack([flower], {
			setting: "Vista test",
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 0 }, facing: "south" },
				green: { position: { row: 0, col: 0 }, facing: "south" },
				cyan: { position: { row: 0, col: 2 }, facing: "south" },
			},
		});
		const vistaGame = startGame(TEST_PERSONAS, packWithVista, {
			budgetPerAi: 5,
			rng: FIXED_RNG,
		});

		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "flower" } },
		};
		const result = dispatchAiTurn(vistaGame, action);
		const phase = result.game;

		// Actor (red) must NOT have any witnessed-event in their own log
		const redWitnessed = (phase.conversationLogs.red ?? []).filter(
			(e) => e.kind === "witnessed-event",
		);
		expect(redWitnessed).toHaveLength(0);

		// green's Vista at (0,0) contains (2,0) — two cells north
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
		const redLog = result.game.conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" && e.content.includes("I'll grab the flower"),
			),
		).toBe(true);

		// World state must reflect the pick_up
		const flower = result.game.world.entities.find((e) => e.id === "flower");
		expect(flower?.holder).toBe("red");
	});

	// ── action-failure log entries (issue #287) ───────────────────────────────

	it("go against a wall produces one action-failure entry in actor's log; peers untouched", () => {
		const game = makeGame([{ row: 1, col: 0 }]);
		// red at (0,0); obstacle at (1,0); go south → blocked
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "go", args: { direction: "south" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_failure");

		const phase = result.game;
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

	it("failed message (invalid recipient) produces NO action-failure entry", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			messages: [{ to: "nobody", content: "Hello?" }],
		};
		const result = dispatchAiTurn(game, action);
		expect(result.records[0]?.kind).toBe("tool_failure");

		// No action-failure entries in any log
		const phase = result.game;
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
		const redLog = result.game.conversationLogs.red ?? [];
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
		return { ...game, objectives: [useItemObj] };
	}

	it("flips the UseItemObjective satisfactionState to 'satisfied' on use", () => {
		const game = makeGameWithUseItemObjective();
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const obj = updated.objectives[0];
		expect(obj?.satisfactionState).toBe("satisfied");
	});

	it("flips the entity's satisfactionState to 'satisfied' on use", () => {
		const game = makeGameWithUseItemObjective();
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const entity = updated.world.entities.find((e) => e.id === "key");
		expect(entity?.satisfactionState).toBe("satisfied");
	});

	it("does not flip if there is no matching pending UseItemObjective", () => {
		const game = makeGame(); // no use_item objectives
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const entity = updated.world.entities.find((e) => e.id === "key");
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
		const gameWithObj = { ...game, objectives: [useItemObj] };
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(gameWithObj, "red", call);
		// Objective was already satisfied; no pending obj found → should still be satisfied (unchanged)
		const obj = updated.objectives[0];
		expect(obj?.satisfactionState).toBe("satisfied");
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
	const pack = makeTestPack([obj, space], {
		setting: "test",
		wallName: "wall",
		aiStarts: {
			red: { position: actorPos, facing: actorFacing },
			green: { position: { row: 0, col: 0 }, facing: "north" },
			cyan: { position: { row: 4, col: 4 }, facing: "north" },
		},
	});
	const started = startGame(TEST_PERSONAS, pack, {
		budgetPerAi: 5,
		rng: () => 0,
	});
	// Override objectives to include our UseSpaceObjective
	return { ...started, objectives: [spaceObjective] };
}

describe("executeToolCall — use on objective_space", () => {
	it("flips pending UseSpaceObjective to satisfied when space is within interaction range", () => {
		const game = makeGameWithSpaceObjective();
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const updated = executeToolCall(game, "red", call);
		const objective = updated.objectives.find((o) => o.id === "obj-0");
		expect(objective?.satisfactionState).toBe("satisfied");
	});

	it("flips pending UseSpaceObjective to satisfied when space is in actor's own cell", () => {
		// red at (2,2), space at (2,2) (own cell)
		const game = makeGameWithSpaceObjective({ row: 2, col: 2 }, "south", {
			row: 2,
			col: 2,
		});
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
	it("accepts use on a space one step away (own cell plus eight neighbours)", () => {
		const game = makeGameWithSpaceObjective();
		// red at (2,2) facing south; shrine at (3,2) = directly south
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("accepts use on a diagonal space and on a space behind the actor", () => {
		// red at (2,2) facing south; (1,1) and (1,2) are diagonal/behind
		for (const spacePos of [
			{ row: 1, col: 1 },
			{ row: 1, col: 2 },
			{ row: 1, col: 3 },
			{ row: 3, col: 3 },
		]) {
			const game = makeGameWithSpaceObjective(
				{ row: 2, col: 2 },
				"south",
				spacePos,
			);
			const result = validateToolCall(game, "red", {
				name: "use",
				args: { item: "shrine" },
			});
			expect(result.valid).toBe(true);
		}
	});

	it("accepts use on a space in the actor's own cell", () => {
		const game = makeGameWithSpaceObjective({ row: 2, col: 2 }, "south", {
			row: 2,
			col: 2,
		});
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects use on a space at offset (2,0) — in the Vista, outside interaction range", () => {
		// red at (2,2) facing south; shrine at (4,2) = 2 cells south
		const game = makeGameWithSpaceObjective({ row: 2, col: 2 }, "south", {
			row: 4,
			col: 2,
		});
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/out of reach/i);
	});

	it("rejects use on a space at offset (2,1) — outside the Vista too", () => {
		// red at (2,2) facing south; shrine at (1,4) = two steps east, one north
		const game = makeGameWithSpaceObjective({ row: 2, col: 2 }, "south", {
			row: 1,
			col: 4,
		});
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/out of reach/i);
	});

	it("rejects second use when useAvailable is false", () => {
		const game = makeGameWithSpaceObjective();
		// First use
		const afterUse = executeToolCall(game, "red", {
			name: "use",
			args: { item: "shrine" },
		});
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
		const pack = makeTestPack([obj, space], {
			setting: "test",
			wallName: "wall",
			aiStarts: {
				// red at (2,2) facing south
				red: { position: { row: 2, col: 2 }, facing: "south" },
				// green at (2,0) facing east — cone goes east, so (2,1), (2,2) in arc
				green: { position: { row: 2, col: 0 }, facing: "east" },
				cyan: { position: { row: 4, col: 4 }, facing: "north" },
			},
		});
		const started = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: () => 0,
		});
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

// ── UseItem activationFlavor on interesting_object (issue #334) ────────────────

describe("dispatchAiTurn — UseItemObjective activationFlavor on interesting_object", () => {
	/** Build a game where red holds 'key' (interesting_object) with activation
	 * flavor configured, plus a pending UseItemObjective targeting 'key'. */
	function makeGameWithUseItemActivation() {
		const game = makeGame();
		const withItemFlavors = {
			...game,
			world: {
				...game.world,
				entities: game.world.entities.map((e) =>
					e.id === "key"
						? {
								...e,
								useOutcome: "The key sits inert in your palm.",
								activationFlavor:
									"The key flares briefly with a steady amber light as something in the wall clicks.",
								postExamineDescription:
									"The key has dimmed; whatever it was for is finished.",
								postLookFlavor: "the spent key gives off a faint warmth",
							}
						: e,
				),
			},
		};
		const useItemObj: UseItemObjective = {
			id: "obj-0",
			kind: "use_item",
			description: "Use the key",
			satisfactionState: "pending",
			itemId: "key",
		};
		return { ...withItemFlavors, objectives: [useItemObj] };
	}

	it("returns activationFlavor as the actor's tool-success description on the satisfying use", () => {
		const game = makeGameWithUseItemActivation();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		const success = result.records.find((r) => r.kind === "tool_success");
		expect(success?.description).toBe(
			"The key flares briefly with a steady amber light as something in the wall clicks.",
		);
	});

	it("falls back to useOutcome on a subsequent use after the objective is already satisfied", () => {
		const game = makeGameWithUseItemActivation();
		// First use — satisfies and emits activationFlavor.
		const after = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		});
		expect(after.rejected).toBe(false);
		// Second use — should fall back to useOutcome.
		const second = dispatchAiTurn(after.game, {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		});
		const success = second.records.find((r) => r.kind === "tool_success");
		expect(success?.description).toBe("The key sits inert in your palm.");
	});

	it("does not emit activationFlavor when there is no pending UseItemObjective", () => {
		// No use_item objective wired up.
		const base = makeGame();
		const game = {
			...base,
			world: {
				...base.world,
				entities: base.world.entities.map((e) =>
					e.id === "key"
						? {
								...e,
								useOutcome: "You weigh the key in your hand.",
								activationFlavor:
									"The key flares briefly with a steady amber light.",
							}
						: e,
				),
			},
		};
		const result = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		});
		const success = result.records.find((r) => r.kind === "tool_success");
		// Should fall back to useOutcome — activation only fires when a
		// UseItemObjective transitions from pending → satisfied.
		expect(success?.description).toBe("You weigh the key in your hand.");
	});

	it("fans out activationFlavor as the witnessed-event useOutcome on the satisfying call", () => {
		// red at (0,0) facing east; green at (0,1) facing west — green's cone
		// (facing west from (0,1)) covers (0,0), so green witnesses the use.
		const game = withFacing(
			withFacing(makeGameWithUseItemActivation(), "red", "east"),
			"green",
			"west",
		);
		const result = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		});
		expect(result.rejected).toBe(false);
		const greenLog = result.game.conversationLogs.green ?? [];
		const useEvent = greenLog.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "use",
		);
		expect(useEvent).toBeDefined();
		if (useEvent?.kind === "witnessed-event") {
			expect(useEvent.useOutcome).toBe(
				"The key flares briefly with a steady amber light as something in the wall clicks.",
			);
		}
	});

	it("fans out useOutcome to witnesses on a post-satisfaction subsequent use", () => {
		const game = withFacing(makeGameWithUseItemActivation(), "green", "west");
		// First use satisfies + emits activationFlavor.
		const after = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		});
		// Second use — witness should see useOutcome.
		const second = dispatchAiTurn(after.game, {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		});
		const greenLog = second.game.conversationLogs.green ?? [];
		const useEvents = greenLog.filter(
			(e) => e.kind === "witnessed-event" && e.actionKind === "use",
		);
		// Last event should carry useOutcome, not activationFlavor.
		const last = useEvents[useEvents.length - 1];
		if (last?.kind === "witnessed-event") {
			expect(last.useOutcome).toBe("The key sits inert in your palm.");
		}
	});
});

// ── UseSpace: actor receives activationFlavor on satisfying call (issue #335) ─

describe("dispatchAiTurn — use on objective_space surfaces activationFlavor to actor", () => {
	it("uses activationFlavor as the tool_success description for the actor on the satisfying call", () => {
		const game = makeGameWithSpaceObjective(
			{ row: 2, col: 2 },
			"south",
			{ row: 3, col: 2 },
			{
				activationFlavor:
					"The pedestal's runes ignite and a slow warmth fills the alcove.",
			},
		);
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "use", args: { item: "shrine" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		const successRecord = result.records.find((r) => r.kind === "tool_success");
		expect(successRecord?.description).toBe(
			"The pedestal's runes ignite and a slow warmth fills the alcove.",
		);
	});

	it("falls back to useOutcome when activationFlavor is absent (backward compat with pre-#335 saves)", () => {
		// Default fixture has useOutcome but no activationFlavor — exercises the
		// fallback branch.
		const game = makeGameWithSpaceObjective({ row: 2, col: 2 }, "south", {
			row: 3,
			col: 2,
		});
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "use", args: { item: "shrine" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		const successRecord = result.records.find((r) => r.kind === "tool_success");
		expect(successRecord?.description).toBe(
			"A warm glow emanates from the shrine.",
		);
	});

	it("still emits satisfactionFlavor to witnesses when activationFlavor is set (no regression)", () => {
		// Witness setup mirrors the existing satisfactionFlavor test.
		const space: WorldEntity = {
			id: "shrine",
			kind: "objective_space",
			name: "Shrine",
			examineDescription:
				"A shrine. Press your hand to the basin to activate it.",
			holder: { row: 3, col: 2 },
			useAvailable: true,
			activationFlavor: "The basin floods with light beneath your palm.",
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
		const pack = makeTestPack([obj, space], {
			setting: "test",
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 2 }, facing: "south" },
				green: { position: { row: 2, col: 0 }, facing: "east" },
				cyan: { position: { row: 4, col: 4 }, facing: "north" },
			},
		});
		const started = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const withObjective = { ...started, objectives: [spaceObjective] };

		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "use", args: { item: "shrine" } },
		};
		const result = dispatchAiTurn(withObjective, action);
		expect(result.rejected).toBe(false);

		// Actor's tool_success carries activationFlavor.
		const successRecord = result.records.find((r) => r.kind === "tool_success");
		expect(successRecord?.description).toBe(
			"The basin floods with light beneath your palm.",
		);

		// Witness still receives satisfactionFlavor on the use witnessed-event.
		const greenLog = result.game.conversationLogs.green ?? [];
		const useEvent = greenLog.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "use",
		);
		expect(useEvent).toBeDefined();
		if (useEvent?.kind === "witnessed-event") {
			expect(useEvent.useOutcome).toBe("The shrine pulses with light.");
		}
	});
});

// ── cone-delta on dispatcher result (issue #376) ──────────────────────────────
describe("dispatchAiTurn — cone-delta computation (issue #376)", () => {
	it("go action that reveals a stationary actor sets actorConeDelta on DispatchResult", () => {
		// Setup: red at (2,0) facing north, green at (0,1) facing south.
		// Red goes north to (1,0) — now green at (0,1) is visible (distance 1, front-right).
		const pack = makePackWithEntities(
			{
				flower: { row: 3, col: 3 },
				key: "red",
			},
			[],
		);

		const packWithCustomStarts: ContentPack = {
			...pack,
			aiStarts: {
				red: { position: { row: 2, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "south" },
				cyan: { position: { row: 5, col: 0 }, facing: "north" },
			},
		};

		const game = startGame(TEST_PERSONAS, packWithCustomStarts, {
			budgetPerAi: 5,
			rng: FIXED_RNG,
		});

		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "go", args: { direction: "north" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.actorConeDelta).toBeDefined();
		expect(result.actorConeDelta).toContain("*green");
	});

	it("a rejected raw `face` tool call sets no actorConeDelta and no success record", () => {
		const game = makeGame();

		const action: AiTurnAction = {
			aiId: "red",
			toolCall: rawToolCall("face", { direction: "back" }),
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		// Rejected, not ignored and not a no-op success.
		expect(result.records[0]?.kind).toBe("tool_failure");
		expect(result.records[0]?.description).toMatch(/unknown tool/i);
		expect(result.actorConeDelta).toBeUndefined();
		expect(result.game.personaSpatial.red?.facing).toBe("north");
		// The rejection is recorded for the actor.
		const failures = (result.game.conversationLogs.red ?? []).filter(
			(e) => e.kind === "action-failure",
		);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({ tool: "face" });
	});

	it("non-go tools never set actorConeDelta", () => {
		const game = makeGame();

		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "flower" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.actorConeDelta).toBeUndefined();
	});
});

// ── Interaction range (ADR 0015): availability, validation, effects ───────────

describe("interaction range — availability, validation, and effects agree", () => {
	/** Red at the room centre (2,2); offsets are (dx east, dy north). */
	function offsetPos(o: { dx: number; dy: number }): {
		row: number;
		col: number;
	} {
		return { row: 2 - o.dy, col: 2 + o.dx };
	}

	/** Red at (2,2) facing north; the given entities and objectives on top. */
	function makeRangeGame(
		entities: WorldEntity[],
		objectives: Objective[] = [],
	): GameState {
		const pack = makeTestPack(entities, {
			setting: "test",
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 2 }, facing: "north" },
				green: { position: { row: 0, col: 0 }, facing: "north" },
				cyan: { position: { row: 4, col: 4 }, facing: "north" },
			},
		});
		const started = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: FIXED_RNG,
		});
		return { ...started, objectives };
	}

	function makeGroundItem(offset: { dx: number; dy: number }): WorldEntity {
		return {
			id: "flower",
			kind: "interesting_object",
			name: "Flower",
			examineDescription: "A flower.",
			holder: offsetPos(offset),
			useOutcome: "You examine the flower.",
		};
	}

	function pickUpEnum(game: GameState): string[] {
		const def = availableTools(game, "red", []).find(
			(t) => t.function.name === "pick_up",
		);
		return def?.function.parameters.properties.item?.enum ?? [];
	}

	it("pick_up availability and validation agree per offset", () => {
		const cases: Array<{
			label: string;
			offset: { dx: number; dy: number };
			reachable: boolean;
		}> = [
			{ label: "(0,0) own cell", offset: { dx: 0, dy: 0 }, reachable: true },
			{ label: "(1,1) diagonal", offset: { dx: 1, dy: 1 }, reachable: true },
			{
				label: "(2,0) in the Vista",
				offset: { dx: 2, dy: 0 },
				reachable: false,
			},
			{
				label: "(2,1) outside the Vista",
				offset: { dx: 2, dy: 1 },
				reachable: false,
			},
		];

		for (const { label, offset, reachable } of cases) {
			const game = makeRangeGame([makeGroundItem(offset)]);
			const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
			const validation = validateToolCall(game, "red", call);
			expect(pickUpEnum(game).includes("flower"), label).toBe(reachable);
			expect(validation.valid, label).toBe(reachable);
		}
	});

	it("use on a ground item advises pick_up first only within interaction range", () => {
		const near = makeRangeGame([makeGroundItem({ dx: 1, dy: 1 })]);
		const nearResult = validateToolCall(near, "red", {
			name: "use",
			args: { item: "flower" },
		});
		expect(nearResult.valid).toBe(false);
		expect(nearResult.reason).toMatch(/on the ground/);
		expect(nearResult.reason).toMatch(/pick_up/i);
		// The same range gates availability, so the advice is actionable.
		expect(pickUpEnum(near)).toContain("flower");

		const far = makeRangeGame([makeGroundItem({ dx: 2, dy: 0 })]);
		const farResult = validateToolCall(far, "red", {
			name: "use",
			args: { item: "flower" },
		});
		expect(farResult.valid).toBe(false);
		expect(farResult.reason).toContain("You are not holding");
		expect(pickUpEnum(far)).not.toContain("flower");
	});

	it("the pickup-first advice does not grant ground-item use", () => {
		// Offset (-1,-1) is a diagonal behind red's north facing: in range,
		// outside the retired front arc.
		const game = makeRangeGame([makeGroundItem({ dx: -1, dy: -1 })]);
		const result = validateToolCall(game, "red", {
			name: "use",
			args: { item: "flower" },
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/pick_up/i);
		// Use-Item still requires the item to be held.
		const ground = game.world.entities.find((e) => e.id === "flower");
		expect(ground?.holder).toEqual({ row: 3, col: 1 });
	});

	it("held Carry placement uses interaction range and satisfaction still needs occupancy", () => {
		const gem: WorldEntity = {
			id: "gem",
			kind: "objective_object",
			name: "Gem",
			examineDescription: "A gem. It belongs on the pedestal.",
			holder: "red",
			pairsWithSpaceId: "pedestal",
			useOutcome: "You hold the gem up.",
		};
		const carryObjective: Objective = {
			id: "obj-carry",
			kind: "carry",
			description: "Put the gem on the pedestal",
			satisfactionState: "pending",
			objectId: "gem",
			spaceId: "pedestal",
		};

		const near = makeRangeGame(
			[
				gem,
				{
					id: "pedestal",
					kind: "objective_space",
					name: "Pedestal",
					examineDescription: "A stone pedestal.",
					holder: offsetPos({ dx: 1, dy: 1 }),
				},
			],
			[carryObjective],
		);
		const placed = executeToolCall(near, "red", {
			name: "use",
			args: { item: "gem" },
		});
		expect(placed.world.entities.find((e) => e.id === "gem")?.holder).toEqual(
			offsetPos({ dx: 1, dy: 1 }),
		);
		expect(
			isCarryObjectiveSatisfied(carryObjective as CarryObjective, placed.world),
		).toBe(true);

		const far = makeRangeGame(
			[
				gem,
				{
					id: "pedestal",
					kind: "objective_space",
					name: "Pedestal",
					examineDescription: "A stone pedestal.",
					holder: offsetPos({ dx: 2, dy: 0 }),
				},
			],
			[carryObjective],
		);
		const unplaced = executeToolCall(far, "red", {
			name: "use",
			args: { item: "gem" },
		});
		expect(unplaced.world.entities.find((e) => e.id === "gem")?.holder).toBe(
			"red",
		);
		// Satisfaction is unchanged: holding the item is not occupying its space.
		expect(
			isCarryObjectiveSatisfied(
				carryObjective as CarryObjective,
				unplaced.world,
			),
		).toBe(false);
	});

	it("Use-Item satisfaction is unchanged: use still requires holding the item", () => {
		const held: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "Switch",
			examineDescription: "A brass switch.",
			holder: "red",
			useOutcome: "You toggle the switch.",
			activationFlavor: "The switch clicks.",
		};
		const useItemObjective: Objective = {
			id: "obj-item",
			kind: "use_item",
			description: "Use the switch",
			satisfactionState: "pending",
			itemId: "switch",
		};

		const game = makeRangeGame([held], [useItemObjective]);
		const updated = executeToolCall(game, "red", {
			name: "use",
			args: { item: "switch" },
		});
		const satisfied = updated.objectives.find((o) => o.id === "obj-item");
		expect(
			satisfied?.kind === "use_item" && isUseItemObjectiveSatisfied(satisfied),
		).toBe(true);
	});

	it("Convergence satisfaction is unchanged: sharing the cell satisfies, proximity does not", () => {
		const space: WorldEntity = {
			id: "gathering",
			kind: "objective_space",
			name: "Gathering Place",
			examineDescription: "A gathering point.",
			holder: offsetPos({ dx: 0, dy: 0 }),
		};
		const convergence: Objective = {
			id: "obj-conv",
			kind: "convergence",
			description: "Converge",
			satisfactionState: "pending",
			spaceId: "gathering",
		};
		const game = makeRangeGame([space], [convergence]);

		/** Move green to a cell without disturbing its facing. */
		function withGreenAt(
			state: GameState,
			pos: { row: number; col: number },
		): GameState {
			return {
				...state,
				personaSpatial: {
					...state.personaSpatial,
					green: {
						facing: state.personaSpatial.green?.facing ?? "north",
						position: pos,
					},
				},
			};
		}

		// Green is one diagonal step away — within interaction range, but
		// Convergence still only counts co-occupancy.
		const adjacent = withGreenAt(game, offsetPos({ dx: 1, dy: 1 }));
		expect(
			checkConvergenceTier(
				convergence as ConvergenceObjective,
				adjacent.world,
				adjacent.personaSpatial,
			).tier,
		).toBe(1);

		const shared = withGreenAt(game, offsetPos({ dx: 0, dy: 0 }));
		expect(
			checkConvergenceTier(
				convergence as ConvergenceObjective,
				shared.world,
				shared.personaSpatial,
			).tier,
		).toBe(2);
	});
});
