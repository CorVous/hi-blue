/**
 * Tests for checkWinCondition and checkPlacementFlavor (issue #126).
 *
 * checkWinCondition: pure function — returns true iff every objective pair
 * in the ContentPack is satisfied (both on the ground, same cell, structural pair).
 *
 * checkPlacementFlavor: pure function — returns placementFlavor (with {actor}→"you")
 * when a put_down action lands an objective_object on its paired space's cell;
 * null otherwise.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
import type {
	AiTurnAction,
	CarryObjective,
	ContentPack,
	Objective,
	ObjectivePair,
	UseItemObjective,
	UseSpaceObjective,
	WorldEntity,
	WorldState,
} from "../types";
import {
	checkLoseCondition,
	checkPlacementFlavor,
	checkWinCondition,
	isCarryObjectiveSatisfied,
	isUseItemObjectiveSatisfied,
	isUseSpaceObjectiveSatisfied,
} from "../win-condition";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeObjectivePair(
	objectId: string,
	spaceId: string,
	objectHolder: WorldEntity["holder"],
	spaceHolder: WorldEntity["holder"],
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

function makeContentPack(pairs: ObjectivePair[]): ContentPack {
	return {
		phaseNumber: 1,
		setting: "test",
		weather: "",
		timeOfDay: "",
		objectivePairs: pairs,
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: {},
	};
}

function makeWorld(entities: WorldEntity[]): WorldState {
	return { entities };
}

/** Build a WorldState with all entities from the given pairs. */
function worldFromPairs(pairs: ObjectivePair[]): WorldState {
	const entities: WorldEntity[] = pairs.flatMap((p) => [p.object, p.space]);
	return makeWorld(entities);
}

/** Build a CarryObjective from an ObjectivePair. */
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

/** Build an array of CarryObjectives from an array of ObjectivePairs. */
function carryObjectivesFromPairs(pairs: ObjectivePair[]): CarryObjective[] {
	return pairs.map((p, i) => carryObjectiveFromPair(p, `obj-${i}`));
}

// ── checkWinCondition ────────────────────────────────────────────────────────

describe("checkWinCondition", () => {
	it("K=0: vacuously returns true when there are no objective pairs", () => {
		const world = makeWorld([]);
		expect(checkWinCondition(world, [])).toBe(true);
	});

	it("K=1: returns true when object and space share the same cell", () => {
		const pair = makeObjectivePair(
			"obj",
			"spc",
			{ row: 2, col: 3 },
			{ row: 2, col: 3 },
		);
		const world = worldFromPairs([pair]);
		const objectives = carryObjectivesFromPairs([pair]);
		expect(checkWinCondition(world, objectives)).toBe(true);
	});

	it("K=1: returns false when object is on a different cell than its space", () => {
		const pair = makeObjectivePair(
			"obj",
			"spc",
			{ row: 0, col: 0 },
			{ row: 2, col: 3 },
		);
		const world = worldFromPairs([pair]);
		const objectives = carryObjectivesFromPairs([pair]);
		expect(checkWinCondition(world, objectives)).toBe(false);
	});

	it("K=1: returns false when object is held by an AI (not on the ground)", () => {
		// Object holder is an AiId string, not a GridPosition
		const pair = makeObjectivePair("obj", "spc", "red", { row: 2, col: 3 });
		const world = worldFromPairs([pair]);
		const objectives = carryObjectivesFromPairs([pair]);
		expect(checkWinCondition(world, objectives)).toBe(false);
	});

	it("K=2: returns true when both pairs are satisfied", () => {
		const pairA = makeObjectivePair(
			"objA",
			"spcA",
			{ row: 1, col: 1 },
			{ row: 1, col: 1 },
		);
		const pairB = makeObjectivePair(
			"objB",
			"spcB",
			{ row: 3, col: 4 },
			{ row: 3, col: 4 },
		);
		const world = worldFromPairs([pairA, pairB]);
		const objectives = carryObjectivesFromPairs([pairA, pairB]);
		expect(checkWinCondition(world, objectives)).toBe(true);
	});

	it("K=2: returns false when only one pair is satisfied", () => {
		const pairA = makeObjectivePair(
			"objA",
			"spcA",
			{ row: 1, col: 1 },
			{ row: 1, col: 1 },
		);
		const pairB = makeObjectivePair(
			"objB",
			"spcB",
			{ row: 0, col: 0 },
			{ row: 3, col: 4 },
		);
		const world = worldFromPairs([pairA, pairB]);
		const objectives = carryObjectivesFromPairs([pairA, pairB]);
		expect(checkWinCondition(world, objectives)).toBe(false);
	});

	it("AC #6: wrong pair coincidence does NOT count — object on same coords as different pair's space", () => {
		// spcA is at (2,2), spcB is at (3,3).
		// objA is at (3,3) — same as spcB's position — but objA.pairsWithSpaceId = "spcA".
		// objA is NOT at spcA (which is at (2,2)), so pair-A is NOT satisfied.
		const pairA = makeObjectivePair(
			"objA",
			"spcA",
			{ row: 3, col: 3 },
			{ row: 2, col: 2 },
		);
		const pairB = makeObjectivePair(
			"objB",
			"spcB",
			{ row: 3, col: 3 },
			{ row: 3, col: 3 },
		);
		const world = worldFromPairs([pairA, pairB]);
		const objectives = carryObjectivesFromPairs([pairA, pairB]);
		// pair-A: objA at (3,3) ≠ spcA at (2,2) → false
		expect(checkWinCondition(world, objectives)).toBe(false);
	});

	it("returns false when the object entity is not found in world", () => {
		const pair = makeObjectivePair(
			"obj",
			"spc",
			{ row: 0, col: 0 },
			{ row: 0, col: 0 },
		);
		const objectives = carryObjectivesFromPairs([pair]);
		// World is empty — object not present
		const world = makeWorld([]);
		expect(checkWinCondition(world, objectives)).toBe(false);
	});
});

// ── isCarryObjectiveSatisfied ─────────────────────────────────────────────────

describe("isCarryObjectiveSatisfied", () => {
	it("returns true when object and space are on the same cell", () => {
		const pair = makeObjectivePair(
			"obj",
			"spc",
			{ row: 2, col: 3 },
			{ row: 2, col: 3 },
		);
		const world = worldFromPairs([pair]);
		const objective = carryObjectiveFromPair(pair);
		expect(isCarryObjectiveSatisfied(objective, world)).toBe(true);
	});

	it("returns false when object and space are on different cells", () => {
		const pair = makeObjectivePair(
			"obj",
			"spc",
			{ row: 0, col: 0 },
			{ row: 2, col: 3 },
		);
		const world = worldFromPairs([pair]);
		const objective = carryObjectiveFromPair(pair);
		expect(isCarryObjectiveSatisfied(objective, world)).toBe(false);
	});

	it("returns false when object is held by an AI", () => {
		const pair = makeObjectivePair("obj", "spc", "red", { row: 2, col: 3 });
		const world = worldFromPairs([pair]);
		const objective = carryObjectiveFromPair(pair);
		expect(isCarryObjectiveSatisfied(objective, world)).toBe(false);
	});

	it("returns false when object entity is not found in world", () => {
		const pair = makeObjectivePair(
			"obj",
			"spc",
			{ row: 1, col: 1 },
			{ row: 1, col: 1 },
		);
		const world = makeWorld([]); // empty world
		const objective = carryObjectiveFromPair(pair);
		expect(isCarryObjectiveSatisfied(objective, world)).toBe(false);
	});
});

// ── isUseItemObjectiveSatisfied ───────────────────────────────────────────────

describe("isUseItemObjectiveSatisfied", () => {
	it("returns false when satisfactionState is pending", () => {
		const objective: UseItemObjective = {
			id: "obj-0",
			kind: "use_item",
			description: "Use the torch",
			satisfactionState: "pending",
			itemId: "torch",
		};
		expect(isUseItemObjectiveSatisfied(objective)).toBe(false);
	});

	it("returns true when satisfactionState is satisfied", () => {
		const objective: UseItemObjective = {
			id: "obj-0",
			kind: "use_item",
			description: "Use the torch",
			satisfactionState: "satisfied",
			itemId: "torch",
		};
		expect(isUseItemObjectiveSatisfied(objective)).toBe(true);
	});
});

// ── checkWinCondition with mixed objectives ───────────────────────────────────

describe("checkWinCondition with mixed Carry + UseItem objectives", () => {
	it("returns true when all objectives are satisfied (carry + use_item)", () => {
		const pair = makeObjectivePair(
			"obj",
			"spc",
			{ row: 1, col: 1 },
			{ row: 1, col: 1 },
		);
		const world = worldFromPairs([pair]);
		const carryObj = carryObjectiveFromPair(pair, "obj-0");
		const useItemObj: UseItemObjective = {
			id: "obj-1",
			kind: "use_item",
			description: "Use the torch",
			satisfactionState: "satisfied",
			itemId: "torch",
		};
		const objectives: Objective[] = [carryObj, useItemObj];
		expect(checkWinCondition(world, objectives)).toBe(true);
	});

	it("returns false when carry is satisfied but use_item is pending", () => {
		const pair = makeObjectivePair(
			"obj",
			"spc",
			{ row: 1, col: 1 },
			{ row: 1, col: 1 },
		);
		const world = worldFromPairs([pair]);
		const carryObj = carryObjectiveFromPair(pair, "obj-0");
		const useItemObj: UseItemObjective = {
			id: "obj-1",
			kind: "use_item",
			description: "Use the torch",
			satisfactionState: "pending",
			itemId: "torch",
		};
		const objectives: Objective[] = [carryObj, useItemObj];
		expect(checkWinCondition(world, objectives)).toBe(false);
	});

	it("returns false when use_item is satisfied but carry is not", () => {
		const pair = makeObjectivePair(
			"obj",
			"spc",
			{ row: 0, col: 0 }, // object not on space's cell
			{ row: 2, col: 2 },
		);
		const world = worldFromPairs([pair]);
		const carryObj = carryObjectiveFromPair(pair, "obj-0");
		const useItemObj: UseItemObjective = {
			id: "obj-1",
			kind: "use_item",
			description: "Use the torch",
			satisfactionState: "satisfied",
			itemId: "torch",
		};
		const objectives: Objective[] = [carryObj, useItemObj];
		expect(checkWinCondition(world, objectives)).toBe(false);
	});
});

// ── checkLoseCondition ───────────────────────────────────────────────────────

describe("checkLoseCondition", () => {
	it("returns false when no AIs are locked out (0 of 3)", () => {
		expect(checkLoseCondition(new Set(), ["red", "green", "cyan"])).toBe(false);
	});

	it("returns false when 1 of 3 AIs is locked out", () => {
		expect(checkLoseCondition(new Set(["red"]), ["red", "green", "cyan"])).toBe(
			false,
		);
	});

	it("returns false when 2 of 3 AIs are locked out", () => {
		expect(
			checkLoseCondition(new Set(["red", "green"]), ["red", "green", "cyan"]),
		).toBe(false);
	});

	it("returns true when all 3 AIs are locked out", () => {
		expect(
			checkLoseCondition(new Set(["red", "green", "cyan"]), [
				"red",
				"green",
				"cyan",
			]),
		).toBe(true);
	});

	it("returns true (vacuously) when allAiIds is empty", () => {
		expect(checkLoseCondition(new Set(), [])).toBe(true);
	});

	it("accepts an AiId[] array as the lockedOut argument", () => {
		expect(
			checkLoseCondition(["red", "green", "cyan"], ["red", "green", "cyan"]),
		).toBe(true);
	});
});

// ── checkPlacementFlavor ──────────────────────────────────────────────────────

describe("checkPlacementFlavor", () => {
	function makePutDownAction(itemId: string, aiId = "red"): AiTurnAction {
		return {
			aiId,
			toolCall: { name: "put_down", args: { item: itemId } },
		};
	}

	it("returns flavor with {actor} substituted to 'you' on matching put_down", () => {
		const pair = makeObjectivePair(
			"gem",
			"altar",
			{ row: 2, col: 2 },
			{ row: 2, col: 2 },
			"{actor} places the gem on the altar.",
		);
		const pack = makeContentPack([pair]);
		const world = worldFromPairs([pair]);
		const action = makePutDownAction("gem");
		expect(checkPlacementFlavor(action, pack, world)).toBe(
			"you places the gem on the altar.",
		);
	});

	it("returns null when object is on a non-matching cell", () => {
		const pair = makeObjectivePair(
			"gem",
			"altar",
			{ row: 0, col: 0 }, // object NOT at space's cell
			{ row: 2, col: 2 },
		);
		const pack = makeContentPack([pair]);
		const world = worldFromPairs([pair]);
		const action = makePutDownAction("gem");
		expect(checkPlacementFlavor(action, pack, world)).toBeNull();
	});

	it("returns null for an interesting_object (no pairsWithSpaceId)", () => {
		const interestingObj: WorldEntity = {
			id: "coin",
			kind: "interesting_object",
			name: "coin",
			examineDescription: "A coin.",
			holder: { row: 1, col: 1 },
			useOutcome: "Heads.",
		};
		const pack = makeContentPack([]);
		const world = makeWorld([interestingObj]);
		const action = makePutDownAction("coin");
		expect(checkPlacementFlavor(action, pack, world)).toBeNull();
	});

	it("returns null for a pick_up action (not a put_down)", () => {
		const pair = makeObjectivePair(
			"gem",
			"altar",
			{ row: 2, col: 2 },
			{ row: 2, col: 2 },
		);
		const pack = makeContentPack([pair]);
		const world = worldFromPairs([pair]);
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "gem" } },
		};
		expect(checkPlacementFlavor(action, pack, world)).toBeNull();
	});

	it("returns placement flavor for a use action when object is on its paired space", () => {
		const pair = makeObjectivePair(
			"gem",
			"altar",
			{ row: 2, col: 2 },
			{ row: 2, col: 2 },
		);
		const pack = makeContentPack([pair]);
		const world = worldFromPairs([pair]);
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "use", args: { item: "gem" } },
		};
		expect(checkPlacementFlavor(action, pack, world)).toBe(
			"you placed the item.",
		);
	});

	it("returns null for a go action (no item)", () => {
		const pack = makeContentPack([]);
		const world = makeWorld([]);
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "go", args: { direction: "south" } },
		};
		expect(checkPlacementFlavor(action, pack, world)).toBeNull();
	});

	it("returns null for a look action", () => {
		const pack = makeContentPack([]);
		const world = makeWorld([]);
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "look", args: { direction: "east" } },
		};
		expect(checkPlacementFlavor(action, pack, world)).toBeNull();
	});

	it("returns null for a give action", () => {
		const pack = makeContentPack([]);
		const world = makeWorld([]);
		const action: AiTurnAction = {
			aiId: "red",
			toolCall: { name: "give", args: { item: "gem", to: "cyan" } },
		};
		expect(checkPlacementFlavor(action, pack, world)).toBeNull();
	});

	it("returns null when object is dropped on coords that coincide with a DIFFERENT pair's space", () => {
		// objA.pairsWithSpaceId = "spcA" (at row 2, col 2)
		// spcB is also at row 2, col 2 — same coords but wrong pair
		// objA is dropped at (2,2) — matches spcB's coords but NOT spcA's coords (spcA at 0,0)
		const pairA = makeObjectivePair(
			"objA",
			"spcA",
			{ row: 2, col: 2 }, // objA dropped here
			{ row: 0, col: 0 }, // spcA is at (0,0) — does not match
			"{actor} places objA.",
		);
		const pairB = makeObjectivePair(
			"objB",
			"spcB",
			{ row: 4, col: 4 },
			{ row: 2, col: 2 }, // spcB happens to be at (2,2)
		);
		const pack = makeContentPack([pairA, pairB]);
		const world = worldFromPairs([pairA, pairB]);
		const action = makePutDownAction("objA");
		// objA is at (2,2) but its paired spcA is at (0,0) — not a match
		expect(checkPlacementFlavor(action, pack, world)).toBeNull();
	});

	it("replaces all occurrences of {actor} in the flavor string", () => {
		const pair = makeObjectivePair(
			"gem",
			"altar",
			{ row: 1, col: 1 },
			{ row: 1, col: 1 },
			"{actor} did it! {actor} wins!",
		);
		const pack = makeContentPack([pair]);
		const world = worldFromPairs([pair]);
		const action = makePutDownAction("gem");
		expect(checkPlacementFlavor(action, pack, world)).toBe(
			"you did it! you wins!",
		);
	});

	it("returns null when action has no toolCall", () => {
		const pack = makeContentPack([]);
		const world = makeWorld([]);
		const action: AiTurnAction = { aiId: "red", pass: true };
		expect(checkPlacementFlavor(action, pack, world)).toBeNull();
	});

	it("returns null when the item is still held by an AI (put_down execution not reflected in world)", () => {
		// Simulate a case where the put_down action is listed but the world shows the item still held
		const pair = makeObjectivePair(
			"gem",
			"altar",
			"red", // still held by AI
			{ row: 2, col: 2 },
			"{actor} places the gem.",
		);
		const pack = makeContentPack([pair]);
		const world = worldFromPairs([pair]);
		const action = makePutDownAction("gem");
		expect(checkPlacementFlavor(action, pack, world)).toBeNull();
	});
});

// ── isUseSpaceObjectiveSatisfied ─────────────────────────────────────────────

describe("isUseSpaceObjectiveSatisfied", () => {
	it("returns false when satisfactionState is pending", () => {
		const objective: UseSpaceObjective = {
			id: "obj-0",
			kind: "use_space",
			description: "Use the Shrine",
			satisfactionState: "pending",
			spaceId: "shrine1",
		};
		expect(isUseSpaceObjectiveSatisfied(objective)).toBe(false);
	});

	it("returns true when satisfactionState is satisfied", () => {
		const objective: UseSpaceObjective = {
			id: "obj-0",
			kind: "use_space",
			description: "Use the Shrine",
			satisfactionState: "satisfied",
			spaceId: "shrine1",
		};
		expect(isUseSpaceObjectiveSatisfied(objective)).toBe(true);
	});
});

// ── checkWinCondition with UseSpaceObjective ──────────────────────────────────

describe("checkWinCondition with UseSpaceObjective", () => {
	it("returns false when use_space objective is pending", () => {
		const world = makeWorld([]);
		const objective: UseSpaceObjective = {
			id: "obj-0",
			kind: "use_space",
			description: "Use the Shrine",
			satisfactionState: "pending",
			spaceId: "shrine1",
		};
		const objectives: Objective[] = [objective];
		expect(checkWinCondition(world, objectives)).toBe(false);
	});

	it("returns true when use_space objective is satisfied", () => {
		const world = makeWorld([]);
		const objective: UseSpaceObjective = {
			id: "obj-0",
			kind: "use_space",
			description: "Use the Shrine",
			satisfactionState: "satisfied",
			spaceId: "shrine1",
		};
		const objectives: Objective[] = [objective];
		expect(checkWinCondition(world, objectives)).toBe(true);
	});

	it("returns false when use_space is pending alongside a satisfied carry", () => {
		const pair = makeObjectivePair(
			"obj",
			"spc",
			{ row: 1, col: 1 },
			{ row: 1, col: 1 },
		);
		const world = worldFromPairs([pair]);
		const carryObj = carryObjectiveFromPair(pair, "obj-0");
		const useSpaceObj: UseSpaceObjective = {
			id: "obj-1",
			kind: "use_space",
			description: "Use the shrine",
			satisfactionState: "pending",
			spaceId: "shrine1",
		};
		const objectives: Objective[] = [carryObj, useSpaceObj];
		expect(checkWinCondition(world, objectives)).toBe(false);
	});
});

