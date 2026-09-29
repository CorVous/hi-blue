import { describe, expect, it } from "vitest";
import {
	ACTION_TOOL_BIAS,
	ACTION_TOOLS,
	actionProfileFor,
	toolBiasSum,
} from "../action-preference-bias.js";
import { TEMPERAMENT_POOL } from "../pools.js";

const TEMPERAMENT_PAIRS = TEMPERAMENT_POOL.flatMap((t1) =>
	TEMPERAMENT_POOL.map((t2) => [t1, t2] as const),
);

function pairsWhere(violates: (t1: string, t2: string) => boolean): string[] {
	return TEMPERAMENT_PAIRS.filter(([t1, t2]) => violates(t1, t2)).map(
		([t1, t2]) => `${t1} + ${t2}`,
	);
}

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
		expect(
			pairsWhere((t1, t2) => {
				const sums = toolBiasSum(t1, t2);
				return sums.use < -1 || sums.go < -1;
			}),
		).toEqual([]);
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
		expect(
			pairsWhere((t1, t2) => {
				const clause = actionProfileFor("xqr9", t1, t2);
				return !clause.includes("*xqr9") || clause.length <= 20;
			}),
		).toEqual([]);
	});

	it("never names a removed tool (examine / look / give / face) in any clause", () => {
		const removedTools = ["`examine`", "`look`", "`give`", "`face`"];
		expect(
			pairsWhere((t1, t2) => {
				const clause = actionProfileFor("z", t1, t2);
				return removedTools.some((tool) => clause.includes(tool));
			}),
		).toEqual([]);
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
		expect(
			pairsWhere((t1, t2) => {
				const avoided =
					actionProfileFor("z", t1, t2).match(/hesitant about (.+?) —/)?.[1] ??
					"";
				return avoided.includes("`go`") || avoided.includes("`use`");
			}),
		).toEqual([]);
	});

	it("never calls a persona both balanced and hesitant in the same clause", () => {
		expect(
			pairsWhere((t1, t2) => {
				const clause = actionProfileFor("z", t1, t2).toLowerCase();
				return (
					clause.includes("balanced way") && clause.includes("hesitant about")
				);
			}),
		).toEqual([]);
	});

	it("orders preferred tools by descending bias: `go` (4) before `pick_up` (2) for zealous + hot-headed", () => {
		const clause = actionProfileFor("a", "zealous", "hot-headed");
		const goIdx = clause.indexOf("`go`");
		const pickUpIdx = clause.indexOf("`pick_up`");
		expect(goIdx).toBeGreaterThanOrEqual(0);
		expect(pickUpIdx).toBeGreaterThan(goIdx);
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
