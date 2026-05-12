import { DEFAULT_LANDMARKS } from "../../game/direction";
import type { ContentPack } from "../../game/types";

const AI_STARTS: ContentPack["aiStarts"] = {
	red: { position: { row: 0, col: 0 }, facing: "north" },
	green: { position: { row: 0, col: 1 }, facing: "north" },
	cyan: { position: { row: 0, col: 2 }, facing: "north" },
};

/**
 * A single K=0 content pack (no objective pairs) for tests that need the game
 * to end via the vacuous win condition on the first round (#295 flat model).
 */
export const STATIC_CONTENT_PACK_NO_PAIRS: ContentPack = {
	phaseNumber: 1,
	setting: "abandoned subway station",
	weather: "",
	timeOfDay: "",
	objectivePairs: [],
	interestingObjects: [],
	obstacles: [],
	landmarks: DEFAULT_LANDMARKS,
	aiStarts: AI_STARTS,
};

/**
 * Minimal content packs for all three phases used by tests that need a
 * fully-bootstrapped game session without a real LLM call.
 */
export const STATIC_CONTENT_PACKS: ContentPack[] = [
	{
		phaseNumber: 1,
		setting: "abandoned subway station",
		weather: "",
		timeOfDay: "",
		objectivePairs: [
			{
				object: {
					id: "phase1_obj",
					kind: "objective_object",
					name: "cracked lantern",
					examineDescription: "A cracked lantern",
					holder: { row: 3, col: 3 },
					pairsWithSpaceId: "phase1_space",
				},
				space: {
					id: "phase1_space",
					kind: "objective_space",
					name: "maintenance alcove",
					examineDescription: "A small alcove",
					holder: { row: 4, col: 4 },
				},
			},
		],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: AI_STARTS,
	},
	{
		phaseNumber: 2,
		setting: "sun-baked salt flat",
		weather: "",
		timeOfDay: "",
		objectivePairs: [
			{
				object: {
					id: "phase2_obj",
					kind: "objective_object",
					name: "rusted compass",
					examineDescription: "A rusted compass",
					holder: { row: 3, col: 3 },
					pairsWithSpaceId: "phase2_space",
				},
				space: {
					id: "phase2_space",
					kind: "objective_space",
					name: "survey marker",
					examineDescription: "A survey marker",
					holder: { row: 4, col: 4 },
				},
			},
		],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: AI_STARTS,
	},
	{
		phaseNumber: 3,
		setting: "forgotten laboratory",
		weather: "",
		timeOfDay: "",
		objectivePairs: [
			{
				object: {
					id: "phase3_obj",
					kind: "objective_object",
					name: "sealed vial",
					examineDescription: "A sealed vial",
					holder: { row: 3, col: 3 },
					pairsWithSpaceId: "phase3_space",
				},
				space: {
					id: "phase3_space",
					kind: "objective_space",
					name: "sample rack",
					examineDescription: "A sample rack",
					holder: { row: 4, col: 4 },
				},
			},
		],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: AI_STARTS,
	},
];
