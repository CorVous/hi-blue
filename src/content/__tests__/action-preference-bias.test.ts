import { describe, expect, it } from "vitest";
import {
	ACTION_TOOL_BIAS,
	ACTION_TOOLS,
	actionProfileFor,
	toolBiasSum,
} from "../action-preference-bias.js";
import { TEMPERAMENT_POOL } from "../temperament-pool.js";

describe("action-preference-bias", () => {
	it("covers exactly the 4-tool surface (no examine, no give, no face)", () => {
		expect([...ACTION_TOOLS]).toEqual(["go", "pick_up", "put_down", "use"]);
	});

	it("has exactly four tool columns per temperament and no `face` column", () => {
		for (const t of TEMPERAMENT_POOL) {
			const entry = ACTION_TOOL_BIAS[t];
			expect(entry, t).toBeDefined();
			if (!entry) continue;
			expect(Object.keys(entry), t).toEqual([
				"go",
				"pick_up",
				"put_down",
				"use",
			]);
			expect(entry).not.toHaveProperty("face");
		}
	});

	it("did not transfer the retired `face` column onto another tool or `message`", () => {
		expect(ACTION_TOOL_BIAS.meticulous).toEqual({
			go: -1,
			pick_up: 0,
			put_down: 1,
			use: 1,
		});
		expect(ACTION_TOOL_BIAS.pedantic).toEqual({
			go: -1,
			pick_up: 0,
			put_down: 1,
			use: 1,
		});
		expect(ACTION_TOOL_BIAS.theatrical).toEqual({
			go: 2,
			pick_up: 1,
			put_down: 0,
			use: -1,
		});
		expect(ACTION_TOOL_BIAS.curious).toEqual({
			go: 1,
			pick_up: 1,
			put_down: -1,
			use: 1,
		});
		expect(ACTION_TOOL_BIAS.verbose).toEqual({
			go: 0,
			pick_up: 0,
			put_down: 0,
			use: 0,
		});
	});

	it("has bias entries for every temperament in the pool", () => {
		for (const t of TEMPERAMENT_POOL) {
			expect(ACTION_TOOL_BIAS[t]).toBeDefined();
		}
	});

	it("includes every action tool in each temperament entry, on a [-2, +2] scale", () => {
		for (const t of TEMPERAMENT_POOL) {
			const entry = ACTION_TOOL_BIAS[t];
			expect(entry).toBeDefined();
			if (!entry) continue;
			for (const tool of ACTION_TOOLS) {
				const v = entry[tool];
				expect(v).toBeDefined();
				expect(typeof v).toBe("number");
				expect(v).toBeGreaterThanOrEqual(-2);
				expect(v).toBeLessThanOrEqual(2);
			}
		}
	});

	it("enforces the critical-path baseline floor (`go`/`use` ≥ -1) across every pair", () => {
		for (const t1 of TEMPERAMENT_POOL) {
			for (const t2 of TEMPERAMENT_POOL) {
				const sums = toolBiasSum(t1, t2);
				expect(sums.use).toBeGreaterThanOrEqual(-1);
				expect(sums.go).toBeGreaterThanOrEqual(-1);
			}
		}
	});

	it("floors `go` at -1 where doubled melancholic or melancholic + diffident would sum to -4", () => {
		expect(toolBiasSum("melancholic", "melancholic").go).toBe(-1);
		expect(toolBiasSum("melancholic", "diffident").go).toBe(-1);
	});

	it("toolBiasSum returns a value for every tool, even for unknown temperaments", () => {
		const sums = toolBiasSum("unknown-a", "unknown-b");
		for (const tool of ACTION_TOOLS) {
			expect(sums[tool]).toBeDefined();
		}
		expect(sums.go).toBe(0);
	});

	it("toolBiasSum is commutative", () => {
		const a = toolBiasSum("zealous", "taciturn");
		const b = toolBiasSum("taciturn", "zealous");
		for (const tool of ACTION_TOOLS) {
			expect(a[tool]).toBe(b[tool]);
		}
	});

	it("emits a clause that names the persona for every temperament pair", () => {
		for (const t1 of TEMPERAMENT_POOL) {
			for (const t2 of TEMPERAMENT_POOL) {
				const clause = actionProfileFor("xqr9", t1, t2);
				expect(clause).toContain("*xqr9");
				expect(clause.length).toBeGreaterThan(20);
			}
		}
	});

	it("never names a removed tool (examine / look / give / face) in any clause", () => {
		for (const t1 of TEMPERAMENT_POOL) {
			for (const t2 of TEMPERAMENT_POOL) {
				const clause = actionProfileFor("z", t1, t2);
				expect(clause).not.toContain("`examine`");
				expect(clause).not.toContain("`look`");
				expect(clause).not.toContain("`give`");
				expect(clause).not.toContain("`face`");
			}
		}
	});

	it("names every preferred tool (bias ≥ 2) explicitly with a lean, e.g. `use` for meticulous + curious", () => {
		const clause = actionProfileFor("a", "meticulous", "curious");
		expect(clause).toContain("leans toward");
		expect(clause).toContain("`use`");
		expect(clause).not.toContain("`face`");
	});

	it("encodes a ~70/30 split intent (variety over fixation)", () => {
		const clause = actionProfileFor("a", "meticulous", "curious");
		expect(clause).toMatch(/70|30/);
		expect(clause.toLowerCase()).toMatch(/variety|other available|spread/);
	});

	it("flags avoided flavor tools (bias ≤ -1) as still usable, e.g. `pick_up` for diffident + aloof", () => {
		const clause = actionProfileFor("b", "diffident", "aloof");
		expect(clause.toLowerCase()).toMatch(/hesitant|less often/);
		expect(clause).toContain("`pick_up`");
		expect(clause.toLowerCase()).toMatch(/still|when.*calls/);
	});

	it("never lists a critical-path tool (`go`/`use`) as avoided", () => {
		for (const t1 of TEMPERAMENT_POOL) {
			for (const t2 of TEMPERAMENT_POOL) {
				const clause = actionProfileFor("z", t1, t2);
				const avoidedSegment = clause.match(/hesitant about (.+?) —/);
				if (!avoidedSegment) continue;
				expect(avoidedSegment[1]).not.toContain("`go`");
				expect(avoidedSegment[1]).not.toContain("`use`");
			}
		}
	});

	it("never calls a persona both balanced and hesitant in the same clause", () => {
		for (const t1 of TEMPERAMENT_POOL) {
			for (const t2 of TEMPERAMENT_POOL) {
				const clause = actionProfileFor("z", t1, t2).toLowerCase();
				const balanced = clause.includes("balanced way");
				const hesitant = clause.includes("hesitant about");
				expect(balanced && hesitant).toBe(false);
			}
		}
	});

	it("orders preferred tools by descending bias: `go` (4) before `pick_up` (2) for zealous + hot-headed", () => {
		const clause = actionProfileFor("a", "zealous", "hot-headed");
		const goIdx = clause.indexOf("`go`");
		const pickUpIdx = clause.indexOf("`pick_up`");
		expect(goIdx).toBeGreaterThanOrEqual(0);
		expect(pickUpIdx).toBeGreaterThan(goIdx);
	});

	it("gives a go-heavy pair a go lean", () => {
		const clause = actionProfileFor("c", "zealous", "hot-headed");
		expect(clause).toContain("`go`");
	});

	it("falls through to the balanced default when no tool reaches ±threshold (stoic + earnest)", () => {
		const clause = actionProfileFor("e", "stoic", "earnest");
		expect(clause).not.toContain("leans toward");
		expect(clause.toLowerCase()).toContain("balanced");
		expect(clause.toLowerCase()).not.toContain("hesitant");
	});

	it("is byte-stable across calls (deterministic ordering)", () => {
		const a = actionProfileFor("z", "curious", "zealous");
		const b = actionProfileFor("z", "curious", "zealous");
		expect(a).toBe(b);
	});
});
