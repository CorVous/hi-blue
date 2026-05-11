/**
 * Tests for complications.ts — Weather Change complication handler.
 *
 * Uses a stub rng for determinism. The weather pool has 12 entries;
 * drawing index 0 always gives "Heavy rain is falling." when the
 * current weather is something other than that entry.
 */

import { describe, expect, it } from "vitest";
import { WEATHER_POOL } from "../../../content/index.js";
import {
	COMPLICATIONS,
	toolDisableComplication,
	weatherChangeComplication,
} from "../complications.js";
import { DEFAULT_LANDMARKS } from "../direction.js";
import {
	createGame,
	getActivePhase,
	startPhase,
	updateActivePhase,
} from "../engine.js";
import type {
	ActiveComplication,
	AiPersona,
	ContentPack,
	PhaseConfig,
} from "../types.js";

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
		const currentWeather = WEATHER_POOL[0] ?? "Heavy rain is falling.";
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

	it("contains toolDisableComplication", () => {
		expect(COMPLICATIONS.some((c) => c.name === "toolDisable")).toBe(true);
	});
});

describe("toolDisableComplication", () => {
	/** rng that returns values from the provided sequence */
	function seqRng(values: number[]): () => number {
		let idx = 0;
		return () => {
			if (idx >= values.length)
				throw new Error(`seqRng exhausted at call #${idx + 1}`);
			// biome-ignore lint/style/noNonNullAssertion: bounded
			return values[idx++]!;
		};
	}

	it("apply appends one tool_disable to phase.activeComplications", () => {
		const game = makeGameWithWeather("clear");
		// rng[0]=0.0 → picks first valid pair; rng[1]=0.0 → duration=3
		const result = toolDisableComplication.apply(game, seqRng([0.0, 0.0]));
		const phase = getActivePhase(result);
		const disables = phase.activeComplications.filter(
			(c) => c.kind === "tool_disable",
		);
		expect(disables).toHaveLength(1);
	});

	it("apply sets resolveAtRound = phase.round + duration where duration ∈ [3, 5]", () => {
		const game = makeGameWithWeather("clear");
		// Test with several duration values
		for (const durationSeed of [0.0, 0.34, 0.67, 0.99]) {
			const result = toolDisableComplication.apply(
				game,
				seqRng([0.0, durationSeed]),
			);
			const phase = getActivePhase(result);
			const disable = phase.activeComplications.find(
				(c) => c.kind === "tool_disable",
			);
			expect(disable).toBeDefined();
			if (disable?.kind === "tool_disable") {
				const baseRound = getActivePhase(game).round;
				expect(disable.resolveAtRound).toBeGreaterThanOrEqual(baseRound + 3);
				expect(disable.resolveAtRound).toBeLessThanOrEqual(baseRound + 5);
			}
		}
	});

	it("apply appends a private broadcast notice to target daemon's log only", () => {
		const game = makeGameWithWeather("clear");
		// All AI ids are red, green, cyan; rng[0]=0.0 → first pair → first (daemon,tool)
		const result = toolDisableComplication.apply(game, seqRng([0.0, 0.0]));
		const phase = getActivePhase(result);

		// Find the target daemon from the disable entry
		const disable = phase.activeComplications.find(
			(c) => c.kind === "tool_disable",
		);
		if (!disable || disable.kind !== "tool_disable")
			throw new Error("no disable");
		const targetId = disable.target;

		// Target daemon should have a broadcast entry
		const targetLog = phase.conversationLogs[targetId] ?? [];
		const broadcasts = targetLog.filter((e) => e.kind === "broadcast");
		expect(broadcasts).toHaveLength(1);
		if (broadcasts[0]?.kind === "broadcast") {
			expect(broadcasts[0].content).toContain("Sysadmin");
			expect(broadcasts[0].content).toContain(disable.tool);
		}

		// Other daemons should NOT have the broadcast
		const aiIds = Object.keys(TEST_PERSONAS);
		for (const aiId of aiIds) {
			if (aiId === targetId) continue;
			const otherLog = phase.conversationLogs[aiId] ?? [];
			const otherBroadcasts = otherLog.filter((e) => e.kind === "broadcast");
			expect(otherBroadcasts).toHaveLength(0);
		}
	});

	it("apply is a no-op when all (daemon, tool) pairs already disabled", () => {
		const game = makeGameWithWeather("clear");
		const phase = getActivePhase(game);
		const toolNames = [
			"pick_up",
			"put_down",
			"give",
			"use",
			"go",
			"look",
			"examine",
			"message",
		] as const;
		const aiIds = Object.keys(TEST_PERSONAS);

		// Build a game with all (daemon, tool) pairs already disabled
		const allDisabled: ActiveComplication[] = [];
		for (const aiId of aiIds) {
			for (const tool of toolNames) {
				allDisabled.push({
					kind: "tool_disable",
					target: aiId,
					tool,
					resolveAtRound: phase.round + 99,
				});
			}
		}
		const saturatedGame = updateActivePhase(game, (p) => ({
			...p,
			activeComplications: allDisabled,
		}));

		// Apply with an empty rng — if any rng call occurs, seqRng will throw.
		// The no-op path must not consume any rng reads.
		const result = toolDisableComplication.apply(saturatedGame, seqRng([]));
		const after = getActivePhase(result);
		expect(after.activeComplications.length).toBe(allDisabled.length);
	});
});
