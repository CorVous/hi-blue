import { describe, expect, it } from "vitest";
import { WEATHER_POOL } from "../../../content/weather-pool";
import { startGame } from "../engine";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { AiPersona, WorldEntity } from "../types";
import { makeTestPack } from "./fixtures/make-test-pack";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: ["Fragments.", "Em-dashes."],
		blurb: "Ember is hot-headed and zealous.",
		voiceExamples: ["ex1", "ex2", "ex3"],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirks: ["Ellipses.", "ALL-CAPS."],
		blurb: "Sage is meticulous.",
		voiceExamples: ["ex1", "ex2", "ex3"],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: ["No contractions.", "Ends with a question."],
		blurb: "Frost is laconic and diffident.",
		voiceExamples: ["ex1", "ex2", "ex3"],
	},
};

const OBJECTIVE_OBJECT: WorldEntity = {
	id: "obj_a",
	kind: "objective_object",
	name: "Test Object",
	examineDescription: "A test object.",
	holder: { row: 0, col: 0 },
	pairsWithSpaceId: "obj_space_a",
	placementFlavor: "{actor} places it on the space.",
};

const OBJECTIVE_SPACE: WorldEntity = {
	id: "obj_space_a",
	kind: "objective_space",
	name: "Test Space",
	examineDescription: "A test space.",
	holder: { row: 1, col: 1 },
};

const TEST_CONTENT_PACK = makeTestPack([OBJECTIVE_OBJECT, OBJECTIVE_SPACE], {
	wallName: "wall",
	weather: "clear",
	aiStarts: {
		red: { position: { row: 0, col: 0 } },
		green: { position: { row: 0, col: 1 } },
		cyan: { position: { row: 0, col: 2 } },
	},
});

function makeProvider() {
	return new MockRoundLLMProvider([
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
	]);
}

function makeBaseGame() {
	const base = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 99 });
	return {
		...base,
		world: {
			entities: [OBJECTIVE_OBJECT, OBJECTIVE_SPACE],
		},
		personaSpatial: TEST_CONTENT_PACK.aiStarts as typeof base.personaSpatial,
	};
}

function makeWeatherChangeRng() {
	let callCount = 0;
	return () => {
		callCount += 1;
		if (callCount === 1) {
			return 0.0;
		}
		if (callCount === 2) {
			return 0.1;
		}
		return Math.random();
	};
}

describe("runRound — weather_change complication (issue #487)", () => {
	it("changes game.weather to a different WEATHER_POOL entry", async () => {
		const game = makeBaseGame();
		const initialWeather = game.weather;

		const withCountdown = {
			...game,
			complicationSchedule: { ...game.complicationSchedule, countdown: 0 },
		};

		const { nextState } = await runRound(
			withCountdown,
			"red",
			"hi",
			makeProvider(),
			{ rng: makeWeatherChangeRng() },
		);

		expect(nextState.weather).not.toBe(initialWeather);
		expect(WEATHER_POOL).toContain(nextState.weather);
	});

	it("updates both game.weather and game.contentPack.weather consistently", async () => {
		const game = makeBaseGame();

		const withCountdown = {
			...game,
			complicationSchedule: { ...game.complicationSchedule, countdown: 0 },
		};

		const { nextState } = await runRound(
			withCountdown,
			"red",
			"hi",
			makeProvider(),
			{ rng: makeWeatherChangeRng() },
		);

		expect(nextState.weather).toBe(nextState.contentPack.weather);
	});

	it("appends a broadcast entry to all Daemons' conversationLogs", async () => {
		const game = makeBaseGame();

		const withCountdown = {
			...game,
			complicationSchedule: { ...game.complicationSchedule, countdown: 0 },
		};

		const { nextState } = await runRound(
			withCountdown,
			"red",
			"hi",
			makeProvider(),
			{ rng: makeWeatherChangeRng() },
		);

		for (const aiId of Object.keys(TEST_PERSONAS)) {
			const log = nextState.conversationLogs[aiId] ?? [];
			const broadcasts = log.filter((e) => e.kind === "broadcast");

			expect(broadcasts.length).toBeGreaterThan(0);

			const weatherBroadcast = broadcasts.find(
				(b) =>
					b.kind === "broadcast" && b.content.includes("weather has changed"),
			);
			expect(weatherBroadcast).toBeDefined();

			if (weatherBroadcast?.kind === "broadcast") {
				expect(weatherBroadcast.content).toContain(nextState.weather);
			}
		}
	});

	it("resets the complication countdown after weather_change fires", async () => {
		const game = makeBaseGame();
		const withCountdown = {
			...game,
			complicationSchedule: { ...game.complicationSchedule, countdown: 0 },
		};

		const { nextState } = await runRound(
			withCountdown,
			"red",
			"hi",
			makeProvider(),
			{ rng: makeWeatherChangeRng() },
		);

		expect(nextState.complicationSchedule.countdown).toBeGreaterThan(0);
		expect(nextState.complicationSchedule.countdown).toBeLessThanOrEqual(15);
	});

	it("does not change other game state properties (setting, timeOfDay, etc.)", async () => {
		const game = makeBaseGame();
		const initialSetting = game.setting;
		const initialTimeOfDay = game.timeOfDay;
		const initialActivePackId = game.activePackId;

		const withCountdown = {
			...game,
			complicationSchedule: { ...game.complicationSchedule, countdown: 0 },
		};

		const { nextState } = await runRound(
			withCountdown,
			"red",
			"hi",
			makeProvider(),
			{ rng: makeWeatherChangeRng() },
		);

		expect(nextState.setting).toBe(initialSetting);
		expect(nextState.timeOfDay).toBe(initialTimeOfDay);
		expect(nextState.activePackId).toBe(initialActivePackId);
	});
});
