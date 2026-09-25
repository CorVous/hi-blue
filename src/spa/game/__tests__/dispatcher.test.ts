import { describe, expect, it } from "vitest";
import { availableTools } from "../available-tools";
import {
	dispatchAiTurn,
	executeToolCall,
	validateToolCall,
} from "../dispatcher";
import { deductBudget, startGame } from "../engine";
import type {
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

const FIXED_RNG = () => 0;

function rawToolCall(name: string, args: Record<string, string>): ToolCall {
	return { name, args } as unknown as ToolCall;
}

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
	red: { position: { row: 0, col: 0 } },
	green: { position: { row: 0, col: 1 } },
	cyan: { position: { row: 0, col: 2 } },
};

const RGC_AI_STARTS_RED_SOUTH: ContentPack["aiStarts"] = {
	red: { position: { row: 0, col: 0 } },
	green: { position: { row: 0, col: 1 } },
	cyan: { position: { row: 0, col: 2 } },
};

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

function makeGame(obstaclePositions: Array<{ row: number; col: number }> = []) {
	const pack = makePackWithEntities(
		{
			flower: { row: 0, col: 0 },
			key: "red",
		},
		obstaclePositions,
	);
	return startGame(TEST_PERSONAS, pack, { budgetPerAi: 5, rng: FIXED_RNG });
}

describe("validateToolCall", () => {
	it("allows picking up an item in the actor's current cell", () => {
		const game = makeGame();
		const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects picking up an item held by another AI", () => {
		const game = makeGame();
		const call: ToolCall = { name: "pick_up", args: { item: "key" } };
		const result = validateToolCall(game, "green", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toBeDefined();
	});

	it("rejects picking up an item outside interaction range", () => {
		const game = makeGame();
		const call: ToolCall = { name: "pick_up", args: { item: "flower" } };
		const result = validateToolCall(game, "cyan", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toBeDefined();
	});

	it("allows picking up an item one step away, whatever the approach", () => {
		const game = makeGame();
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
		const call: ToolCall = { name: "go", args: { direction: "south" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects go out of bounds", () => {
		const game = makeGame();
		const call: ToolCall = { name: "go", args: { direction: "north" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/out of bounds/i);
	});

	it("rejects go into an obstacle cell", () => {
		const game = makeGame([{ row: 1, col: 0 }]);
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
		const call = rawToolCall("face", { direction: "right" });
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/unknown tool/i);
		expect(result.reason).toContain("face");
	});

	it("allows use of an item held by the AI", () => {
		const game = makeGame();
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects use of an item not held by the AI", () => {
		const game = makeGame();
		const call: ToolCall = { name: "use", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
	});

	it("use on ground item in own cell returns friendlier message suggesting pick_up", () => {
		const game = makeGame();
		const call: ToolCall = { name: "use", args: { item: "flower" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/on the ground/);
		expect(result.reason).toMatch(/pick_up/i);
	});

	it("use on ground item in interaction range (one step ahead) returns friendlier message", () => {
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 1, col: 0 })],
			{
				setting: "test",
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
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
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 2, col: 0 })],
			{
				setting: "test",
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
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
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const result = validateToolCall(game, "green", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toContain("You are not holding");
	});

	it("use on a ground item out of reach retains the generic not-holding message", () => {
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 4, col: 4 })],
			{
				setting: "test",
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
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
		expect(item?.holder).toEqual({ row: 1, col: 0 });
	});

	it("use: places the item when the paired space is diagonal and behind the actor", () => {
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
				red: { position: { row: 2, col: 2 } },
				green: { position: { row: 0, col: 0 } },
				cyan: { position: { row: 4, col: 4 } },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: FIXED_RNG,
		});
		const call: ToolCall = { name: "use", args: { item: "gem" } };
		const updated = executeToolCall(game, "red", call);
		const item = updated.world.entities.find((e) => e.id === "gem");
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

	it("updates position and nothing else on go", () => {
		const game = makeGame();
		const call: ToolCall = { name: "go", args: { direction: "south" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = updated.personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
	});

	it("go south moves to (1,0)", () => {
		const game = makeGame();
		const call: ToolCall = { name: "go", args: { direction: "south" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = updated.personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
	});

	it("go east moves to (0,1)", () => {
		const game = makeGame();
		const call: ToolCall = { name: "go", args: { direction: "east" } };
		const updated = executeToolCall(game, "red", call);
		const spatial = updated.personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 0, col: 1 });
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
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "go", args: { direction: "south" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		const spatial = result.game.personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
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
		const action: AiTurnAction = {
			aiId: "green",
			toolCall: { name: "pick_up", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_failure");
		const key = result.game.world.entities.find((e) => e.id === "key");
		expect(key?.holder).toBe("red");
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
		expect(result.records[0]?.kind).toBe("tool_success");
		expect(result.records[0]?.description).toMatch(/picked up the flower/);
		expect(result.actorPrivateToolResult).toBeDefined();
		expect(result.actorPrivateToolResult?.success).toBe(true);
		expect(result.actorPrivateToolResult?.description).toMatch(
			/picked up the flower/,
		);
		expect(result.actorPrivateToolResult?.description).toMatch(/A flower\./);
	});

	it("failed pick_up does not produce an auto-examine private result", () => {
		const game = makeGame();
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
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "go", args: { direction: "south" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_success");
		const spatial = result.game.personaSpatial.red;
		expect(spatial?.position).toEqual({ row: 1, col: 0 });
	});

	it("use returns tool_success with entity's useOutcome as description when not on paired space", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_success");
		expect(result.records[0]?.description).toBe("You used the key.");
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
		for (const aiId of ["red", "green", "cyan"]) {
			expect(result.game.conversationLogs[aiId]).toHaveLength(0);
		}
	});

	it("put_down of objective_object on its matching space yields placementFlavor as description", () => {
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
			holder: { row: 0, col: 0 },
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
		expect(result.records[0]?.description).toBe(
			"you places the gem on the altar.",
		);
	});

	it("put_down of objective_object on a non-matching cell yields default description", () => {
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
			holder: { row: 3, col: 3 },
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
		expect(result.records[0]?.description).toMatch(/put down/i);
		expect(result.records[0]?.description).not.toContain(
			"places the gem on the altar",
		);
	});

	it("AC 12: actor's own pick_up does NOT append witnessed-event to actor's log; in-Vista witness receives one", () => {
		const flower = makeEntity("flower", "interesting_object", {
			row: 2,
			col: 0,
		});
		const packWithVista = makeTestPack([flower], {
			setting: "Vista test",
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 0 } },
				green: { position: { row: 0, col: 0 } },
				cyan: { position: { row: 0, col: 2 } },
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

		const redWitnessed = (phase.conversationLogs.red ?? []).filter(
			(e) => e.kind === "witnessed-event",
		);
		expect(redWitnessed).toHaveLength(0);

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

	it("both message + toolCall populated: message record appears before tool_success record in result.records", () => {
		const game = makeGame();
		const action: AiTurnAction = {
			aiId: "red",
			messages: [{ to: "blue", content: "I'll grab the flower" }],
			toolCall: { name: "pick_up", args: { item: "flower" } },
		};
		const result = dispatchAiTurn(game, action);

		expect(result.rejected).toBe(false);
		expect(result.records).toHaveLength(2);
		expect(result.records[0]?.kind).toBe("message");
		expect(result.records[1]?.kind).toBe("tool_success");

		const redLog = result.game.conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" && e.content.includes("I'll grab the flower"),
			),
		).toBe(true);

		const flower = result.game.world.entities.find((e) => e.id === "flower");
		expect(flower?.holder).toBe("red");
	});

	it("go against a wall produces one action-failure entry in actor's log; peers untouched", () => {
		const game = makeGame([{ row: 1, col: 0 }]);
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

describe("executeToolCall — UseItemObjective", () => {
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
		const game = makeGame();
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(game, "red", call);
		const entity = updated.world.entities.find((e) => e.id === "key");
		expect(entity?.satisfactionState).toBeUndefined();
	});

	it("does not flip an already-satisfied UseItemObjective", () => {
		const game = makeGame();
		const useItemObj: UseItemObjective = {
			id: "obj-0",
			kind: "use_item",
			description: "Use the key",
			satisfactionState: "satisfied",
			itemId: "key",
		};
		const gameWithObj = { ...game, objectives: [useItemObj] };
		const call: ToolCall = { name: "use", args: { item: "key" } };
		const updated = executeToolCall(gameWithObj, "red", call);
		const obj = updated.objectives[0];
		expect(obj?.satisfactionState).toBe("satisfied");
	});
});

function makeGameWithSpaceObjective(
	actorPos: { row: number; col: number } = { row: 2, col: 2 },
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
			red: { position: actorPos },
			green: { position: { row: 0, col: 0 } },
			cyan: { position: { row: 4, col: 4 } },
		},
	});
	const started = startGame(TEST_PERSONAS, pack, {
		budgetPerAi: 5,
		rng: () => 0,
	});
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
		const game = makeGameWithSpaceObjective(
			{ row: 2, col: 2 },
			{
				row: 2,
				col: 2,
			},
		);
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
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("accepts use on a diagonal space and on a space behind the actor", () => {
		for (const spacePos of [
			{ row: 1, col: 1 },
			{ row: 1, col: 2 },
			{ row: 1, col: 3 },
			{ row: 3, col: 3 },
		]) {
			const game = makeGameWithSpaceObjective({ row: 2, col: 2 }, spacePos);
			const result = validateToolCall(game, "red", {
				name: "use",
				args: { item: "shrine" },
			});
			expect(result.valid).toBe(true);
		}
	});

	it("accepts use on a space in the actor's own cell", () => {
		const game = makeGameWithSpaceObjective(
			{ row: 2, col: 2 },
			{
				row: 2,
				col: 2,
			},
		);
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(true);
	});

	it("rejects use on a space at offset (2,0) — in the Vista, outside interaction range", () => {
		const game = makeGameWithSpaceObjective(
			{ row: 2, col: 2 },
			{
				row: 4,
				col: 2,
			},
		);
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/out of reach/i);
	});

	it("rejects use on a space at offset (2,1) — outside the Vista too", () => {
		const game = makeGameWithSpaceObjective(
			{ row: 2, col: 2 },
			{
				row: 1,
				col: 4,
			},
		);
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(game, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/out of reach/i);
	});

	it("rejects second use when useAvailable is false", () => {
		const game = makeGameWithSpaceObjective();
		const afterUse = executeToolCall(game, "red", {
			name: "use",
			args: { item: "shrine" },
		});
		const call: ToolCall = { name: "use", args: { item: "shrine" } };
		const result = validateToolCall(afterUse, "red", call);
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/already been used/i);
	});
});

describe("dispatchAiTurn — use on objective_space witnesses satisfactionFlavor", () => {
	it("emits witnessed event with satisfactionFlavor to a witness whose Vista contains the actor's cell", () => {
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
				red: { position: { row: 2, col: 2 } },
				green: { position: { row: 2, col: 0 } },
				cyan: { position: { row: 4, col: 4 } },
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

describe("dispatchAiTurn — UseItemObjective activationFlavor on interesting_object", () => {
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
		const after = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		});
		expect(after.rejected).toBe(false);
		const second = dispatchAiTurn(after.game, {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		});
		const success = second.records.find((r) => r.kind === "tool_success");
		expect(success?.description).toBe("The key sits inert in your palm.");
	});

	it("does not emit activationFlavor when there is no pending UseItemObjective", () => {
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
		expect(success?.description).toBe("You weigh the key in your hand.");
	});

	it("fans out activationFlavor as the witnessed-event useOutcome on the satisfying call", () => {
		const game = makeGameWithUseItemActivation();
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
		const game = makeGameWithUseItemActivation();
		const after = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		});
		const second = dispatchAiTurn(after.game, {
			aiId: "red",
			toolCall: { name: "use", args: { item: "key" } },
		});
		const greenLog = second.game.conversationLogs.green ?? [];
		const useEvents = greenLog.filter(
			(e) => e.kind === "witnessed-event" && e.actionKind === "use",
		);
		const last = useEvents[useEvents.length - 1];
		if (last?.kind === "witnessed-event") {
			expect(last.useOutcome).toBe("The key sits inert in your palm.");
		}
	});
});

describe("dispatchAiTurn — use on objective_space surfaces activationFlavor to actor", () => {
	it("uses activationFlavor as the tool_success description for the actor on the satisfying call", () => {
		const game = makeGameWithSpaceObjective(
			{ row: 2, col: 2 },
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
		const game = makeGameWithSpaceObjective(
			{ row: 2, col: 2 },
			{
				row: 3,
				col: 2,
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
			"A warm glow emanates from the shrine.",
		);
	});

	it("still emits satisfactionFlavor to witnesses when activationFlavor is set (no regression)", () => {
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
				red: { position: { row: 2, col: 2 } },
				green: { position: { row: 2, col: 0 } },
				cyan: { position: { row: 4, col: 4 } },
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

		const successRecord = result.records.find((r) => r.kind === "tool_success");
		expect(successRecord?.description).toBe(
			"The basin floods with light beneath your palm.",
		);

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

describe("dispatchAiTurn — disk-delta computation (issue #376)", () => {
	it("go action that reveals a stationary actor sets actorDiskDelta on DispatchResult", () => {
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
				red: { position: { row: 2, col: 0 } },
				green: { position: { row: 0, col: 1 } },
				cyan: { position: { row: 5, col: 0 } },
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
		expect(result.actorDiskDelta).toBeDefined();
		expect(result.actorDiskDelta).toContain("*green");
	});

	it("a rejected raw `face` tool call sets no actorDiskDelta and no success record", () => {
		const game = makeGame();

		const action: AiTurnAction = {
			aiId: "red",
			toolCall: rawToolCall("face", { direction: "back" }),
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.records[0]?.kind).toBe("tool_failure");
		expect(result.records[0]?.description).toMatch(/unknown tool/i);
		expect(result.actorDiskDelta).toBeUndefined();
		expect(result.game.personaSpatial).toEqual(game.personaSpatial);
		const failures = (result.game.conversationLogs.red ?? []).filter(
			(e) => e.kind === "action-failure",
		);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({ tool: "face" });
	});

	it("non-go tools never set actorDiskDelta", () => {
		const game = makeGame();

		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "flower" } },
		};
		const result = dispatchAiTurn(game, action);
		expect(result.rejected).toBe(false);
		expect(result.actorDiskDelta).toBeUndefined();
	});
});

describe("interaction range — availability, validation, and effects agree", () => {
	function offsetPos(o: { dx: number; dy: number }): {
		row: number;
		col: number;
	} {
		return { row: 2 - o.dy, col: 2 + o.dx };
	}

	function makeRangeGame(
		entities: WorldEntity[],
		objectives: Objective[] = [],
	): GameState {
		const pack = makeTestPack(entities, {
			setting: "test",
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 2 } },
				green: { position: { row: 0, col: 0 } },
				cyan: { position: { row: 4, col: 4 } },
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
		const game = makeRangeGame([makeGroundItem({ dx: -1, dy: -1 })]);
		const result = validateToolCall(game, "red", {
			name: "use",
			args: { item: "flower" },
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toMatch(/pick_up/i);
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

		function withGreenAt(
			state: GameState,
			pos: { row: number; col: number },
		): GameState {
			return {
				...state,
				personaSpatial: {
					...state.personaSpatial,
					green: { position: pos },
				},
			};
		}

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
