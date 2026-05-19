import { DEFAULT_LANDMARKS } from "../../game/direction";
import type { ContentPack, ObjectiveType, WorldEntity } from "../../game/types";

/**
 * Objective types matching the type-first entity IDs in STATIC_CONTENT_PACKS[0].
 * Pass to GameSession / startGame when you need carry objectives to be active.
 */
export const STATIC_OBJECTIVE_TYPES: ObjectiveType[] = ["carry"];

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
	setting: "abandoned subway station",
	weather: "",
	timeOfDay: "",
	entities: [],
	landmarks: DEFAULT_LANDMARKS,
	wallName: "tunnel wall",
	aiStarts: AI_STARTS,
};

const carryPairEntities = (
	objId: string,
	objName: string,
	objExamine: string,
	spaceId: string,
	spaceName: string,
	spaceExamine: string,
	objHolder = { row: 3, col: 3 },
	spaceHolder = { row: 4, col: 4 },
): WorldEntity[] => [
	{
		id: objId,
		kind: "objective_object",
		name: objName,
		examineDescription: objExamine,
		holder: objHolder,
		pairsWithSpaceId: spaceId,
	},
	{
		id: spaceId,
		kind: "objective_space",
		name: spaceName,
		examineDescription: spaceExamine,
		holder: spaceHolder,
	},
];

/**
 * Minimal content packs for all three phases used by tests that need a
 * fully-bootstrapped game session without a real LLM call.
 */
export const STATIC_CONTENT_PACKS: ContentPack[] = [
	{
		setting: "abandoned subway station",
		weather: "",
		timeOfDay: "",
		entities: carryPairEntities(
			"carry-0-obj",
			"cracked lantern",
			"A cracked lantern",
			"carry-0-space",
			"maintenance alcove",
			"A small alcove",
		),
		landmarks: DEFAULT_LANDMARKS,
		wallName: "tunnel wall",
		aiStarts: AI_STARTS,
	},
	{
		setting: "sun-baked salt flat",
		weather: "",
		timeOfDay: "",
		entities: carryPairEntities(
			"phase2_obj",
			"rusted compass",
			"A rusted compass",
			"phase2_space",
			"survey marker",
			"A survey marker",
		),
		landmarks: DEFAULT_LANDMARKS,
		wallName: "salt flat boundary",
		aiStarts: AI_STARTS,
	},
	{
		setting: "forgotten laboratory",
		weather: "",
		timeOfDay: "",
		entities: carryPairEntities(
			"phase3_obj",
			"sealed vial",
			"A sealed vial",
			"phase3_space",
			"sample rack",
			"A sample rack",
		),
		landmarks: DEFAULT_LANDMARKS,
		wallName: "laboratory bulkhead",
		aiStarts: AI_STARTS,
	},
];
