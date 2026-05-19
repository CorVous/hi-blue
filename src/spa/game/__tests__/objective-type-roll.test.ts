import { describe, expect, it, vi } from "vitest";
import { OBJECTIVE_TYPES } from "../types.js";
import { rollObjectiveTypes } from "../objective-type-roll.js";

describe("rollObjectiveTypes", () => {
	it("count=0 returns [] without calling rng", () => {
		const rng = vi.fn(() => 0.5);
		const result = rollObjectiveTypes(rng, 0);
		expect(result).toEqual([]);
		expect(rng).not.toHaveBeenCalled();
	});

	it("negative count throws", () => {
		expect(() => rollObjectiveTypes(() => 0.5, -1)).toThrow(RangeError);
	});

	it("rng always returning 0 yields carry for each draw", () => {
		const result = rollObjectiveTypes(() => 0, 3);
		expect(result).toEqual(["carry", "carry", "carry"]);
	});

	it("rng always returning 0.999 yields convergence for each draw", () => {
		// 0.999 * 4 = 3.996, floor = 3 → index 3 = "convergence"
		const result = rollObjectiveTypes(() => 0.999, 3);
		expect(result).toEqual(["convergence", "convergence", "convergence"]);
	});

	it("determinism: same seeded sequence gives same result", () => {
		function makeRng(seed: number) {
			let s = seed >>> 0;
			return () => {
				s += 0x6d2b79f5;
				let t = s;
				t = Math.imul(t ^ (t >>> 15), t | 1);
				t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
			};
		}
		const r1 = rollObjectiveTypes(makeRng(42), 5);
		const r2 = rollObjectiveTypes(makeRng(42), 5);
		expect(r1).toEqual(r2);
	});

	it("all returned values are in OBJECTIVE_TYPES", () => {
		const types = new Set(OBJECTIVE_TYPES);
		let calls = 0;
		const rng = () => {
			calls++;
			return (calls * 0.123456) % 1;
		};
		const result = rollObjectiveTypes(rng, 20);
		for (const t of result) {
			expect(types.has(t)).toBe(true);
		}
	});

	it("distribution check: 1000 draws, each type > 150 count", () => {
		let seed = 1;
		const rng = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			return seed / 4294967296;
		};
		const counts: Record<string, number> = {
			carry: 0,
			use_space: 0,
			use_item: 0,
			convergence: 0,
		};
		const result = rollObjectiveTypes(rng, 1000);
		for (const t of result) {
			counts[t] = (counts[t] ?? 0) + 1;
		}
		for (const key of Object.keys(counts)) {
			expect(counts[key]).toBeGreaterThan(150);
		}
	});
});
