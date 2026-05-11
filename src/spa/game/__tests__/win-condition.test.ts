/**
 * Tests for checkWinCondition, checkLoseCondition, and checkPlacementFlavor.
 *
 * checkWinCondition(objectives): returns true iff all objectives are satisfied.
 * checkLoseCondition(lockedOut, allAiIds): returns true iff all AIs are locked out.
 * checkPlacementFlavor: returns placementFlavor (with {actor}→"you")
 * when a put_down action lands an objective_object on its paired space's cell;
 * null otherwise.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
import type {
	AiTurnAction,
	ContentPack,
	Objective,
	ObjectivePair,
	WorldEntity,
	WorldState,
} from "../types";
import {
	checkLoseCondition,
	checkPlacementFlavor,
	checkWinCondition,
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

// ── Helpers for Objective ────────────────────────────────────────────────────

function makeObjective(
	id: string,
	satisfactionState: Objective["satisfactionState"],
): Objective {
	return { id, description: `${id} objective`, satisfactionState };
}

// ── checkWinCondition(objectives) ────────────────────────────────────────────

describe("checkWinCondition(objectives)", () => {
	it("returns false when objectives is empty", () => {
		expect(checkWinCondition([])).toBe(false);
	});

	it("returns true when all objectives are satisfied", () => {
		const objectives = [
			makeObjective("obj1", "satisfied"),
			makeObjective("obj2", "satisfied"),
		];
		expect(checkWinCondition(objectives)).toBe(true);
	});

	it("returns false when any objective is unsatisfied", () => {
		const objectives = [
			makeObjective("obj1", "satisfied"),
			makeObjective("obj2", "unsatisfied"),
		];
		expect(checkWinCondition(objectives)).toBe(false);
	});

	it("returns false when a single objective is unsatisfied", () => {
		expect(checkWinCondition([makeObjective("obj1", "unsatisfied")])).toBe(
			false,
		);
	});

	it("returns true when a single objective is satisfied", () => {
		expect(checkWinCondition([makeObjective("obj1", "satisfied")])).toBe(true);
	});
});

// ── checkLoseCondition ───────────────────────────────────────────────────────

describe("checkLoseCondition(lockedOut, allAiIds)", () => {
	it("returns false when allAiIds is empty", () => {
		expect(checkLoseCondition([], [])).toBe(false);
	});

	it("returns true when all AIs are locked out", () => {
		expect(
			checkLoseCondition(["red", "green", "cyan"], ["red", "green", "cyan"]),
		).toBe(true);
	});

	it("returns false when only a subset is locked out", () => {
		expect(checkLoseCondition(["red"], ["red", "green", "cyan"])).toBe(false);
	});

	it("returns false when no AIs are locked out", () => {
		expect(checkLoseCondition([], ["red", "green", "cyan"])).toBe(false);
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
