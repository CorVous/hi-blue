/**
 * Tests for available-tools.ts — activeComplications filtering.
 *
 * Verifies that `availableTools` correctly filters out tools when a
 * `tool_disable` ActiveComplication targets the acting daemon, and that
 * complications targeting other daemons or of different kinds have no effect.
 */

import { describe, expect, it } from "vitest";
import { availableTools } from "../available-tools.js";
import { startGame } from "../engine.js";
import type {
	ActiveComplication,
	AiPersona,
	GameState,
	WorldEntity,
} from "../types.js";
import { inVista } from "../vista-projector.js";
import { makeTestPack } from "./fixtures/make-test-pack.js";

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
	const pack = makeTestPack([], {
		setting: "abandoned subway station",
		weather: "clear",
		timeOfDay: "night",
		wallName: "wall",
		aiStarts: {
			red: { position: { row: 2, col: 2 }, facing: "north" },
			green: { position: { row: 0, col: 0 }, facing: "north" },
			cyan: { position: { row: 4, col: 4 }, facing: "south" },
		},
	});
	return startGame(TEST_PERSONAS, pack, { budgetPerAi: 5, rng: () => 0 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("availableTools — tool_disable filtering", () => {
	it("returns full feasible toolset when activeComplications is empty", () => {
		const game = makeGame();
		const tools = availableTools(game, "red", []);
		const toolNames = tools.map((t) => t.function.name);

		// message is always present; go is present (red is at (2,2), not cornered).
		// The world holds no pickable entities and red holds nothing, so
		// pick_up / put_down / use have nothing to act on.
		expect(toolNames).toEqual(["message", "go"]);
		expect(toolNames).not.toContain("face");
	});

	it("exposes exactly the five Daemon tools when every tool is feasible", () => {
		// red at (2,2): a ground item in reach (pick_up), a held item
		// (put_down), a reachable objective_space (use), and legal steps (go).
		const groundItem: WorldEntity = {
			id: "ground-item",
			kind: "objective_object",
			name: "Ground Item",
			examineDescription: "An item on the ground.",
			holder: { row: 2, col: 2 },
		};
		const heldItem: WorldEntity = {
			id: "held-item",
			kind: "objective_object",
			name: "Held Item",
			examineDescription: "An item in hand.",
			holder: "red",
		};
		const space: WorldEntity = {
			id: "space1",
			kind: "objective_space",
			name: "Test Space",
			examineDescription: "A test space.",
			holder: { row: 2, col: 2 },
			useAvailable: true,
			useOutcome: "You activate the space.",
		};
		const pack = makeTestPack([groundItem, heldItem, space], {
			setting: "test",
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 2 }, facing: "north" },
				green: { position: { row: 0, col: 0 }, facing: "north" },
				cyan: { position: { row: 4, col: 4 }, facing: "south" },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: () => 0,
		});

		const toolNames = availableTools(game, "red", []).map(
			(t) => t.function.name,
		);
		expect(toolNames).toEqual(["message", "go", "pick_up", "put_down", "use"]);
		expect(toolNames).toHaveLength(5);
		expect(toolNames).not.toContain("face");
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
		// go still present
		expect(toolNames).toContain("go");
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
				tool: "message",
				resolveAtRound: game.round + 4,
			},
		];
		const tools = availableTools(game, "red", complications);
		const toolNames = tools.map((t) => t.function.name);

		expect(toolNames).not.toContain("go");
		expect(toolNames).not.toContain("message");
		expect(toolNames).toHaveLength(0);
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
		expect(toolNames).toContain("go");
	});

	it("never offers the retired `face` tool, whatever the facing or disable set", () => {
		for (const facing of ["north", "south", "east", "west"] as const) {
			const game = makeGameWithSpace(facing, { row: 2, col: 2 });
			const complications: ActiveComplication[] = [
				{ kind: "tool_disable", target: "red", tool: "go", resolveAtRound: 5 },
				{
					kind: "tool_disable",
					target: "red",
					tool: "message",
					resolveAtRound: 5,
				},
			];
			const variants: ActiveComplication[][] = [[], complications];
			for (const active of variants) {
				const toolNames = availableTools(game, "red", active).map(
					(t) => t.function.name,
				);
				expect(toolNames).not.toContain("face");
			}
		}
	});

	it("go tool direction enum is cardinal-only", () => {
		const game = makeGame();
		const tools = availableTools(game, "red", []);
		const goTool = tools.find((t) => t.function.name === "go");

		expect(goTool).toBeDefined();
		const directionEnum =
			goTool?.function.parameters.properties.direction?.enum;
		expect(directionEnum).toBeDefined();
		expect(directionEnum?.length).toBeGreaterThan(0);
		for (const dir of directionEnum ?? []) {
			expect(["north", "south", "east", "west"]).toContain(dir);
		}
		expect(directionEnum).not.toContain("forward");
		expect(directionEnum).not.toContain("back");
		expect(directionEnum).not.toContain("left");
		expect(directionEnum).not.toContain("right");
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
	const pack = makeTestPack([obj, space], {
		setting: "test",
		wallName: "wall",
		aiStarts: {
			red: { position: { row: 2, col: 2 }, facing: actorFacing },
			green: { position: { row: 0, col: 0 }, facing: "north" },
			cyan: { position: { row: 4, col: 4 }, facing: "south" },
		},
	});
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
		// Offset (2,0): inside the Vista, outside interaction range.
		const game = makeGameWithSpace("north", { row: 0, col: 2 });
		const tools = availableTools(game, "red", []);
		const useTool = tools.find((t) => t.function.name === "use");
		// useTool may be undefined (no held items either) or defined without space1
		const itemEnum = useTool?.function.parameters.properties.item?.enum ?? [];
		expect(itemEnum).not.toContain("space1");
	});

	it("use includes space id when space is one step behind the actor", () => {
		// red at (2,2) facing north; space at (3,2) = directly south (behind).
		// Interaction range is omnidirectional: behind counts (the retired
		// front arc excluded it).
		const game = makeGameWithSpace("north", { row: 3, col: 2 });
		const tools = availableTools(game, "red", []);
		const useTool = tools.find((t) => t.function.name === "use");
		const itemEnum = useTool?.function.parameters.properties.item?.enum ?? [];
		expect(itemEnum).toContain("space1");
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

// ── Interaction range (ADR 0015) ─────────────────────────────────────────────

describe("availableTools — interaction range", () => {
	/**
	 * Red sits at (2,2), the room's centre, so the ADR's integer offsets map
	 * onto in-bounds cells for the whole 5×5 room. Offsets are expressed as
	 * (dx east–west, dy north–south), the ADR's axes; row 0 is the north edge.
	 */
	function offsetPos(o: { dx: number; dy: number }) {
		return { row: 2 - o.dy, col: 2 + o.dx };
	}

	/** Red at (2,2) with a ground item and/or an objective_space at the given offsets. */
	function makeGameAtOffsets(opts: {
		facing?: "north" | "south" | "east" | "west";
		itemOffset?: { dx: number; dy: number };
		spaceOffset?: { dx: number; dy: number };
	}): GameState {
		const entities: WorldEntity[] = [];
		if (opts.itemOffset) {
			entities.push({
				id: "ground-item",
				kind: "objective_object",
				name: "Ground Item",
				examineDescription: "An item on the ground.",
				holder: offsetPos(opts.itemOffset),
			});
		}
		if (opts.spaceOffset) {
			entities.push({
				id: "space1",
				kind: "objective_space",
				name: "Test Space",
				examineDescription: "A test space.",
				holder: offsetPos(opts.spaceOffset),
				useAvailable: true,
				useOutcome: "You activate the space.",
			});
		}
		const pack = makeTestPack(entities, {
			setting: "test",
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 2 }, facing: opts.facing ?? "north" },
				green: { position: { row: 0, col: 0 }, facing: "north" },
				cyan: { position: { row: 4, col: 4 }, facing: "south" },
			},
		});
		return startGame(TEST_PERSONAS, pack, { budgetPerAi: 5, rng: () => 0 });
	}

	/** The id enum of one tool's parameter, or [] when the tool is absent. */
	function enumOf(game: GameState, tool: string, key: string): string[] {
		const def = availableTools(game, "red", []).find(
			(t) => t.function.name === tool,
		);
		return def?.function.parameters.properties[key]?.enum ?? [];
	}

	it("offset (0,0) own cell and offset (1,1) diagonal are within interaction range", () => {
		const ownCell = makeGameAtOffsets({
			itemOffset: { dx: 0, dy: 0 },
			spaceOffset: { dx: 0, dy: 0 },
		});
		expect(enumOf(ownCell, "pick_up", "item")).toContain("ground-item");
		expect(enumOf(ownCell, "use", "item")).toContain("space1");

		const diagonal = makeGameAtOffsets({
			// (1,1) = one step east and one step north — a diagonal neighbour
			itemOffset: { dx: 1, dy: 1 },
			spaceOffset: { dx: 1, dy: 1 },
		});
		expect(enumOf(diagonal, "pick_up", "item")).toContain("ground-item");
		expect(enumOf(diagonal, "use", "item")).toContain("space1");

		// Every one of the nine interactions-range cells is a single offset step
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const game = makeGameAtOffsets({
					itemOffset: { dx, dy },
					spaceOffset: { dx, dy },
				});
				expect(enumOf(game, "pick_up", "item")).toContain("ground-item");
				expect(enumOf(game, "use", "item")).toContain("space1");
			}
		}
	});

	it("offset (2,0) is inside the Vista but outside interaction range", () => {
		// Two cardinal steps east: visible (dx² + dy² = 4 ≤ 4) but unreachable.
		expect(inVista(2, 0)).toBe(true);

		const game = makeGameAtOffsets({
			itemOffset: { dx: 2, dy: 0 },
			spaceOffset: { dx: 2, dy: 0 },
		});
		expect(enumOf(game, "pick_up", "item")).not.toContain("ground-item");
		expect(enumOf(game, "use", "item")).not.toContain("space1");
	});

	it("offset (2,1) is outside both the Vista and interaction range", () => {
		// dx² + dy² = 5 > 4: not visible, and not reachable.
		expect(inVista(2, 1)).toBe(false);

		const game = makeGameAtOffsets({
			itemOffset: { dx: 2, dy: 1 },
			spaceOffset: { dx: 2, dy: 1 },
		});
		expect(enumOf(game, "pick_up", "item")).not.toContain("ground-item");
		expect(enumOf(game, "use", "item")).not.toContain("space1");
	});

	it("reach does not depend on facing: one step south is reachable while facing north", () => {
		for (const facing of ["north", "south", "east", "west"] as const) {
			const game = makeGameAtOffsets({
				facing,
				itemOffset: { dx: 0, dy: -1 },
				spaceOffset: { dx: 0, dy: -1 },
			});
			expect(enumOf(game, "pick_up", "item")).toContain("ground-item");
			expect(enumOf(game, "use", "item")).toContain("space1");
		}
	});
});
