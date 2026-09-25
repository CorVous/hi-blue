import { describe, expect, it } from "vitest";
import type {
	AiTurnAction,
	CarryObjective,
	ConvergenceObjective,
	GridPosition,
	Objective,
	ObjectivePair,
	PersonaSpatialState,
	UseItemObjective,
	UseSpaceObjective,
	WorldEntity,
	WorldState,
} from "../types";
import {
	checkConvergenceTier,
	checkLoseCondition,
	checkPlacementFlavor,
	checkWinCondition,
	isCarryObjectiveSatisfied,
	isUseItemObjectiveSatisfied,
	isUseSpaceObjectiveSatisfied,
} from "../win-condition";
import { makeTestPack } from "./fixtures/make-test-pack";

type Holder = WorldEntity["holder"];
type SatisfactionState = Objective["satisfactionState"];

const SAME_CELL: GridPosition = { row: 2, col: 3 };

function byName<T extends { name: string }>(cases: T[]): Array<[string, T]> {
	return cases.map((c) => [c.name, c]);
}

function makeObjectivePair(
	objectId: string,
	spaceId: string,
	objectHolder: Holder,
	spaceHolder: Holder,
	placementFlavor = "{actor} placed the item.",
): ObjectivePair {
	return {
		object: {
			id: objectId,
			kind: "objective_object",
			name: objectId,
			examineDescription: `The ${objectId}.`,
			holder: objectHolder,
			pairsWithSpaceId: spaceId,
			placementFlavor,
		},
		space: {
			id: spaceId,
			kind: "objective_space",
			name: spaceId,
			examineDescription: `The ${spaceId}.`,
			holder: spaceHolder,
		},
	};
}

function worldFromPairs(pairs: ObjectivePair[]): WorldState {
	return { entities: pairs.flatMap((p) => [p.object, p.space]) };
}

function carryObjectiveFromPair(
	pair: ObjectivePair,
	id = "obj-0",
): CarryObjective {
	return {
		id,
		kind: "carry",
		description: `Bring the ${pair.object.name} to the ${pair.space.name}`,
		satisfactionState: "pending",
		objectId: pair.object.id,
		spaceId: pair.space.id,
	};
}

function carryObjectivesFromPairs(pairs: ObjectivePair[]): CarryObjective[] {
	return pairs.map((p, i) => carryObjectiveFromPair(p, `obj-${i}`));
}

function makeUseItemObjective(
	satisfactionState: SatisfactionState,
	id = "obj-0",
): UseItemObjective {
	return {
		id,
		kind: "use_item",
		description: "Use the torch",
		satisfactionState,
		itemId: "torch",
	};
}

function makeUseSpaceObjective(
	satisfactionState: SatisfactionState,
	id = "obj-0",
): UseSpaceObjective {
	return {
		id,
		kind: "use_space",
		description: "Use the Shrine",
		satisfactionState,
		spaceId: "shrine1",
	};
}

function makeConvergenceObjective(
	satisfactionState: SatisfactionState,
	id = "obj-conv",
): ConvergenceObjective {
	return {
		id,
		kind: "convergence",
		description: "Converge on the space",
		satisfactionState,
		spaceId: "conv-space",
	};
}

const STATE_OBJECTIVE_BUILDERS: Array<
	[string, (state: SatisfactionState) => Objective]
> = [
	["use_item", makeUseItemObjective],
	["use_space", makeUseSpaceObjective],
	["convergence", makeConvergenceObjective],
];

const STATE_EXPECTATIONS: Array<[SatisfactionState, boolean]> = [
	["pending", false],
	["satisfied", true],
];

const CARRY_CASES: Array<{
	name: string;
	objectHolder: Holder;
	spaceHolder: Holder;
	inWorld: boolean;
	expected: boolean;
}> = [
	{
		name: "true when object and space share the same cell",
		objectHolder: SAME_CELL,
		spaceHolder: SAME_CELL,
		inWorld: true,
		expected: true,
	},
	{
		name: "false when object is on a different cell than its space",
		objectHolder: { row: 0, col: 0 },
		spaceHolder: SAME_CELL,
		inWorld: true,
		expected: false,
	},
	{
		name: "false when object is held by an AI (not on the ground)",
		objectHolder: "red",
		spaceHolder: SAME_CELL,
		inWorld: true,
		expected: false,
	},
	{
		name: "false when object entity is not found in world",
		objectHolder: SAME_CELL,
		spaceHolder: SAME_CELL,
		inWorld: false,
		expected: false,
	},
];

describe.each<[string, (pair: ObjectivePair, world: WorldState) => boolean]>([
	[
		"isCarryObjectiveSatisfied",
		(pair, world) =>
			isCarryObjectiveSatisfied(carryObjectiveFromPair(pair), world),
	],
	[
		"checkWinCondition (K=1 carry)",
		(pair, world) => checkWinCondition(world, carryObjectivesFromPairs([pair])),
	],
])("%s", (_evaluator, evaluate) => {
	it.each(byName(CARRY_CASES))("returns %s", (_name, {
		objectHolder,
		spaceHolder,
		inWorld,
		expected,
	}) => {
		const pair = makeObjectivePair("obj", "spc", objectHolder, spaceHolder);
		const world = inWorld ? worldFromPairs([pair]) : { entities: [] };
		expect(evaluate(pair, world)).toBe(expected);
	});
});

describe("checkWinCondition — multiple carry pairs", () => {
	it.each(
		byName<{
			name: string;
			pairs: Array<[Holder, Holder]>;
			expected: boolean;
		}>([
			{
				name: "K=0: vacuously true when there are no objective pairs",
				pairs: [],
				expected: true,
			},
			{
				name: "K=2: true when both pairs are satisfied",
				pairs: [
					[
						{ row: 1, col: 1 },
						{ row: 1, col: 1 },
					],
					[
						{ row: 3, col: 4 },
						{ row: 3, col: 4 },
					],
				],
				expected: true,
			},
			{
				name: "K=2: false when only one pair is satisfied",
				pairs: [
					[
						{ row: 1, col: 1 },
						{ row: 1, col: 1 },
					],
					[
						{ row: 0, col: 0 },
						{ row: 3, col: 4 },
					],
				],
				expected: false,
			},
			{
				name: "AC #6: false when an object sits on a different pair's space",
				pairs: [
					[
						{ row: 3, col: 3 },
						{ row: 2, col: 2 },
					],
					[
						{ row: 3, col: 3 },
						{ row: 3, col: 3 },
					],
				],
				expected: false,
			},
		]),
	)("%s", (_name, { pairs, expected }) => {
		const objectivePairs = pairs.map(([objectHolder, spaceHolder], i) =>
			makeObjectivePair(`obj${i}`, `spc${i}`, objectHolder, spaceHolder),
		);
		expect(
			checkWinCondition(
				worldFromPairs(objectivePairs),
				carryObjectivesFromPairs(objectivePairs),
			),
		).toBe(expected);
	});
});

describe.each<[string, (state: SatisfactionState) => boolean]>([
	[
		"isUseItemObjectiveSatisfied",
		(state) => isUseItemObjectiveSatisfied(makeUseItemObjective(state)),
	],
	[
		"isUseSpaceObjectiveSatisfied",
		(state) => isUseSpaceObjectiveSatisfied(makeUseSpaceObjective(state)),
	],
])("%s", (_predicate, check) => {
	it.each(
		STATE_EXPECTATIONS,
	)("satisfactionState %s → %s", (state, expected) => {
		expect(check(state)).toBe(expected);
	});
});

describe.each(
	STATE_OBJECTIVE_BUILDERS,
)("checkWinCondition with a single %s objective", (_kind, build) => {
	it.each(STATE_EXPECTATIONS)("%s → %s", (state, expected) => {
		expect(checkWinCondition({ entities: [] }, [build(state)])).toBe(expected);
	});
});

describe("checkWinCondition with mixed carry + state objectives", () => {
	it.each<[string, boolean, Objective, boolean]>([
		[
			"carry satisfied + use_item satisfied → true",
			true,
			makeUseItemObjective("satisfied", "obj-1"),
			true,
		],
		[
			"carry satisfied + use_item pending → false",
			true,
			makeUseItemObjective("pending", "obj-1"),
			false,
		],
		[
			"carry unsatisfied + use_item satisfied → false",
			false,
			makeUseItemObjective("satisfied", "obj-1"),
			false,
		],
		[
			"carry satisfied + use_space pending → false",
			true,
			makeUseSpaceObjective("pending", "obj-1"),
			false,
		],
	])("%s", (_name, carrySatisfied, other, expected) => {
		const pair = makeObjectivePair(
			"obj",
			"spc",
			carrySatisfied ? { row: 1, col: 1 } : { row: 0, col: 0 },
			carrySatisfied ? { row: 1, col: 1 } : { row: 2, col: 2 },
		);
		const objectives: Objective[] = [carryObjectiveFromPair(pair), other];
		expect(checkWinCondition(worldFromPairs([pair]), objectives)).toBe(
			expected,
		);
	});
});

describe("checkLoseCondition", () => {
	const ALL_AI_IDS = ["red", "green", "cyan"];

	it.each<[string, ReadonlySet<string> | string[], string[], boolean]>([
		["false when 0 of 3 are locked out", new Set(), ALL_AI_IDS, false],
		["false when 1 of 3 is locked out", new Set(["red"]), ALL_AI_IDS, false],
		[
			"false when 2 of 3 are locked out",
			new Set(["red", "green"]),
			ALL_AI_IDS,
			false,
		],
		["true when all 3 are locked out", new Set(ALL_AI_IDS), ALL_AI_IDS, true],
		[
			"true when all 3 are locked out, given as an AiId[] array",
			[...ALL_AI_IDS],
			ALL_AI_IDS,
			true,
		],
		["true (vacuously) when allAiIds is empty", new Set(), [], true],
	])("returns %s", (_name, lockedOut, allAiIds, expected) => {
		expect(checkLoseCondition(lockedOut, allAiIds)).toBe(expected);
	});
});

describe("checkPlacementFlavor", () => {
	const PACK = makeTestPack([], { setting: "test", wallName: "wall" });

	function itemAction(
		name: "put_down" | "use" | "pick_up",
		itemId: string,
	): AiTurnAction {
		return { aiId: "red", toolCall: { name, args: { item: itemId } } };
	}

	function gemOnAltar(gemHolder: Holder, placementFlavor?: string): WorldState {
		return worldFromPairs([
			makeObjectivePair(
				"gem",
				"altar",
				gemHolder,
				{ row: 2, col: 2 },
				placementFlavor,
			),
		]);
	}

	it.each(
		byName([
			{
				name: "substitutes {actor} with 'you' on a matching put_down",
				action: itemAction("put_down", "gem"),
				flavor: "{actor} places the gem on the altar.",
				expected: "you places the gem on the altar.",
			},
			{
				name: "returns the flavor for a use action when the object is on its paired space",
				action: itemAction("use", "gem"),
				flavor: undefined,
				expected: "you placed the item.",
			},
			{
				name: "replaces all occurrences of {actor} in the flavor string",
				action: itemAction("put_down", "gem"),
				flavor: "{actor} did it! {actor} wins!",
				expected: "you did it! you wins!",
			},
		]),
	)("%s", (_name, { action, flavor, expected }) => {
		const world = gemOnAltar({ row: 2, col: 2 }, flavor);
		expect(checkPlacementFlavor(action, PACK, world)).toBe(expected);
	});

	it.each(
		byName<{ name: string; action: AiTurnAction; world: WorldState }>([
			{
				name: "the object is on a non-matching cell",
				action: itemAction("put_down", "gem"),
				world: gemOnAltar({ row: 0, col: 0 }),
			},
			{
				name: "the item is an interesting_object (no pairsWithSpaceId)",
				action: itemAction("put_down", "coin"),
				world: {
					entities: [
						{
							id: "coin",
							kind: "interesting_object",
							name: "coin",
							examineDescription: "A coin.",
							holder: { row: 1, col: 1 },
							useOutcome: "Heads.",
						},
					],
				},
			},
			{
				name: "the action is a pick_up (not a put_down)",
				action: itemAction("pick_up", "gem"),
				world: gemOnAltar({ row: 2, col: 2 }),
			},
			{
				name: "the action is a go (no item)",
				action: {
					aiId: "red",
					toolCall: { name: "go", args: { direction: "south" } },
				},
				world: { entities: [] },
			},
			{
				name: "the action has no toolCall",
				action: { aiId: "red", pass: true },
				world: { entities: [] },
			},
			{
				name: "the object lands on coords that coincide with a DIFFERENT pair's space",
				action: itemAction("put_down", "objA"),
				world: worldFromPairs([
					makeObjectivePair(
						"objA",
						"spcA",
						{ row: 2, col: 2 },
						{ row: 0, col: 0 },
						"{actor} places objA.",
					),
					makeObjectivePair(
						"objB",
						"spcB",
						{ row: 4, col: 4 },
						{ row: 2, col: 2 },
					),
				]),
			},
			{
				name: "the item is still held by an AI (put_down not reflected in world)",
				action: itemAction("put_down", "gem"),
				world: gemOnAltar("red", "{actor} places the gem."),
			},
		]),
	)("returns null when %s", (_name, { action, world }) => {
		expect(checkPlacementFlavor(action, PACK, world)).toBeNull();
	});
});

describe("checkConvergenceTier", () => {
	const objective = makeConvergenceObjective("pending");

	function worldWithSpace(holder: Holder | null): WorldState {
		if (holder === null) return { entities: [] };
		return {
			entities: [
				{
					id: objective.spaceId,
					kind: "objective_space",
					name: "Test Space",
					examineDescription: "A test convergence space.",
					holder,
				},
			],
		};
	}

	function spatialAt(
		positions: GridPosition[],
	): Record<string, PersonaSpatialState> {
		return Object.fromEntries(
			positions.map((position, i) => [`ai-${i}`, { position }]),
		);
	}

	it.each(
		byName<{
			name: string;
			space: Holder | null;
			positions: GridPosition[];
			tier: 0 | 1 | 2;
		}>([
			{
				name: "0 when space entity is absent from world",
				space: null,
				positions: [{ row: 2, col: 2 }],
				tier: 0,
			},
			{
				name: "0 when space entity holder is an AiId (not a GridPosition)",
				space: "some-ai-id",
				positions: [{ row: 2, col: 2 }],
				tier: 0,
			},
			{
				name: "0 when no Daemon is on the space cell",
				space: { row: 3, col: 3 },
				positions: [
					{ row: 0, col: 0 },
					{ row: 1, col: 1 },
					{ row: 4, col: 4 },
				],
				tier: 0,
			},
			{
				name: "0 when the space is present but there are no personas at all",
				space: { row: 3, col: 3 },
				positions: [],
				tier: 0,
			},
			{
				name: "1 when exactly one Daemon is on the space cell",
				space: { row: 3, col: 3 },
				positions: [
					{ row: 3, col: 3 },
					{ row: 0, col: 0 },
					{ row: 1, col: 1 },
				],
				tier: 1,
			},
			{
				name: "2 when exactly two Daemons share the space cell",
				space: { row: 3, col: 3 },
				positions: [
					{ row: 3, col: 3 },
					{ row: 3, col: 3 },
					{ row: 1, col: 1 },
				],
				tier: 2,
			},
			{
				name: "2 when all three Daemons share the space cell (clamped)",
				space: { row: 2, col: 2 },
				positions: [
					{ row: 2, col: 2 },
					{ row: 2, col: 2 },
					{ row: 2, col: 2 },
				],
				tier: 2,
			},
		]),
	)("returns tier %s", (_name, { space, positions, tier }) => {
		expect(
			checkConvergenceTier(
				objective,
				worldWithSpace(space),
				spatialAt(positions),
			),
		).toEqual({ tier, spaceId: objective.spaceId });
	});
});
