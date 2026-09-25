import { describe, expect, it } from "vitest";
import { runRound } from "../round-coordinator";
import type { WorldEntity } from "../types";
import {
	makeSilentProvider,
	makeTestGame,
	seededRng,
	withPackOrderedWorld,
} from "./fixtures/make-game-state";

const OBSTACLE: WorldEntity = {
	id: "wall_ob",
	kind: "obstacle",
	name: "Stone Wall",
	examineDescription: "A weathered stone wall.",
	holder: { row: 2, col: 2 },
	shiftFlavor: "The stone wall shifts one cell, scraping stone against stone.",
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

function makeBaseGame() {
	return withPackOrderedWorld(
		makeTestGame({
			entities: [OBJECTIVE_OBJECT, OBJECTIVE_SPACE, OBSTACLE],
			pack: {
				aiStarts: {
					red: { position: { row: 2, col: 1 } },
					green: { position: { row: 1, col: 4 } },
					cyan: { position: { row: 4, col: 0 } },
				},
			},
			budgetPerAi: 99,
		}),
	);
}

describe("runRound — obstacle_shift complication (issue #486)", () => {
	it("moves the obstacle entity from fromCell to toCell in world.entities", async () => {
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
			{ rng: seededRng([0.5, 0], Math.random) },
		);

		const obstacleAfter = nextState.world.entities.find(
			(e) => e.id === "wall_ob",
		);
		expect(obstacleAfter).toBeDefined();

		if (obstacleAfter && typeof obstacleAfter.holder === "object") {
			const obstacleHolder = obstacleAfter.holder as {
				row: number;
				col: number;
			};
			const origHolder =
				typeof OBSTACLE.holder === "object"
					? (OBSTACLE.holder as { row: number; col: number })
					: { row: 2, col: 2 };
			const dx = Math.abs(obstacleHolder.row - origHolder.row);
			const dy = Math.abs(obstacleHolder.col - origHolder.col);
			expect(dx + dy).toBe(1);
		} else {
			expect.fail("Obstacle holder is not a GridPosition after shift.");
		}
	});

	it("appends witnessed-obstacle-shift entry to a daemon whose Vista contains fromCell", async () => {
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
			{ rng: seededRng([0.5, 0], Math.random) },
		);

		const redLog = nextState.conversationLogs.red ?? [];
		const shiftEntries = redLog.filter(
			(e) => e.kind === "witnessed-obstacle-shift",
		);

		expect(shiftEntries.length).toBeGreaterThan(0);

		const entry = shiftEntries[0];
		if (entry?.kind === "witnessed-obstacle-shift") {
			expect(entry.obstacleId).toBe("wall_ob");
			expect(entry.flavor).toBe(OBSTACLE.shiftFlavor);
			expect(entry.round).toBe(nextState.round);
			expect(entry.fromCell).toEqual({ row: 2, col: 2 });
			expect(
				Math.abs(entry.toCell.row - 2) + Math.abs(entry.toCell.col - 2),
			).toBe(1);
		}
	});

	it("does NOT append witnessed-obstacle-shift entry to a daemon whose Vista does NOT contain fromCell", async () => {
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
			{ rng: seededRng([0.5, 0], Math.random) },
		);

		const cyanLog = nextState.conversationLogs.cyan ?? [];
		const shiftEntries = cyanLog.filter(
			(e) => e.kind === "witnessed-obstacle-shift",
		);

		expect(shiftEntries).toHaveLength(0);
	});

	it("Vista boundary: a Daemon at offset (2, 0) from the origin witnesses the shift; one at (2, 1) does not", async () => {
		const game = makeBaseGame();
		const withCountdown = {
			...game,
			personaSpatial: {
				...game.personaSpatial,
				red: { position: { row: 2, col: 0 } },
				green: { position: { row: 1, col: 0 } },
			},
			complicationSchedule: { ...game.complicationSchedule, countdown: 0 },
		};

		const { nextState } = await runRound(
			withCountdown,
			"red",
			"hi",
			makeSilentProvider(),
			{ rng: seededRng([0.5, 0], Math.random) },
		);

		expect(
			(nextState.conversationLogs.red ?? []).filter(
				(e) => e.kind === "witnessed-obstacle-shift",
			),
		).toHaveLength(1);
		expect(
			(nextState.conversationLogs.green ?? []).filter(
				(e) => e.kind === "witnessed-obstacle-shift",
			),
		).toHaveLength(0);
	});

	it("resets the complication countdown after obstacle_shift fires", async () => {
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
			{ rng: seededRng([0.5, 0], Math.random) },
		);

		expect(nextState.complicationSchedule.countdown).toBeGreaterThan(0);
	});
});
