import type { AiId, ContentPack } from "../../src/spa/game/types.js";

const WALL_NAME = "tiled tunnel wall";

const ACTOR: AiId = "red";
const PEER_A: AiId = "sim1";
const PEER_B: AiId = "sim2";

const AI_STARTS_PEERS_OUT_OF_REACH: ContentPack["aiStarts"] = {
	[ACTOR]: { position: { row: 2, col: 2 } },
	[PEER_A]: { position: { row: 4, col: 0 } },
	[PEER_B]: { position: { row: 4, col: 4 } },
};

function makeExplorationPack(): ContentPack {
	return {
		setting: "abandoned subway station",
		weather: "damp, still air",
		timeOfDay: "no daylight — emergency strip-lights only",
		entities: [
			{
				id: "clipboard",
				kind: "interesting_object",
				name: "soggy clipboard",
				examineDescription:
					"A clipboard, paper warped from damp. Pencil-scrawl mentions 'evac drill 03:40' and a circled time.",
				useOutcome:
					"{actor} flips through the clipboard; the pages tear at the corner.",
				holder: { row: 0, col: 1 },
			},
			{
				id: "panel",
				kind: "interesting_object",
				name: "service panel",
				examineDescription:
					"A grey service panel with three labelled toggles. Two are flipped, one is loose.",
				useOutcome: "{actor} flicks the loose toggle; the panel hums briefly.",
				holder: { row: 0, col: 3 },
			},
			{
				id: "switchbox",
				kind: "interesting_object",
				name: "rusted switchbox",
				examineDescription:
					"A switchbox bolted to the wall, paint flaking. Two heavy levers, no labels.",
				useOutcome:
					"{actor} throws the larger lever; somewhere overhead a relay clicks.",
				holder: { row: 1, col: 2 },
			},
		],
		wallName: WALL_NAME,
		aiStarts: AI_STARTS_PEERS_OUT_OF_REACH,
	};
}

function makeObjectivePack(): ContentPack {
	return {
		setting: "abandoned subway station",
		weather: "damp, still air",
		timeOfDay: "no daylight — emergency strip-lights only",
		entities: [
			{
				id: "flashlight",
				kind: "objective_object",
				name: "yellow flashlight",
				examineDescription:
					"A heavy yellow flashlight, scratched and dented. The base is shaped to lock into a mount.",
				useOutcome:
					"{actor} clicks the flashlight; a weak yellow beam cuts the dark.",
				pairsWithSpaceId: "wall_mount",
				placementFlavor:
					"{actor} settles the flashlight into the wall mount; it locks with a faint click and steadies.",
				holder: ACTOR,
			},
			{
				id: "wall_mount",
				kind: "objective_space",
				name: "wall mount",
				examineDescription:
					"A spring-loaded wall mount, the kind a heavy flashlight would clip into.",
				holder: { row: 1, col: 2 },
				proximityFlavor: "the wall mount sits just ahead, primed and empty.",
			},
		],
		wallName: WALL_NAME,
		aiStarts: AI_STARTS_PEERS_OUT_OF_REACH,
	};
}

function makeSocialPack(): ContentPack {
	return {
		setting: "abandoned subway station",
		weather: "damp, still air",
		timeOfDay: "no daylight — emergency strip-lights only",
		entities: [
			{
				id: "clipboard",
				kind: "interesting_object",
				name: "soggy clipboard",
				examineDescription:
					"A clipboard, paper warped from damp. Pencil-scrawl mentions 'evac drill 03:40' and a circled time.",
				useOutcome:
					"{actor} flips through the clipboard; the pages tear at the corner.",
				holder: { row: 0, col: 1 },
			},
			{
				id: "panel",
				kind: "interesting_object",
				name: "service panel",
				examineDescription:
					"A grey service panel with three labelled toggles. Two are flipped, one is loose.",
				useOutcome: "{actor} flicks the loose toggle; the panel hums briefly.",
				holder: { row: 0, col: 3 },
			},
		],
		wallName: WALL_NAME,
		aiStarts: AI_STARTS_PEERS_OUT_OF_REACH,
	};
}

type ScenarioName = "exploration" | "objective" | "social";

export interface Scenario {
	name: ScenarioName;
	description: string;
	actor: AiId;
	peers: AiId[];
	pack: ContentPack;
	seedMessages: Array<{
		from: AiId | "blue";
		to: AiId | "blue";
		content: string;
	}>;
}

export function getScenarios(): Scenario[] {
	return [
		{
			name: "exploration",
			description:
				"Empty-handed, one unknown item in reach. Tests pick_up vs go balance.",
			actor: ACTOR,
			peers: [PEER_A, PEER_B],
			pack: makeExplorationPack(),
			seedMessages: [
				{
					from: "blue",
					to: ACTOR,
					content:
						"you're somewhere new — take a look around and let me know what you see.",
				},
			],
		},
		{
			name: "objective",
			description:
				"Holding objective item, paired space one step north. Tests `use` emission.",
			actor: ACTOR,
			peers: [PEER_A, PEER_B],
			pack: makeObjectivePack(),
			seedMessages: [
				{
					from: "blue",
					to: ACTOR,
					content:
						"that yellow flashlight you're holding — there's a mount right in front of you. think you can fit it?",
				},
			],
		},
		{
			name: "social",
			description:
				"Peer just messaged; items also visible. Tests parallel message+action emission.",
			actor: ACTOR,
			peers: [PEER_A, PEER_B],
			pack: makeSocialPack(),
			seedMessages: [
				{
					from: PEER_A,
					to: ACTOR,
					content:
						"you still over there? what's it look like from where you're standing?",
				},
			],
		},
	];
}
