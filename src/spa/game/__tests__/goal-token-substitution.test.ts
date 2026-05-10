import { describe, expect, it } from "vitest";
import { createGame, getActivePhase, startPhase } from "../engine";
import type {
	AiPersona,
	ContentPack,
	ObjectivePair,
	PhaseConfig,
	WorldEntity,
} from "../types";

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

function pair(
	objectName: string,
	spaceName: string,
	idSuffix = "",
): ObjectivePair {
	return {
		object: {
			id: `obj${idSuffix}`,
			kind: "objective_object",
			name: objectName,
			examineDescription: "",
			holder: { row: 0, col: 0 },
			pairsWithSpaceId: `space${idSuffix}`,
		},
		space: {
			id: `space${idSuffix}`,
			kind: "objective_space",
			name: spaceName,
			examineDescription: "",
			holder: { row: 4, col: 4 },
		},
	};
}

function misc(name: string, id = name): WorldEntity {
	return {
		id,
		kind: "interesting_object",
		name,
		examineDescription: "",
		holder: { row: 0, col: 1 },
	};
}

function obstacle(name: string, id = name): WorldEntity {
	return {
		id,
		kind: "obstacle",
		name,
		examineDescription: "",
		holder: { row: 2, col: 2 },
	};
}

function makePack(overrides: Partial<ContentPack>): ContentPack {
	return {
		phaseNumber: 1,
		setting: "",
		weather: "",
		timeOfDay: "",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		aiStarts: {
			red: { position: { row: 0, col: 0 }, facing: "north" },
		},
		...overrides,
	};
}

function configWith(pool: string[]): PhaseConfig {
	return {
		phaseNumber: 1,
		kRange: [1, 1],
		nRange: [1, 1],
		mRange: [0, 0],
		aiGoalPool: pool,
		budgetPerAi: 5,
	};
}

function goalFor(
	personas: Record<string, AiPersona>,
	pack: ContentPack | null,
	pool: string[],
	rng?: () => number,
): string {
	const game = startPhase(
		createGame(personas, pack ? [pack] : []),
		configWith(pool),
		rng,
	);
	const phase = getActivePhase(game);
	// biome-ignore lint/style/noNonNullAssertion: test setup guarantees red has a goal
	return phase.aiGoals.red!;
}

/** Seeded RNG that walks a fixed sequence — makes token expansion deterministic. */
function seq(values: number[]): () => number {
	let i = 0;
	return () => {
		const v = values[i % values.length] ?? 0;
		i += 1;
		return v;
	};
}

describe("goal token substitution", () => {
	it("replaces {objectiveItem} with an objective_object name from the pack", () => {
		const pack = makePack({
			objectivePairs: [pair("lantern", "lantern alcove")],
		});
		const goal = goalFor(PERSONAS, pack, ["Hold the {objectiveItem} first."]);
		expect(goal).toBe("Hold the lantern first.");
	});

	it("replaces {objective} with an objective_space name from the pack", () => {
		const pack = makePack({
			objectivePairs: [pair("lantern", "lantern alcove")],
		});
		const goal = goalFor(PERSONAS, pack, ["Stand at the {objective}."]);
		expect(goal).toBe("Stand at the lantern alcove.");
	});

	it("replaces {miscItem} with an interesting_object name from the pack", () => {
		const pack = makePack({
			interestingObjects: [misc("compass")],
		});
		const goal = goalFor(PERSONAS, pack, ["Examine the {miscItem}."]);
		expect(goal).toBe("Examine the compass.");
	});

	it("replaces {obstacle} with an obstacle name from the pack", () => {
		const pack = makePack({
			obstacles: [obstacle("rusted gate")],
		});
		const goal = goalFor(PERSONAS, pack, ["Avoid the {obstacle}."]);
		expect(goal).toBe("Avoid the rusted gate.");
	});

	it("draws each token occurrence independently", () => {
		const pack = makePack({
			interestingObjects: [misc("compass"), misc("lantern")],
		});
		// RNG sequence: goal-pool draw (1 entry → idx 0), then two miscItem draws.
		// 0.5 * 2 = 1 → lantern; 0.0 * 2 = 0 → compass.
		const rng = seq([0.0, 0.5, 0.0]);
		const goal = goalFor(
			PERSONAS,
			pack,
			["Take the {miscItem} to the {miscItem}."],
			rng,
		);
		expect(goal).toBe("Take the lantern to the compass.");
	});

	it("passes untemplated goals through verbatim", () => {
		const pack = makePack({
			objectivePairs: [pair("lantern", "lantern alcove")],
			interestingObjects: [misc("compass")],
			obstacles: [obstacle("rusted gate")],
		});
		const goal = goalFor(PERSONAS, pack, ["Stand on the same tile as another Daemon."]);
		expect(goal).toBe("Stand on the same tile as another Daemon.");
	});

	it("leaves a token literal when the pack has no entities of that kind", () => {
		const pack = makePack({ obstacles: [] });
		const goal = goalFor(PERSONAS, pack, ["Avoid the {obstacle}."]);
		expect(goal).toBe("Avoid the {obstacle}.");
	});

	it("leaves all tokens literal when the game has no ContentPack for the phase", () => {
		const goal = goalFor(PERSONAS, null, [
			"Hold the {objectiveItem} at the {objective}, ignoring the {miscItem} and {obstacle}.",
		]);
		expect(goal).toBe(
			"Hold the {objectiveItem} at the {objective}, ignoring the {miscItem} and {obstacle}.",
		);
	});
});
