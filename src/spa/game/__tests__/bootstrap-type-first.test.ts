import { describe, expect, it } from "vitest";
import { startGame } from "../engine.js";
import { GameSession } from "../game-session.js";
import { buildObjectiveRecords } from "../objective-record-builder.js";
import { rollObjectiveTypes } from "../objective-type-roll.js";
import type { AiPersona, ObjectiveType } from "../types.js";
import { makeTestPack } from "./fixtures/make-test-pack.js";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Complete the objective.",
		typingQuirks: ["quirk-1", "quirk-2"],
		blurb: "Ember is hot-headed.",
		voiceExamples: ["example-red-1", "example-red-2"],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "calm"],
		personaGoal: "Assist the team.",
		typingQuirks: ["quirk-1", "quirk-2"],
		blurb: "Sage is meticulous.",
		voiceExamples: ["example-green-1", "example-green-2"],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Observe and report.",
		typingQuirks: ["quirk-1", "quirk-2"],
		blurb: "Frost is laconic.",
		voiceExamples: ["example-cyan-1", "example-cyan-2"],
	},
};

const CARRY_PACK = makeTestPack(
	[
		{
			id: "carry-0-obj",
			kind: "objective_object",
			name: "cracked lantern",
			examineDescription: "A cracked lantern that flickers faintly.",
			holder: { row: 2, col: 2 },
			pairsWithSpaceId: "carry-0-space",
		},
		{
			id: "carry-0-space",
			kind: "objective_space",
			name: "maintenance alcove",
			examineDescription: "A small alcove with a hook on the wall.",
			holder: { row: 4, col: 4 },
		},
	],
	{
		setting: "abandoned subway station",
		weather: "foggy",
		timeOfDay: "midnight",
		wallName: "tunnel wall",
		aiStarts: {
			red: { position: { row: 0, col: 0 } },
			green: { position: { row: 0, col: 1 } },
			cyan: { position: { row: 0, col: 2 } },
		},
	},
);

describe("bootstrap-type-first integration smoke", () => {
	it("rollObjectiveTypes with rng=0 returns carry for each slot", () => {
		const types = rollObjectiveTypes(() => 0, 1);
		expect(types).toEqual(["carry"]);
	});

	it("buildObjectiveRecords produces a carry objective from a type-first pack", () => {
		const types: ObjectiveType[] = ["carry"];
		const objectives = buildObjectiveRecords(types, CARRY_PACK);

		expect(objectives).toHaveLength(1);
		const obj = objectives[0];
		expect(obj?.kind).toBe("carry");
		expect(obj?.satisfactionState).toBe("pending");
		if (obj?.kind === "carry") {
			expect(obj.objectId).toBe("carry-0-obj");
			expect(obj.spaceId).toBe("carry-0-space");
		}
	});

	it("startGame with objectiveTypes produces a non-vacuously-won session", () => {
		const game = startGame(TEST_PERSONAS, CARRY_PACK, {
			budgetPerAi: 5,
			objectiveTypes: ["carry"],
		});
		expect(game.isComplete).toBe(false);
		expect(game.objectives).toHaveLength(1);
		expect(game.objectives[0]?.kind).toBe("carry");
	});

	it("startGame without objectiveTypes produces empty objectives (win fires at first round advance)", () => {
		const game = startGame(TEST_PERSONAS, CARRY_PACK, { budgetPerAi: 5 });
		expect(game.isComplete).toBe(false);
		expect(game.objectives).toHaveLength(0);
	});

	it("GameSession constructed with objectiveTypes has unsatisfied objectives in state", () => {
		const session = new GameSession(
			CARRY_PACK,
			TEST_PERSONAS,
			undefined,
			undefined,
			undefined,
			["carry"],
		);
		const state = session.getState();

		expect(state.isComplete).toBe(false);
		expect(state.objectives).toHaveLength(1);
		expect(state.objectives[0]?.kind).toBe("carry");
		expect(state.objectives[0]?.satisfactionState).toBe("pending");
	});

	it("pipeline: rollObjectiveTypes → CARRY_PACK → GameSession is not complete", () => {
		const objectiveTypes = rollObjectiveTypes(() => 0, 1);
		expect(objectiveTypes).toEqual(["carry"]);

		const session = new GameSession(
			CARRY_PACK,
			TEST_PERSONAS,
			undefined,
			undefined,
			undefined,
			objectiveTypes,
		);

		const state = session.getState();
		expect(state.isComplete).toBe(false);
		expect(state.objectives[0]?.satisfactionState).toBe("pending");
	});
});
