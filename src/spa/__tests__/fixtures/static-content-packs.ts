import type { ContentPack, ObjectiveType, WorldEntity } from "../../game/types";

export const STATIC_OBJECTIVE_TYPES: ObjectiveType[] = ["carry"];

const AI_STARTS: ContentPack["aiStarts"] = {
	red: { position: { row: 0, col: 0 } },
	green: { position: { row: 0, col: 1 } },
	cyan: { position: { row: 0, col: 2 } },
};

export const STATIC_CONTENT_PACK_NO_PAIRS: ContentPack = {
	setting: "abandoned subway station",
	weather: "",
	timeOfDay: "",
	entities: [],
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
		wallName: "laboratory bulkhead",
		aiStarts: AI_STARTS,
	},
];
