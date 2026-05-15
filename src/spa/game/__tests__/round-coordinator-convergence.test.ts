/**
 * Unit tests for the round-coordinator's end-of-round convergence evaluation
 * block (step 4d).
 *
 * Issue #305: ConvergenceObjective — fans witnessed-convergence entries to every
 * Daemon whose cone contains the space cell, flips satisfactionState to
 * "satisfied" on tier-2, and guards against re-triggering already-satisfied
 * objectives.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
import { startGame } from "../engine";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type {
	AiPersona,
	ContentPack,
	ConvergenceObjective,
	WorldEntity,
} from "../types";

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

// Space entity at (4,4) — used as the convergence point.
const CONVERGENCE_SPACE: WorldEntity = {
	id: "altar_space",
	kind: "objective_space",
	name: "Stone Altar",
	examineDescription: "A weathered stone altar.",
	holder: { row: 4, col: 4 },
	convergenceTier1Flavor: "A single presence lingers at the Stone Altar.",
	convergenceTier2Flavor: "Two presences converge at the Stone Altar.",
	convergenceTier1ActorFlavor:
		"You linger at the Stone Altar; the air seems to wait.",
	convergenceTier2ActorFlavor:
		"You stand at the Stone Altar; another presence shares the place.",
};

// Paired object (required by ContentPack.objectivePairs).
const CONVERGENCE_OBJECT: WorldEntity = {
	id: "altar_obj",
	kind: "objective_object",
	name: "Altar Stone",
	examineDescription: "A small stone for the Stone Altar.",
	holder: { row: 0, col: 0 },
	pairsWithSpaceId: "altar_space",
	placementFlavor: "{actor} places it on the altar.",
};

const TEST_CONTENT_PACK: ContentPack = {
	setting: "",
	weather: "",
	timeOfDay: "",
	objectivePairs: [{ object: CONVERGENCE_OBJECT, space: CONVERGENCE_SPACE }],
	interestingObjects: [],
	obstacles: [],
	landmarks: DEFAULT_LANDMARKS,
	wallName: "wall",
	// red at (4,4), green at (0,0), cyan at (0,2)
	// cyan faces south so (4,4) is not in its cone.
	aiStarts: {
		red: { position: { row: 4, col: 4 }, facing: "north" },
		green: { position: { row: 0, col: 0 }, facing: "south" },
		cyan: { position: { row: 0, col: 2 }, facing: "south" },
	},
};

/** A ConvergenceObjective pointing at altar_space. */
const CONVERGENCE_OBJECTIVE: ConvergenceObjective = {
	id: "obj-conv",
	kind: "convergence",
	description: "Two Daemons must share the Stone Altar.",
	satisfactionState: "pending",
	spaceId: "altar_space",
};

function makeProvider() {
	return new MockRoundLLMProvider([
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
	]);
}

/**
 * Build a base game state, then overlay the objectives and spatial positions we need.
 *
 * - red at (4,4) facing north  → red's own cell = space cell; red witnesses
 * - green at (0,0) facing south → cone is (0,0)…(2,2); does NOT contain (4,4)
 * - cyan at (0,2) facing south  → cone is (0,2)…(2,4); does NOT contain (4,4)
 */
function makeBaseGame() {
	const base = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 99 });
	// Override objectives with the convergence one.
	return {
		...base,
		objectives: [CONVERGENCE_OBJECTIVE],
		// Ensure world has the space entity at its known cell.
		world: {
			entities: [CONVERGENCE_OBJECT, CONVERGENCE_SPACE],
		},
		// Use the aiStarts layout from TEST_CONTENT_PACK (startGame already applied
		// these from aiStarts, but we re-assert them here for clarity / safety).
		personaSpatial: TEST_CONTENT_PACK.aiStarts as typeof base.personaSpatial,
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runRound — convergence evaluation (step 4d)", () => {
	it("tier-1: one Daemon on the space → witnessed-convergence tier-1 entry in their log", async () => {
		// red at (4,4) — on the space.  green + cyan elsewhere and facing away.
		const game = makeBaseGame();

		const { nextState } = await runRound(game, "red", "hi", makeProvider());

		const redLog = nextState.conversationLogs.red ?? [];
		const convergenceEntries = redLog.filter(
			(e) => e.kind === "witnessed-convergence",
		);
		expect(convergenceEntries).toHaveLength(1);
		const entry = convergenceEntries[0];
		expect(entry?.kind).toBe("witnessed-convergence");
		if (entry?.kind === "witnessed-convergence") {
			expect(entry.tier).toBe(1);
			expect(entry.spaceId).toBe("altar_space");
			// red is the sole occupant → first-person actor flavor (#336).
			expect(entry.audience).toBe("actor");
			expect(entry.flavor).toBe(CONVERGENCE_SPACE.convergenceTier1ActorFlavor);
		}
	});

	it("tier-1: a Daemon whose cone does NOT contain the space cell does NOT receive an entry", async () => {
		// green at (0,0) facing south; cyan at (0,2) facing south.
		// Neither cone reaches (4,4).
		const game = makeBaseGame();

		const { nextState } = await runRound(game, "red", "hi", makeProvider());

		const greenLog = nextState.conversationLogs.green ?? [];
		const cyanLog = nextState.conversationLogs.cyan ?? [];

		const greenConvergence = greenLog.filter(
			(e) => e.kind === "witnessed-convergence",
		);
		const cyanConvergence = cyanLog.filter(
			(e) => e.kind === "witnessed-convergence",
		);

		expect(greenConvergence).toHaveLength(0);
		expect(cyanConvergence).toHaveLength(0);
	});

	it("tier-1: satisfactionState remains 'pending' after one Daemon on the space", async () => {
		const game = makeBaseGame();

		const { nextState } = await runRound(game, "red", "hi", makeProvider());

		const convergenceObj = nextState.objectives.find(
			(o) => o.kind === "convergence",
		);
		expect(convergenceObj?.satisfactionState).toBe("pending");
	});

	it("tier-2: two Daemons on the space → witnessed-convergence tier-2 entries and satisfactionState flips to 'satisfied'", async () => {
		// Move green to (4,4) as well so we have two Daemons on the space.
		const baseGame = makeBaseGame();
		const game = {
			...baseGame,
			personaSpatial: {
				...baseGame.personaSpatial,
				// red at (4,4) facing north (from base), green also at (4,4) facing north
				green: { position: { row: 4, col: 4 }, facing: "north" as const },
				// cyan stays at (0,2) facing south — cone doesn't reach (4,4)
			},
		};

		const { nextState } = await runRound(game, "red", "hi", makeProvider());

		// Both red and green are on the space — both should witness tier-2.
		const redLog = nextState.conversationLogs.red ?? [];
		const greenLog = nextState.conversationLogs.green ?? [];
		const cyanLog = nextState.conversationLogs.cyan ?? [];

		const redConvergence = redLog.filter(
			(e) => e.kind === "witnessed-convergence",
		);
		const greenConvergence = greenLog.filter(
			(e) => e.kind === "witnessed-convergence",
		);
		const cyanConvergence = cyanLog.filter(
			(e) => e.kind === "witnessed-convergence",
		);

		expect(redConvergence).toHaveLength(1);
		if (redConvergence[0]?.kind === "witnessed-convergence") {
			expect(redConvergence[0].tier).toBe(2);
			// red is an occupant → first-person actor flavor (#336).
			expect(redConvergence[0].audience).toBe("actor");
			expect(redConvergence[0].flavor).toBe(
				CONVERGENCE_SPACE.convergenceTier2ActorFlavor,
			);
		}

		expect(greenConvergence).toHaveLength(1);
		if (greenConvergence[0]?.kind === "witnessed-convergence") {
			expect(greenConvergence[0].tier).toBe(2);
			expect(greenConvergence[0].audience).toBe("actor");
			expect(greenConvergence[0].flavor).toBe(
				CONVERGENCE_SPACE.convergenceTier2ActorFlavor,
			);
		}

		// cyan's cone at (0,2) facing south does not include (4,4).
		expect(cyanConvergence).toHaveLength(0);

		// satisfactionState must flip to "satisfied".
		const convergenceObj = nextState.objectives.find(
			(o) => o.kind === "convergence",
		);
		expect(convergenceObj?.satisfactionState).toBe("satisfied");
	});

	it("re-trigger guard: a third round with both Daemons still on the space does NOT add new convergence entries", async () => {
		// Round 1: two Daemons on the space → objective satisfied.
		const baseGame = makeBaseGame();
		const gameTwoOnSpace = {
			...baseGame,
			personaSpatial: {
				...baseGame.personaSpatial,
				green: { position: { row: 4, col: 4 }, facing: "north" as const },
			},
		};

		const { nextState: afterRound1 } = await runRound(
			gameTwoOnSpace,
			"red",
			"hi",
			makeProvider(),
		);

		// Confirm satisfied after round 1.
		const obj1 = afterRound1.objectives.find((o) => o.kind === "convergence");
		expect(obj1?.satisfactionState).toBe("satisfied");

		// Count convergence entries after round 1.
		const redCountAfterRound1 = (afterRound1.conversationLogs.red ?? []).filter(
			(e) => e.kind === "witnessed-convergence",
		).length;
		expect(redCountAfterRound1).toBeGreaterThanOrEqual(1);

		// Round 2: run again with same spatial layout (both still on the space).
		const { nextState: afterRound2 } = await runRound(
			afterRound1,
			"red",
			"hi",
			makeProvider(),
		);

		// Objective must still be satisfied, not re-triggered.
		const obj2 = afterRound2.objectives.find((o) => o.kind === "convergence");
		expect(obj2?.satisfactionState).toBe("satisfied");

		// No NEW convergence entries must have been appended.
		const redCountAfterRound2 = (afterRound2.conversationLogs.red ?? []).filter(
			(e) => e.kind === "witnessed-convergence",
		).length;
		expect(redCountAfterRound2).toBe(redCountAfterRound1);
	});
});

describe("runRound — convergence split fan-out (actor vs witness) — #336", () => {
	it("tier-1: the sole occupant gets the actor flavor; a non-occupant cone-witness gets the witness flavor", async () => {
		// red on the space at (4,4). Move cyan to (3,4) facing south so cyan's
		// cone covers (4,4) but cyan is NOT on the cell. green stays at (0,0)
		// facing south — out of cone.
		const baseGame = makeBaseGame();
		const game = {
			...baseGame,
			personaSpatial: {
				...baseGame.personaSpatial,
				cyan: { position: { row: 3, col: 4 }, facing: "south" as const },
			},
		};

		const { nextState } = await runRound(game, "red", "hi", makeProvider());

		const redEntry = (nextState.conversationLogs.red ?? []).find(
			(e) => e.kind === "witnessed-convergence",
		);
		expect(redEntry).toBeDefined();
		if (redEntry?.kind === "witnessed-convergence") {
			expect(redEntry.audience).toBe("actor");
			expect(redEntry.flavor).toBe(
				CONVERGENCE_SPACE.convergenceTier1ActorFlavor,
			);
		}

		const cyanEntry = (nextState.conversationLogs.cyan ?? []).find(
			(e) => e.kind === "witnessed-convergence",
		);
		expect(cyanEntry).toBeDefined();
		if (cyanEntry?.kind === "witnessed-convergence") {
			expect(cyanEntry.audience).toBe("witness");
			expect(cyanEntry.flavor).toBe(CONVERGENCE_SPACE.convergenceTier1Flavor);
		}
	});

	it("tier-2: every occupant gets the actor flavor; a non-occupant cone-witness gets the witness flavor", async () => {
		// red and green both at (4,4). cyan at (3,4) facing south — cone covers (4,4)
		// but cyan is not on the cell.
		const baseGame = makeBaseGame();
		const game = {
			...baseGame,
			personaSpatial: {
				red: { position: { row: 4, col: 4 }, facing: "north" as const },
				green: { position: { row: 4, col: 4 }, facing: "north" as const },
				cyan: { position: { row: 3, col: 4 }, facing: "south" as const },
			},
		};

		const { nextState } = await runRound(game, "red", "hi", makeProvider());

		for (const aiId of ["red", "green"] as const) {
			const entry = (nextState.conversationLogs[aiId] ?? []).find(
				(e) => e.kind === "witnessed-convergence",
			);
			expect(entry).toBeDefined();
			if (entry?.kind === "witnessed-convergence") {
				expect(entry.audience).toBe("actor");
				expect(entry.flavor).toBe(
					CONVERGENCE_SPACE.convergenceTier2ActorFlavor,
				);
			}
		}

		const cyanEntry = (nextState.conversationLogs.cyan ?? []).find(
			(e) => e.kind === "witnessed-convergence",
		);
		expect(cyanEntry).toBeDefined();
		if (cyanEntry?.kind === "witnessed-convergence") {
			expect(cyanEntry.audience).toBe("witness");
			expect(cyanEntry.flavor).toBe(CONVERGENCE_SPACE.convergenceTier2Flavor);
		}
	});

	it("no double-emission: a Daemon standing on the space receives exactly one entry (the actor variant)", async () => {
		// red is on the space and faces north so red's own cone trivially covers
		// (4,4) too — verify red does NOT receive both actor and witness entries.
		const game = makeBaseGame();

		const { nextState } = await runRound(game, "red", "hi", makeProvider());

		const redConvergence = (nextState.conversationLogs.red ?? []).filter(
			(e) => e.kind === "witnessed-convergence",
		);
		expect(redConvergence).toHaveLength(1);
		if (redConvergence[0]?.kind === "witnessed-convergence") {
			expect(redConvergence[0].audience).toBe("actor");
		}
	});
});
