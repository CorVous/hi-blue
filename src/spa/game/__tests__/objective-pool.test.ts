/**
 * Tests for drawObjectives in objective-pool.ts.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
import { drawObjectives } from "../objective-pool";
import type { ContentPack, ObjectivePair, WorldEntity } from "../types";

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
		expect(obj!.kind).toBe("carry");
		if (obj!.kind === "carry") {
			expect(obj!.objectId).toBe("gem_obj");
			expect(obj!.spaceId).toBe("gem_space");
			expect(obj!.satisfactionState).toBe("pending");
			expect(obj!.id).toBe("obj-0");
		}
	});

	it("description includes object and space names", () => {
		const pack = makePack(["gem"], []);
		const [obj] = drawObjectives(pack, rngZero, 1);
		expect(obj!.description).toContain("gem object");
		expect(obj!.description).toContain("gem space");
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
		expect(obj!.kind).toBe("use_item");
		if (obj!.kind === "use_item") {
			expect(obj!.itemId).toBe("key");
			expect(obj!.satisfactionState).toBe("pending");
			expect(obj!.id).toBe("obj-0");
		}
	});

	it("description includes item name", () => {
		const pack = makePack([], ["key"]);
		const [obj] = drawObjectives(pack, rngZero, 1);
		expect(obj!.description).toContain("key");
	});
});

// ── mixed pool ─────────────────────────────────────────────────────────────────

describe("drawObjectives — mixed pool (carry + use_item)", () => {
	it("rng=0 draws carry (index 0) from a [carry, use_item] pool", () => {
		const pack = makePack(["gem"], ["key"]);
		// pool: [carry(gem), use_item(key)] — rng=0 → index 0 → carry
		const [obj] = drawObjectives(pack, rngZero, 1);
		expect(obj!.kind).toBe("carry");
	});

	it("rng=last draws use_item (index 1) from a [carry, use_item] pool", () => {
		const pack = makePack(["gem"], ["key"]);
		// pool: [carry(gem), use_item(key)] — rng=0.999 → Math.floor(0.999*2)=1 → use_item
		const [obj] = drawObjectives(pack, rngLast, 1);
		expect(obj!.kind).toBe("use_item");
	});

	it("draws count=2 with sequential ids obj-0 and obj-1", () => {
		const pack = makePack(["gem"], ["key"]);
		const drawn = drawObjectives(pack, rngZero, 2);
		expect(drawn).toHaveLength(2);
		expect(drawn[0]!.id).toBe("obj-0");
		expect(drawn[1]!.id).toBe("obj-1");
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
	it("selects the correct pair when rng picks index 1 from a 2-pair pool", () => {
		const pack = makePack(["gem", "orb"], []);
		// pool: [carry(gem), carry(orb)] — rng=0.999 → Math.floor(0.999*2)=1 → orb
		const [obj] = drawObjectives(pack, rngLast, 1);
		expect(obj!.kind).toBe("carry");
		if (obj!.kind === "carry") {
			expect(obj!.objectId).toBe("orb_obj");
			expect(obj!.spaceId).toBe("orb_space");
		}
	});
});
