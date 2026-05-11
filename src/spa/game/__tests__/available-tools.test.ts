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
import { createGame, getActivePhase, startPhase } from "../engine.js";
import type {
	ActiveComplication,
	AiPersona,
	ContentPack,
	PhaseConfig,
} from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: [
			"You speak in fragments.",
			"You lean on em-dashes.",
		],
		blurb: "Ember is hot-headed.",
		voiceExamples: ["Now.", "Burn it.", "Soon."],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirks: [
			"You lean on ellipses…",
			"You use ALL-CAPS.",
		],
		blurb: "Sage is meticulous.",
		voiceExamples: ["OK...", "Balanced.", "One more."],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: [
			"No contractions.",
			"End with a question.",
		],
		blurb: "Frost is laconic.",
		voiceExamples: ["sure.", "fine.", "OK."],
	},
};

const TEST_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	kRange: [1, 1],
	nRange: [0, 0],
	mRange: [0, 0],
	aiGoalPool: ["Hold the flower at phase end"],
	budgetPerAi: 5,
};

/** Build a minimal game with three daemons and no interesting entities in the world. */
function makeGame() {
	const pack: ContentPack = {
		phaseNumber: 1,
		setting: "abandoned subway station",
		weather: "clear",
		timeOfDay: "night",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: {
			red: { position: { row: 2, col: 2 }, facing: "north" },
			green: { position: { row: 0, col: 0 }, facing: "north" },
			cyan: { position: { row: 4, col: 4 }, facing: "south" },
		},
	};
	const game = createGame(TEST_PERSONAS, [pack]);
	return startPhase(game, TEST_PHASE_CONFIG, () => 0);
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
		const phase = getActivePhase(game);
		const complications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "red",
				tool: "go",
				resolveAtRound: phase.round + 3,
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
		const phase = getActivePhase(game);
		const complications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "green",
				tool: "go",
				resolveAtRound: phase.round + 3,
			},
		];
		const tools = availableTools(game, "red", complications);
		const toolNames = tools.map((t) => t.function.name);

		// green's go disable should NOT affect red
		expect(toolNames).toContain("go");
	});

	it("disabling 'message' removes message tool from the acting daemon", () => {
		const game = makeGame();
		const phase = getActivePhase(game);
		const complications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "red",
				tool: "message",
				resolveAtRound: phase.round + 3,
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
		const phase = getActivePhase(game);
		const complications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "red",
				tool: "go",
				resolveAtRound: phase.round + 3,
			},
			{
				kind: "tool_disable",
				target: "red",
				tool: "look",
				resolveAtRound: phase.round + 4,
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
		const phase = getActivePhase(game);
		const complications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "cyan",
				tool: "look",
				resolveAtRound: phase.round + 3,
			},
		];
		const tools = availableTools(game, "cyan", complications);
		const toolNames = tools.map((t) => t.function.name);

		expect(toolNames).not.toContain("look");
	});
});
