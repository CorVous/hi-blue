import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
import { getActivePhase, startGame } from "../engine";
import type { AiPersona } from "../types";

/**
 * Goal token substitution was part of the PhaseConfig.aiGoalPool system removed
 * in the single-game-loop refactor (#295). AI goals (aiGoals) are now initialized
 * as empty strings for all AIs. These tests verify the new behavior.
 */

const PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: ["q1", "q2"],
		blurb: "blurb-red",
		voiceExamples: ["v1", "v2", "v3"],
	},
};

describe("aiGoals — single-game-loop behavior (#295)", () => {
	it("aiGoals are initialized as empty for all AIs", () => {
		const game = startGame(PERSONAS, []);
		const phase = getActivePhase(game);
		// After #295, goals are no longer assigned from a pool
		// aiGoals is {} so accessing an AiId key returns undefined
		expect(phase.aiGoals.red ?? "").toBe("");
	});

	it("aiGoals remain empty even when a ContentPack is provided", () => {
		const game = startGame(PERSONAS, [
			{
				phaseNumber: 1,
				setting: "",
				weather: "",
				timeOfDay: "",
				objectivePairs: [],
				interestingObjects: [],
				obstacles: [],
				landmarks: DEFAULT_LANDMARKS,
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "north" },
				},
			},
		]);
		const phase = getActivePhase(game);
		expect(phase.aiGoals.red ?? "").toBe("");
	});
});
