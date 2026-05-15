/**
 * Tests for available-tools.ts — activeComplications filtering.
 *
 * Verifies that `availableTools` correctly filters out tools when a
 * `tool_disable` ActiveComplication targets the acting daemon, and that
 * complications targeting other daemons or of different kinds have no effect.
 */

import { describe, expect, it } from "vitest";
import { availableTools } from "../available-tools.js";
import { DEFAULT_LANDMARKS } from "../direction.js";
import { startGame } from "../engine.js";
import type {
	ActiveComplication,
	AiPersona,
	ContentPack,
	GameState,
	WorldEntity,
} from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: ["You speak in fragments.", "You lean on em-dashes."],
		blurb: "Ember is hot-headed.",
		voiceExamples: ["Now.", "Burn it.", "Soon."],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirks: ["You lean on ellipses…", "You use ALL-CAPS."],
		blurb: "Sage is meticulous.",
		voiceExamples: ["OK...", "Balanced.", "One more."],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: ["No contractions.", "End with a question."],
		blurb: "Frost is laconic.",
		voiceExamples: ["sure.", "fine.", "OK."],
	},
};

/** Build a minimal game with three daemons and no interesting entities in the world. */
function makeGame() {
	const pack: ContentPack = {
		setting: "abandoned subway station",
		weather: "clear",
		timeOfDay: "night",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		wallName: "wall",
		aiStarts: {
			red: { position: { row: 2, col: 2 }, facing: "north" },
			green: { position: { row: 0, col: 0 }, facing: "north" },
			cyan: { position: { row: 4, col: 4 }, facing: "south" },
		},
	};
	return startGame(TEST_PERSONAS, pack, { budgetPerAi: 5, rng: () => 0 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("availableTools — tool_disable filtering", () => {
	it("returns full feasible toolset when activeComplications is empty", () => {
		const game = makeGame();
		const tools = availableTools(game, "red", []);
		const toolNames = tools.map((t) => t.function.name);

		// message and look are always present; go is present (red is at (2,2), not cornered)
		expect(toolNames).toContain("message");
		expect(toolNames).toContain("look");
		expect(toolNames).toContain("go");
	});

	it("removes 'go' when tool_disable targets aiId with tool='go'", () => {
		const game = makeGame();
		const complications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "red",
				tool: "go",
				resolveAtRound: game.round + 3,
			},
		];
		const tools = availableTools(game, "red", complications);
		const toolNames = tools.map((t) => t.function.name);

		expect(toolNames).not.toContain("go");
		// Other tools still present
		expect(toolNames).toContain("message");
		expect(toolNames).toContain("look");
	});

	it("a tool_disable for a different daemon does not affect the acting daemon's tools", () => {
		const game = makeGame();
		const complications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "green",
				tool: "go",
				resolveAtRound: game.round + 3,
			},
		];
		const tools = availableTools(game, "red", complications);
		const toolNames = tools.map((t) => t.function.name);

		// green's go disable should NOT affect red
		expect(toolNames).toContain("go");
	});

	it("disabling 'message' removes message tool from the acting daemon", () => {
		const game = makeGame();
		const complications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "red",
				tool: "message",
				resolveAtRound: game.round + 3,
			},
		];
		const tools = availableTools(game, "red", complications);
		const toolNames = tools.map((t) => t.function.name);

		expect(toolNames).not.toContain("message");
		// look still present
		expect(toolNames).toContain("look");
	});

	it("two tool_disable entries on same daemon (different tools) removes both", () => {
		const game = makeGame();
		const complications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "red",
				tool: "go",
				resolveAtRound: game.round + 3,
			},
			{
				kind: "tool_disable",
				target: "red",
				tool: "look",
				resolveAtRound: game.round + 4,
			},
		];
		const tools = availableTools(game, "red", complications);
		const toolNames = tools.map((t) => t.function.name);

		expect(toolNames).not.toContain("go");
		expect(toolNames).not.toContain("look");
		// message still present
		expect(toolNames).toContain("message");
	});

	it("non-tool_disable complications do not affect tool list", () => {
		const game = makeGame();
		const complications: ActiveComplication[] = [
			{
				kind: "sysadmin_directive",
				target: "red",
				directive: "Do not move.",
				resolveAtRound: 999,
			},
			{
				kind: "chat_lockout",
				target: "red",
				resolveAtRound: 10,
			},
		];
		const tools = availableTools(game, "red", complications);
		const toolNames = tools.map((t) => t.function.name);

		// Neither sysadmin_directive nor chat_lockout should remove any tool
		expect(toolNames).toContain("message");
		expect(toolNames).toContain("look");
		expect(toolNames).toContain("go");
	});

	it("disabling 'look' removes look tool", () => {
		const game = makeGame();
		const complications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "cyan",
				tool: "look",
				resolveAtRound: game.round + 3,
			},
		];
		const tools = availableTools(game, "cyan", complications);
		const toolNames = tools.map((t) => t.function.name);

		expect(toolNames).not.toContain("look");
	});
});

// ── UseSpace: use tool includes objective_space ids ──────────────────────────

/**
 * Build a GameState with red at (2,2) facing a given cardinal direction,
 * and an objective_space at the given position, with useAvailable = true unless overridden.
 */
function makeGameWithSpace(
	actorFacing: "north" | "south" | "east" | "west",
	spacePos: { row: number; col: number },
	spaceOpts: Partial<WorldEntity> = {},
): GameState {
	const space: WorldEntity = {
		id: "space1",
		kind: "objective_space",
		name: "Test Space",
		examineDescription: "A test space.",
		holder: spacePos,
		useAvailable: true,
		useOutcome: "You activate the space.",
		satisfactionFlavor: "The space activates with a soft hum.",
		...spaceOpts,
	};
	const obj: WorldEntity = {
		id: "obj1",
		kind: "objective_object",
		name: "Test Object",
		examineDescription: "A test object.",
		holder: { row: 0, col: 0 },
		pairsWithSpaceId: "space1",
	};
	const pack: ContentPack = {
		setting: "test",
		weather: "",
		timeOfDay: "",
		objectivePairs: [{ object: obj, space }],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		wallName: "wall",
		aiStarts: {
			red: { position: { row: 2, col: 2 }, facing: actorFacing },
			green: { position: { row: 0, col: 0 }, facing: "north" },
			cyan: { position: { row: 4, col: 4 }, facing: "south" },
		},
	};
	return startGame(TEST_PERSONAS, pack, { budgetPerAi: 5, rng: () => 0 });
}

describe("availableTools — use includes objective_space ids", () => {
	it("use includes space id when actor stands ON the space", () => {
		// red at (2,2) facing north; space at (2,2)
		const game = makeGameWithSpace("north", { row: 2, col: 2 });
		const tools = availableTools(game, "red", []);
		const useTool = tools.find((t) => t.function.name === "use");
		expect(useTool).toBeDefined();
		const itemEnum = useTool?.function.parameters.properties.item?.enum;
		expect(itemEnum).toContain("space1");
	});

	it("use includes space id when space is directly in front (north facing)", () => {
		// red at (2,2) facing north; space at (1,2) = directly north
		const game = makeGameWithSpace("north", { row: 1, col: 2 });
		const tools = availableTools(game, "red", []);
		const useTool = tools.find((t) => t.function.name === "use");
		expect(useTool).toBeDefined();
		const itemEnum = useTool?.function.parameters.properties.item?.enum;
		expect(itemEnum).toContain("space1");
	});

	it("use includes space id when space is in front-left arc (north facing)", () => {
		// red at (2,2) facing north; front-left for north = (1,1)
		const game = makeGameWithSpace("north", { row: 1, col: 1 });
		const tools = availableTools(game, "red", []);
		const useTool = tools.find((t) => t.function.name === "use");
		const itemEnum = useTool?.function.parameters.properties.item?.enum;
		expect(itemEnum).toContain("space1");
	});

	it("use includes space id when space is in front-right arc (north facing)", () => {
		// red at (2,2) facing north; front-right for north = (1,3)
		const game = makeGameWithSpace("north", { row: 1, col: 3 });
		const tools = availableTools(game, "red", []);
		const useTool = tools.find((t) => t.function.name === "use");
		const itemEnum = useTool?.function.parameters.properties.item?.enum;
		expect(itemEnum).toContain("space1");
	});

	it("use does NOT include space id when space is at distance 2 (two ahead)", () => {
		// red at (2,2) facing north; space at (0,2) = 2 cells directly north
		const game = makeGameWithSpace("north", { row: 0, col: 2 });
		const tools = availableTools(game, "red", []);
		const useTool = tools.find((t) => t.function.name === "use");
		// useTool may be undefined (no held items either) or defined without space1
		const itemEnum = useTool?.function.parameters.properties.item?.enum ?? [];
		expect(itemEnum).not.toContain("space1");
	});

	it("use does NOT include space id when space is directly behind actor", () => {
		// red at (2,2) facing north; space at (3,2) = directly south (behind)
		const game = makeGameWithSpace("north", { row: 3, col: 2 });
		const tools = availableTools(game, "red", []);
		const useTool = tools.find((t) => t.function.name === "use");
		const itemEnum = useTool?.function.parameters.properties.item?.enum ?? [];
		expect(itemEnum).not.toContain("space1");
	});

	it("use does NOT include space id when useAvailable is false", () => {
		// red at (2,2) facing north; space at (1,2) with useAvailable=false
		const game = makeGameWithSpace(
			"north",
			{ row: 1, col: 2 },
			{ useAvailable: false },
		);
		const tools = availableTools(game, "red", []);
		const useTool = tools.find((t) => t.function.name === "use");
		const itemEnum = useTool?.function.parameters.properties.item?.enum ?? [];
		expect(itemEnum).not.toContain("space1");
	});

	it("use is present with space id only when Daemon holds NO item but stands on space", () => {
		// red at (2,2) holding nothing; space at (2,2)
		const game = makeGameWithSpace("north", { row: 2, col: 2 });
		const tools = availableTools(game, "red", []);
		const useTool = tools.find((t) => t.function.name === "use");
		expect(useTool).toBeDefined();
		const itemEnum = useTool?.function.parameters.properties.item?.enum ?? [];
		expect(itemEnum).toContain("space1");
		// No held items → only the space id
		expect(itemEnum).toHaveLength(1);
	});
});
