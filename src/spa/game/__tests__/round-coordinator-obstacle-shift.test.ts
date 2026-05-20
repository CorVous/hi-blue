/**
 * Unit tests for the round-coordinator's obstacle_shift complication handler.
 *
 * Issue #486: obstacle_shift complication fires and:
 * 1. Moves the obstacle entity from fromCell to toCell in world.entities.
 * 2. Appends witnessed-obstacle-shift entries only to daemons whose cone covers fromCell.
 * 3. Daemons whose cone does NOT cover fromCell receive no entry.
 */
import { describe, expect, it } from "vitest";
import { startGame } from "../engine";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { AiPersona, WorldEntity } from "../types";
import { makeTestPack } from "./fixtures/make-test-pack";

// ── Fixtures ───────────────────────────────────────────────────────────────────

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

// Obstacle entity with a shiftFlavor, positioned so it has an available shift target.
const OBSTACLE: WorldEntity = {
	id: "wall_ob",
	kind: "obstacle",
	name: "Stone Wall",
	examineDescription: "A weathered stone wall.",
	holder: { row: 2, col: 2 },
	shiftFlavor: "The stone wall shifts one cell, scraping stone against stone.",
};

// For the test pack to be valid, we need at least one objective object + space pair.
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

const TEST_CONTENT_PACK = makeTestPack(
	[OBJECTIVE_OBJECT, OBJECTIVE_SPACE, OBSTACLE],
	{
		wallName: "wall",
		// red at (2, 1) facing east — cone should include (2, 2) = obstacle origin
		// green at (1, 4) facing west — cone should include (2, 2) if in range
		// cyan at (6, 6) facing north — cone should NOT include (2, 2) (too far away)
		aiStarts: {
			red: { position: { row: 2, col: 1 }, facing: "east" },
			green: { position: { row: 1, col: 4 }, facing: "west" },
			cyan: { position: { row: 6, col: 6 }, facing: "north" },
		},
	},
);

function makeProvider() {
	return new MockRoundLLMProvider([
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
	]);
}

/**
 * Build a base game with the test pack and override spatial positions.
 */
function makeBaseGame() {
	const base = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 99 });
	return {
		...base,
		world: {
			entities: [OBJECTIVE_OBJECT, OBJECTIVE_SPACE, OBSTACLE],
		},
		personaSpatial: TEST_CONTENT_PACK.aiStarts as typeof base.personaSpatial,
	};
}

/**
 * Drive an RNG sequence that deterministically fires obstacle_shift with a specific
 * fromCell → toCell move.
 *
 * The complication engine uses rng to:
 * 1. Draw from the available complications pool.
 * 2. For obstacle_shift, draw from the valid shift tuples.
 *
 * We provide a custom rng that cycles through specific values to force selection.
 */
function makeObstacleShiftRng(tupleIndex: number) {
	let callCount = 0;
	return () => {
		// First call: select obstacle_shift from the pool (return value that selects
		// obstacle_shift index in the available pool).
		// Subsequent calls: select the desired tuple within the obstacle_shift's tuples.
		// For simplicity, we'll let the engine's pool selection fall through naturally
		// and only control the tuple selection.
		callCount += 1;
		// Return a value in range [0, 1) that selects the tupleIndex-th element
		// from the available tuples. We'll return a small value to select early tuples.
		if (callCount === 1) {
			// First call: draw from complication type pool.
			// Assuming obstacle_shift is available, return a value that selects it.
			// We'll use a high value to try to select later in the pool (obstacle_shift).
			return 0.5; // This will be used by tickComplication to select from available complications.
		}
		if (callCount === 2) {
			// Second call: draw tuple index from the shift tuples for the selected obstacle.
			// Return a value that selects the desired tuple.
			return tupleIndex / 100; // Scale down to ensure we select early tuples.
		}
		return Math.random();
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runRound — obstacle_shift complication (issue #486)", () => {
	it("moves the obstacle entity from fromCell to toCell in world.entities", async () => {
		const game = makeBaseGame();
		// Force countdown to 0 so complication fires.
		const withCountdown = {
			...game,
			complicationSchedule: { ...game.complicationSchedule, countdown: 0 },
		};

		const { nextState } = await runRound(
			withCountdown,
			"red",
			"hi",
			makeProvider(),
			{ rng: makeObstacleShiftRng(0) },
		);

		// Find the obstacle in the entities.
		const obstacleAfter = nextState.world.entities.find(
			(e) => e.id === "wall_ob",
		);
		expect(obstacleAfter).toBeDefined();

		// The obstacle's holder should have changed from (2, 2) to some adjacent cell.
		// We know it started at (2, 2) and the shift tuple is deterministic based on the
		// complication-engine's valid tuples. The test just verifies it moved somewhere.
		if (obstacleAfter && typeof obstacleAfter.holder === "object") {
			// Obstacle moved to a new cell. Check it's adjacent to the origin.
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
			// Adjacent means Manhattan distance = 1 (one cardinal direction).
			expect(dx + dy).toBe(1);
		} else {
			// If holder is not a GridPosition, the test fails (obstacle was picked up?).
			expect.fail("Obstacle holder is not a GridPosition after shift.");
		}
	});

	it("appends witnessed-obstacle-shift entry to a daemon whose cone covers fromCell", async () => {
		const game = makeBaseGame();
		// red is at (2, 1) facing east, so its cone should cover (2, 2) = obstacle origin.
		const withCountdown = {
			...game,
			complicationSchedule: { ...game.complicationSchedule, countdown: 0 },
		};

		const { nextState } = await runRound(
			withCountdown,
			"red",
			"hi",
			makeProvider(),
			{ rng: makeObstacleShiftRng(0) },
		);

		const redLog = nextState.conversationLogs.red ?? [];
		const shiftEntries = redLog.filter(
			(e) => e.kind === "witnessed-obstacle-shift",
		);

		// red's cone should cover the obstacle origin, so expect at least one entry.
		expect(shiftEntries.length).toBeGreaterThan(0);

		const entry = shiftEntries[0];
		if (entry?.kind === "witnessed-obstacle-shift") {
			expect(entry.obstacleId).toBe("wall_ob");
			expect(entry.flavor).toBe(OBSTACLE.shiftFlavor);
			expect(entry.round).toBe(nextState.round);
			// fromCell should be (2, 2) = obstacle's original position.
			expect(entry.fromCell).toEqual({ row: 2, col: 2 });
			// toCell should be one of the adjacent cells (exact cell depends on rng/tuples).
			expect(
				Math.abs(entry.toCell.row - 2) + Math.abs(entry.toCell.col - 2),
			).toBe(1);
		}
	});

	it("does NOT append witnessed-obstacle-shift entry to a daemon whose cone does NOT cover fromCell", async () => {
		const game = makeBaseGame();
		// cyan is at (6, 6) facing north — its cone should NOT cover (2, 2).
		const withCountdown = {
			...game,
			complicationSchedule: { ...game.complicationSchedule, countdown: 0 },
		};

		const { nextState } = await runRound(
			withCountdown,
			"red",
			"hi",
			makeProvider(),
			{ rng: makeObstacleShiftRng(0) },
		);

		const cyanLog = nextState.conversationLogs.cyan ?? [];
		const shiftEntries = cyanLog.filter(
			(e) => e.kind === "witnessed-obstacle-shift",
		);

		// cyan's cone does not cover the obstacle origin at (2, 2), so no entries.
		expect(shiftEntries).toHaveLength(0);
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
			makeProvider(),
			{ rng: makeObstacleShiftRng(0) },
		);

		// After the complication fires, applyComplicationResult resets the countdown
		// to a value in [1, 5]. It should no longer be 0.
		expect(nextState.complicationSchedule.countdown).toBeGreaterThan(0);
	});
});
