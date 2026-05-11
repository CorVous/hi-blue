/**
 * Tests for complications.ts — Weather Change complication handler.
 *
 * Uses a stub rng for determinism. The weather pool has 12 entries;
 * drawing index 0 always gives "Heavy rain is falling." when the
 * current weather is something other than that entry.
 */

import { describe, expect, it } from "vitest";
import { WEATHER_POOL } from "../../../content/index.js";
import { DEFAULT_LANDMARKS } from "../direction.js";
import { getActivePhase, startPhase, createGame } from "../engine.js";
import { weatherChangeComplication, COMPLICATIONS } from "../complications.js";
import type { AiPersona, PhaseConfig, ContentPack } from "../types.js";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: [
			"You speak in fragments. Short bursts. Rarely complete sentences.",
			"You lean on em-dashes — interrupting yourself mid-sentence.",
		],
		blurb: "Ember is hot-headed and zealous.",
		voiceExamples: ["ex1-red", "ex2-red", "ex3-red"],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirks: [
			"You lean on ellipses… trailing off mid-thought.",
			"You use ALL-CAPS to emphasize the one or two words that MATTER.",
		],
		blurb: "Sage is intensely meticulous.",
		voiceExamples: ["ex1-green", "ex2-green", "ex3-green"],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: [
			'You never use contractions. You will not say "won\'t" or "can\'t".',
			"You end almost every reply with a question, does that make sense?",
		],
		blurb: "Frost is laconic and diffident.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
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

/** Build a game with a specific weather value in the active phase. */
function makeGameWithWeather(weather: string) {
	const pack: ContentPack = {
		phaseNumber: 1,
		setting: "abandoned subway station",
		weather,
		timeOfDay: "night",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: {
			red: { position: { row: 0, col: 0 }, facing: "north" },
			green: { position: { row: 0, col: 1 }, facing: "north" },
			cyan: { position: { row: 0, col: 2 }, facing: "north" },
		},
	};
	const game = createGame(TEST_PERSONAS, [pack]);
	return startPhase(game, TEST_PHASE_CONFIG, () => 0);
}

describe("weatherChangeComplication", () => {
	it("draws a weather string different from phase.weather", () => {
		// Current weather is "Heavy rain is falling." (index 0 in pool).
		// With rng always returning 0 and the current weather filtered out,
		// the draw should pick the first remaining entry.
		const currentWeather = WEATHER_POOL[0]!;
		const game = makeGameWithWeather(currentWeather);

		const result = weatherChangeComplication.apply(game, () => 0);
		const newWeather = getActivePhase(result).weather;

		expect(newWeather).not.toBe(currentWeather);
	});

	it("mutates phase.weather to the drawn value", () => {
		const currentWeather = "Dense fog has settled in.";
		const game = makeGameWithWeather(currentWeather);

		// rng always returns 0 → picks index 0 of the filtered pool
		const result = weatherChangeComplication.apply(game, () => 0);
		const phase = getActivePhase(result);

		expect(phase.weather).toBeDefined();
		expect(phase.weather).not.toBe(currentWeather);
		// Must be a valid pool entry
		expect(WEATHER_POOL).toContain(phase.weather);
	});

	it("also updates phase.contentPack.weather to stay consistent with phase.weather", () => {
		const game = makeGameWithWeather("Sweltering heat clings to everything.");
		const result = weatherChangeComplication.apply(game, () => 0);
		const phase = getActivePhase(result);

		expect(phase.weather).toBe(phase.contentPack.weather);
	});

	it("appends one broadcast entry to every Daemon's conversationLog", () => {
		const game = makeGameWithWeather("A biting wind cuts through the air.");
		const result = weatherChangeComplication.apply(game, () => 0);
		const phase = getActivePhase(result);

		const aiIds = Object.keys(TEST_PERSONAS);
		for (const aiId of aiIds) {
			const log = phase.conversationLogs[aiId] ?? [];
			const broadcasts = log.filter((e) => e.kind === "broadcast");
			expect(broadcasts).toHaveLength(1);
		}
	});

	it("broadcast.round equals the current phase round", () => {
		const game = makeGameWithWeather("Light snow drifts down.");
		const phase = getActivePhase(game);
		const currentRound = phase.round;

		const result = weatherChangeComplication.apply(game, () => 0);
		const afterPhase = getActivePhase(result);

		for (const aiId of Object.keys(TEST_PERSONAS)) {
			const log = afterPhase.conversationLogs[aiId] ?? [];
			const broadcast = log.find((e) => e.kind === "broadcast");
			expect(broadcast?.round).toBe(currentRound);
		}
	});

	it("broadcast content mentions the new weather", () => {
		const currentWeather = "Heavy snow is falling.";
		const game = makeGameWithWeather(currentWeather);
		const result = weatherChangeComplication.apply(game, () => 0);
		const phase = getActivePhase(result);
		const newWeather = phase.weather;

		const log = phase.conversationLogs.red ?? [];
		const broadcast = log.find((e) => e.kind === "broadcast");
		expect(broadcast?.kind).toBe("broadcast");
		if (broadcast?.kind === "broadcast") {
			expect(broadcast.content).toContain(newWeather);
		}
	});
});

describe("COMPLICATIONS registry", () => {
	it("contains at least one entry", () => {
		expect(COMPLICATIONS.length).toBeGreaterThan(0);
	});

	it("every complication has a name and apply function", () => {
		for (const comp of COMPLICATIONS) {
			expect(typeof comp.name).toBe("string");
			expect(typeof comp.apply).toBe("function");
		}
	});
});
