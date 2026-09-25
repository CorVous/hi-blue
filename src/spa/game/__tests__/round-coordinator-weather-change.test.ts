import { describe, expect, it } from "vitest";
import { WEATHER_POOL } from "../../../content/pools";
import { runRound } from "../round-coordinator";
import type { WorldEntity } from "../types";
import {
	makeSilentProvider,
	makeTestGame,
	ROW_AI_STARTS,
	seededRng,
	TEST_PERSONAS,
	withPackOrderedWorld,
} from "./fixtures/make-game-state";

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

const WEATHER_CHANGE_DRAWS = [0.0, 0.1];

function makeBaseGame() {
	return withPackOrderedWorld(
		makeTestGame({
			entities: [OBJECTIVE_OBJECT, OBJECTIVE_SPACE],
			pack: { weather: "clear", aiStarts: ROW_AI_STARTS },
			budgetPerAi: 99,
		}),
	);
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
			makeSilentProvider(),
			{ rng: seededRng(WEATHER_CHANGE_DRAWS, Math.random) },
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
			makeSilentProvider(),
			{ rng: seededRng(WEATHER_CHANGE_DRAWS, Math.random) },
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
			makeSilentProvider(),
			{ rng: seededRng(WEATHER_CHANGE_DRAWS, Math.random) },
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
			makeSilentProvider(),
			{ rng: seededRng(WEATHER_CHANGE_DRAWS, Math.random) },
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
			makeSilentProvider(),
			{ rng: seededRng(WEATHER_CHANGE_DRAWS, Math.random) },
		);

		expect(nextState.setting).toBe(initialSetting);
		expect(nextState.timeOfDay).toBe(initialTimeOfDay);
		expect(nextState.activePackId).toBe(initialActivePackId);
	});
});
