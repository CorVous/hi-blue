/**
 * Tests for drawObjectives in objective-pool.ts.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
import { drawObjectives } from "../objective-pool";
import type {
	ContentPack,
	ObjectivePair,
	UseSpaceObjective,
	WorldEntity,
} from "../types";

// ── helpers for convergence tests ─────────────────────────────────────────────

function makeObjectivePairWithConvergenceFlavors(
	id: string,
	spaceOverrides?: Partial<WorldEntity>,
): ObjectivePair {
	const obj: WorldEntity = {
		id: `${id}_obj`,
		kind: "objective_object",
		name: `${id} object`,
		examineDescription: `The ${id} object belongs on the ${id} space.`,
		holder: { row: 0, col: 0 },
		pairsWithSpaceId: `${id}_space`,
	};
	// All four tier-flavor fields must be present for the inclusion guard (#336)
	// to admit the convergence candidate. Tests of negative paths override
	// individual fields via `spaceOverrides`.
	const space: WorldEntity = {
		id: `${id}_space`,
		kind: "objective_space",
		name: `${id} space`,
		examineDescription: `The ${id} space.`,
		holder: { row: 4, col: 4 },
		convergenceTier1Flavor: `A single presence lingers at the ${id} space.`,
		convergenceTier2Flavor: `Two presences converge at the ${id} space.`,
		convergenceTier1ActorFlavor: `You linger at the ${id} space.`,
		convergenceTier2ActorFlavor: `You share the ${id} space with another presence.`,
		...spaceOverrides,
	};
	return { object: obj, space };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeObjectivePair(id: string): ObjectivePair {
	const obj: WorldEntity = {
		id: `${id}_obj`,
		kind: "objective_object",
		name: `${id} object`,
		examineDescription: `The ${id} object.`,
		holder: { row: 0, col: 0 },
		pairsWithSpaceId: `${id}_space`,
	};
	const space: WorldEntity = {
		id: `${id}_space`,
		kind: "objective_space",
		name: `${id} space`,
		examineDescription: `The ${id} space.`,
		holder: { row: 4, col: 4 },
	};
	return { object: obj, space };
}

function makeInterestingObject(id: string): WorldEntity {
	return {
		id,
		kind: "interesting_object",
		name: id,
		examineDescription: `The ${id}.`,
		holder: { row: 1, col: 1 },
		useOutcome: `You used the ${id}.`,
	};
}

function makePack(
	objectivePairIds: string[],
	interestingObjectIds: string[],
): ContentPack {
	return {
		setting: "test",
		weather: "",
		timeOfDay: "",
		objectivePairs: objectivePairIds.map(makeObjectivePair),
		interestingObjects: interestingObjectIds.map(makeInterestingObject),
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		wallName: "wall",
		aiStarts: {},
	};
}

// A fixed rng that always returns 0 (always picks index 0).
const rngZero = () => 0;
// A fixed rng that always returns 0.999 (always picks last index).
const rngLast = () => 0.999;

// ── empty pool ─────────────────────────────────────────────────────────────────

describe("drawObjectives — empty pool", () => {
	it("returns [] when pack has no pairs and no interesting objects, count > 0", () => {
		const pack = makePack([], []);
		expect(drawObjectives(pack, rngZero, 3)).toEqual([]);
	});

	it("returns [] when count is 0 and pool is non-empty", () => {
		const pack = makePack(["gem"], []);
		expect(drawObjectives(pack, rngZero, 0)).toEqual([]);
	});
});

// ── carry objectives ──────────────────────────────────────────────────────────

describe("drawObjectives — carry objectives", () => {
	it("draws a CarryObjective from a single-pair pack", () => {
		const pack = makePack(["gem"], []);
		const [obj] = drawObjectives(pack, rngZero, 1);
		expect(obj).toBeDefined();
		expect(obj?.kind).toBe("carry");
		if (obj?.kind === "carry") {
			expect(obj.objectId).toBe("gem_obj");
			expect(obj.spaceId).toBe("gem_space");
			expect(obj.satisfactionState).toBe("pending");
			expect(obj.id).toBe("obj-0");
		}
	});

	it("description includes object and space names", () => {
		const pack = makePack(["gem"], []);
		const [obj] = drawObjectives(pack, rngZero, 1);
		expect(obj?.description).toContain("gem object");
		expect(obj?.description).toContain("gem space");
	});

	it("can draw count > 1 carry objectives from a single-pair pool (with replacement)", () => {
		const pack = makePack(["gem"], []);
		const drawn = drawObjectives(pack, rngZero, 3);
		expect(drawn).toHaveLength(3);
		for (const obj of drawn) {
			expect(obj.kind).toBe("carry");
		}
	});
});

// ── use_item objectives ───────────────────────────────────────────────────────

describe("drawObjectives — use_item objectives", () => {
	it("draws a UseItemObjective from a pack with only interesting objects", () => {
		const pack = makePack([], ["key"]);
		const [obj] = drawObjectives(pack, rngZero, 1);
		expect(obj).toBeDefined();
		expect(obj?.kind).toBe("use_item");
		if (obj?.kind === "use_item") {
			expect(obj.itemId).toBe("key");
			expect(obj.satisfactionState).toBe("pending");
			expect(obj.id).toBe("obj-0");
		}
	});

	it("description includes item name", () => {
		const pack = makePack([], ["key"]);
		const [obj] = drawObjectives(pack, rngZero, 1);
		expect(obj?.description).toContain("key");
	});
});

// ── mixed pool ─────────────────────────────────────────────────────────────────

describe("drawObjectives — mixed pool (carry + use_item)", () => {
	it("rng=0 draws carry (index 0) from a [carry, use_item] pool", () => {
		const pack = makePack(["gem"], ["key"]);
		// pool: [carry(gem), use_item(key)] — rng=0 → index 0 → carry
		const [obj] = drawObjectives(pack, rngZero, 1);
		expect(obj?.kind).toBe("carry");
	});

	it("rng=last draws use_item (index 1) from a [carry, use_item] pool", () => {
		const pack = makePack(["gem"], ["key"]);
		// pool: [carry(gem), use_item(key)] — rng=0.999 → Math.floor(0.999*2)=1 → use_item
		const [obj] = drawObjectives(pack, rngLast, 1);
		expect(obj?.kind).toBe("use_item");
	});

	it("draws count=2 with sequential ids obj-0 and obj-1", () => {
		const pack = makePack(["gem"], ["key"]);
		const drawn = drawObjectives(pack, rngZero, 2);
		expect(drawn).toHaveLength(2);
		expect(drawn[0]?.id).toBe("obj-0");
		expect(drawn[1]?.id).toBe("obj-1");
	});

	it("all drawn objectives start with satisfactionState 'pending'", () => {
		const pack = makePack(["gem"], ["key"]);
		// Alternate rng: 0, 0.999, 0, 0.999...
		let call = 0;
		const altRng = () => (call++ % 2 === 0 ? 0 : 0.999);
		const drawn = drawObjectives(pack, altRng, 4);
		for (const obj of drawn) {
			expect(obj.satisfactionState).toBe("pending");
		}
	});
});

// ── id assignment ─────────────────────────────────────────────────────────────

describe("drawObjectives — id assignment", () => {
	it("assigns ids obj-0 through obj-(count-1)", () => {
		const pack = makePack(["gem", "orb"], []);
		const drawn = drawObjectives(pack, rngZero, 5);
		const ids = drawn.map((o) => o.id);
		expect(ids).toEqual(["obj-0", "obj-1", "obj-2", "obj-3", "obj-4"]);
	});
});

// ── multiple pairs in pool ────────────────────────────────────────────────────

describe("drawObjectives — multiple pairs in pool", () => {
	it("selects the correct objective when rng picks index 1 from a 2-pair pool", () => {
		const pack = makePack(["gem", "orb"], []);
		// pool: [carry(gem), use_space(gem_space), carry(orb), use_space(orb_space)]
		// rng=0 → index 0 → carry(gem)
		const rngZero = () => 0;
		const [obj] = drawObjectives(pack, rngZero, 1);
		expect(obj?.kind).toBe("carry");
		if (obj?.kind === "carry") {
			expect(obj.objectId).toBe("gem_obj");
			expect(obj.spaceId).toBe("gem_space");
		}
	});

	it("draws a use_space objective from a 2-pair pool", () => {
		const pack = makePack(["gem", "orb"], []);
		// pool: [carry(gem), use_space(gem_space), carry(orb), use_space(orb_space)]
		// rng picks index 1 (second entry) → use_space for gem_space
		const rngIdx1 = () => 1 / 4 + 0.001; // Math.floor(0.251 * 4) = 1
		const [obj] = drawObjectives(pack, rngIdx1, 1);
		expect(obj?.kind).toBe("use_space");
		if (obj?.kind === "use_space") {
			expect(obj.spaceId).toBe("gem_space");
		}
	});

	it("pool size is 2*(objectivePairs.length) for a pack with no interesting objects", () => {
		const pack = makePack(["gem", "orb"], []);
		// 2 pairs → pool has 4 entries (2 carry + 2 use_space)
		// Draw 4 times with rng cycling through all indices
		let call = 0;
		const cyclingRng = () => (call++ % 4) / 4;
		const drawn = drawObjectives(pack, cyclingRng, 4);
		const kinds = drawn.map((o) => o.kind);
		expect(kinds).toContain("carry");
		expect(kinds).toContain("use_space");
	});
});

// ── use_space objectives ──────────────────────────────────────────────────────

describe("drawObjectives — use_space objectives", () => {
	it("produces a UseSpaceObjective candidate for each objectivePair", () => {
		const pack = makePack(["gem"], []);
		// pool: [carry(gem), use_space(gem_space)]
		// rng picks index 1 → use_space for gem_space
		const rngIdx1 = () => 0.5; // Math.floor(0.5 * 2) = 1
		const [obj] = drawObjectives(pack, rngIdx1, 1);
		expect(obj).toBeDefined();
		expect(obj?.kind).toBe("use_space");
		if (obj?.kind === "use_space") {
			expect((obj as UseSpaceObjective).spaceId).toBe("gem_space");
			expect(obj.satisfactionState).toBe("pending");
		}
	});

	it("use_space objective description includes the space name", () => {
		const pack = makePack(["gem"], []);
		const rngIdx1 = () => 0.5; // picks use_space
		const [obj] = drawObjectives(pack, rngIdx1, 1);
		expect(obj?.description).toContain("gem space");
	});
});

// ── convergence objectives ────────────────────────────────────────────────────

describe("drawObjectives — convergence objectives", () => {
	it("includes a ConvergenceObjective when the pack has a space with both tier flavors", () => {
		const packWithConvergence: ContentPack = {
			setting: "test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [makeObjectivePairWithConvergenceFlavors("relic")],
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			wallName: "wall",
			aiStarts: {},
		};
		// pool: [carry(relic), convergence(relic)] — rng=last → index 1 → convergence
		const [obj] = drawObjectives(packWithConvergence, rngLast, 1);
		expect(obj?.kind).toBe("convergence");
		if (obj?.kind === "convergence") {
			expect(obj.spaceId).toBe("relic_space");
			expect(obj.satisfactionState).toBe("pending");
			expect(obj.id).toBe("obj-0");
		}
	});

	it("does NOT include a ConvergenceObjective when space lacks tier flavor fields", () => {
		const packWithoutFlavors: ContentPack = {
			setting: "test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [makeObjectivePair("gem")], // no convergence flavors
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			wallName: "wall",
			aiStarts: {},
		};
		// Pool is [carry(gem)] only — no convergence
		const drawn = drawObjectives(packWithoutFlavors, rngZero, 10);
		expect(drawn.every((o) => o.kind !== "convergence")).toBe(true);
	});

	it("builds a mixed pool with carry + use_item + convergence from a well-flavored pack", () => {
		const packMixed: ContentPack = {
			setting: "test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [makeObjectivePairWithConvergenceFlavors("altar")],
			interestingObjects: [makeInterestingObject("torch")],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			wallName: "wall",
			aiStarts: {},
		};
		// Pool: [carry(altar), use_space(altar), use_item(torch), convergence(altar)] — 4 candidates
		// rngZero → always index 0 → carry
		const allDrawn = drawObjectives(packMixed, rngZero, 3);
		// All three should be carry since rngZero always picks index 0
		expect(allDrawn[0]?.kind).toBe("carry");

		// With rngLast, index = Math.floor(0.999 * 4) = 3 → convergence
		const [lastObj] = drawObjectives(packMixed, rngLast, 1);
		expect(lastObj?.kind).toBe("convergence");

		// Confirm description mentions the space name
		if (lastObj?.kind === "convergence") {
			expect(lastObj.description).toContain("altar space");
		}
	});
});

// ── convergence inclusion guard — requires all four flavor fields (#336) ─────

describe("drawObjectives — convergence inclusion guard requires all four flavor fields", () => {
	const FIELDS = [
		"convergenceTier1Flavor",
		"convergenceTier2Flavor",
		"convergenceTier1ActorFlavor",
		"convergenceTier2ActorFlavor",
	] as const;

	for (const field of FIELDS) {
		it(`excludes convergence from the pool when ${field} is missing`, () => {
			const pair = makeObjectivePairWithConvergenceFlavors("gem", {
				[field]: undefined,
			});
			const pack: ContentPack = {
				setting: "test",
				weather: "",
				timeOfDay: "",
				objectivePairs: [pair],
				interestingObjects: [],
				obstacles: [],
				landmarks: DEFAULT_LANDMARKS,
				wallName: "wall",
				aiStarts: {},
			};
			// Pool should be [carry(gem), use_space(gem)] — size 2, no convergence.
			let call = 0;
			const cyclingRng = () => (call++ % 2) / 2;
			const drawn = drawObjectives(pack, cyclingRng, 10);
			expect(drawn.every((o) => o.kind !== "convergence")).toBe(true);
			expect(drawn.map((o) => o.kind)).toContain("carry");
			expect(drawn.map((o) => o.kind)).toContain("use_space");
		});

		it(`excludes convergence from the pool when ${field} is an empty string`, () => {
			const pair = makeObjectivePairWithConvergenceFlavors("gem", {
				[field]: "",
			});
			const pack: ContentPack = {
				setting: "test",
				weather: "",
				timeOfDay: "",
				objectivePairs: [pair],
				interestingObjects: [],
				obstacles: [],
				landmarks: DEFAULT_LANDMARKS,
				wallName: "wall",
				aiStarts: {},
			};
			const drawn = drawObjectives(pack, rngZero, 10);
			expect(drawn.every((o) => o.kind !== "convergence")).toBe(true);
		});
	}

	it("admits convergence into the pool when all four flavor fields are present", () => {
		const pack: ContentPack = {
			setting: "test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [makeObjectivePairWithConvergenceFlavors("gem")],
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			wallName: "wall",
			aiStarts: {},
		};
		// Draw enough to cycle through all pool indices.
		let call = 0;
		const cyclingRng = () => (call++ % 3) / 3;
		const drawn = drawObjectives(pack, cyclingRng, 9);
		expect(drawn.map((o) => o.kind)).toContain("convergence");
	});
});
