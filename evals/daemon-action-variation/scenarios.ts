/**
 * Static test scenarios for the daemon-action-variation eval harness.
 *
 * Each scenario is a (ContentPack, AiId, seedMessages) tuple plus a name
 * and the conversational stimulus used to set the starting prompt state.
 * The harness re-initialises a fresh GameState from the tuple for every
 * repetition, so the LLM always sees identical context across the 20
 * calls that make up the per-scenario probability distribution.
 *
 * The three scenarios target the action-tool surface in different shapes:
 *
 *  1. EXPLORATION — daemon stands empty-handed in a room full of unknown
 *     items, no objective in their immediate cone. Tests examine vs go
 *     balance and the per-temperament action profile signal.
 *  2. OBJECTIVE — daemon is holding the objective item with the paired
 *     space directly in front of them. Tests whether they reach for
 *     `use` (critical-path tool for objective completion).
 *  3. SOCIAL — peer just messaged the daemon, daemon has action options.
 *     Tests message+action parallel emission and recipient targeting.
 *
 * An earlier `EXAMINATION` scenario was dropped after the 5-tool surface
 * change made it redundant — with `examine` removed and descriptions
 * auto-shown, "daemon next to an interesting item" no longer tests
 * anything that the other three scenarios don't already cover, and the
 * cell rates pinned at 95-100% across personas (always pick_up).
 */

import { DEFAULT_LANDMARKS } from "../../src/spa/game/direction.js";
import type { AiId, ContentPack } from "../../src/spa/game/types.js";

const LANDMARKS = DEFAULT_LANDMARKS;
const WALL_NAME = "tiled tunnel wall";

const ACTOR: AiId = "red";
const PEER_A: AiId = "sim1";
const PEER_B: AiId = "sim2";

/** Shared peer placements — kept off the actor's front arc so peers don't
 * accidentally trigger `give` opportunities the scenario isn't testing. */
const AI_STARTS_BASE: ContentPack["aiStarts"] = {
	[ACTOR]: { position: { row: 2, col: 2 }, facing: "north" },
	[PEER_A]: { position: { row: 4, col: 0 }, facing: "east" },
	[PEER_B]: { position: { row: 4, col: 4 }, facing: "west" },
};

// ── Scenario 1: EXPLORATION ──────────────────────────────────────────────────

/**
 * Daemon stands empty-handed in the centre of a 5×5 grid, with three
 * unknown items inside the cone (clipboard, panel, switchbox). No
 * objective directly in front. The conversational stimulus is open-ended
 * — "what do you see?" — so the daemon must choose between describing
 * (message), exploring (go/look), or investigating (examine/pick_up).
 */
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
		landmarks: LANDMARKS,
		wallName: WALL_NAME,
		aiStarts: AI_STARTS_BASE,
	};
}

// ── Scenario 2: OBJECTIVE ────────────────────────────────────────────────────

/**
 * Daemon is *already holding* the objective item (`flashlight`) and the
 * paired space (`wall_mount`) is in the cell directly in front of them.
 * A `use` call places the item on the mount and would complete the
 * objective. Tests whether the daemon reaches for the critical-path
 * tool even when the conversation doesn't demand it.
 */
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
		landmarks: LANDMARKS,
		wallName: WALL_NAME,
		aiStarts: AI_STARTS_BASE,
	};
}

// ── Scenario 3: SOCIAL ───────────────────────────────────────────────────────

/**
 * Peer just messaged the daemon. Items are in the cone (so go/examine
 * are valid). Tests whether daemons emit a parallel message+action turn.
 */
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
		landmarks: LANDMARKS,
		wallName: WALL_NAME,
		aiStarts: AI_STARTS_BASE,
	};
}

// ── Scenario assembly ────────────────────────────────────────────────────────

type ScenarioName = "exploration" | "objective" | "social";

export interface Scenario {
	name: ScenarioName;
	description: string;
	actor: AiId;
	peers: AiId[];
	pack: ContentPack;
	/**
	 * Seed messages to append before the daemon's first turn. Each entry is
	 * fed through `appendMessage(game, from, to, content)` so it lands in
	 * the daemon's conversation log just like a live game would deliver it.
	 *
	 * Round numbers are not specified here — the harness writes each entry
	 * at the current `game.round` value (round 1 after `advanceRound`).
	 */
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
				"Empty-handed, three unknown items in cone. Tests face vs go balance.",
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
				"Holding objective item, paired space directly ahead. Tests `use` emission.",
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
