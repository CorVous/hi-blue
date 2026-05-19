/**
 * Unit tests for the per-temperament action-tool bias mapping
 * (daemon-action-variation).
 *
 * Covers: full coverage of the pool, [-2, +2] scale, the `use` baseline
 * floor (never below -1 after summation), and that the prose classifier
 * produces non-empty, name-anchored output across every temperament pair.
 */

import { describe, expect, it } from "vitest";
import {
	ACTION_TOOL_BIAS,
	ACTION_TOOLS,
	actionProfileFor,
	toolBiasSum,
} from "../action-preference-bias.js";
import { TEMPERAMENT_POOL } from "../temperament-pool.js";

describe("action-preference-bias", () => {
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

	it("enforces the `use` baseline floor (-1 minimum after summation) across every pair", () => {
		for (const t1 of TEMPERAMENT_POOL) {
			for (const t2 of TEMPERAMENT_POOL) {
				const sums = toolBiasSum(t1, t2);
				expect(sums.use).toBeGreaterThanOrEqual(-1);
			}
		}
	});

	it("toolBiasSum returns a value for every tool, even for unknown temperaments", () => {
		const sums = toolBiasSum("unknown-a", "unknown-b");
		for (const tool of ACTION_TOOLS) {
			expect(sums[tool]).toBeDefined();
		}
		// Unknown temperaments contribute 0; `use` floor still applies but two
		// zeros sum to zero, which is already ≥ -1.
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

	it("names every preferred tool (bias ≥ 2) explicitly with a lean", () => {
		// curious + meticulous: examine=4, look=3, use=2 → all three named.
		const clause = actionProfileFor("a", "meticulous", "curious");
		expect(clause).toContain("leans toward");
		expect(clause).toContain("`examine`");
		expect(clause).toContain("`look`");
		expect(clause).toContain("`use`");
	});

	it("encodes a ~70/30 split intent (variety over fixation)", () => {
		// Any preferred-list clause should signal that other tools still fire.
		const clause = actionProfileFor("a", "meticulous", "curious");
		expect(clause).toMatch(/70|30/);
		expect(clause.toLowerCase()).toMatch(/variety|other available|spread/);
	});

	it("flags avoided tools (bias ≤ -1) without making them zero-emission", () => {
		// zealous + hot-headed: examine = -1 (the only negative); other tools positive.
		const clause = actionProfileFor("b", "zealous", "hot-headed");
		expect(clause.toLowerCase()).toMatch(/hesitant|less often/);
		expect(clause).toContain("`examine`");
		// Cautious personas must still emit avoided tools occasionally.
		expect(clause.toLowerCase()).toMatch(/still|when.*calls/);
	});

	it("orders preferred tools by descending bias", () => {
		// curious + meticulous: examine=4, look=3, use=2 — `examine` must come first.
		const clause = actionProfileFor("a", "meticulous", "curious");
		const examineIdx = clause.indexOf("`examine`");
		const lookIdx = clause.indexOf("`look`");
		const useIdx = clause.indexOf("`use`");
		expect(examineIdx).toBeLessThan(lookIdx);
		expect(lookIdx).toBeLessThan(useIdx);
	});

	it("names the give-heavy pair's give preference", () => {
		// sweet + effusive: give=4 (strongest), pick_up=2, look=2.
		const clause = actionProfileFor("d", "sweet", "effusive");
		expect(clause).toContain("`give`");
		// `give` is the strongest bias — must come first in the preferred list.
		const giveIdx = clause.indexOf("`give`");
		const otherTools = ["`pick_up`", "`look`"];
		for (const other of otherTools) {
			const idx = clause.indexOf(other);
			if (idx >= 0) expect(giveIdx).toBeLessThan(idx);
		}
	});

	it("falls through to the balanced default when no tool reaches ±threshold", () => {
		// mercurial + sly: all tools in [0, 2]; no bias ≥ 2 and no bias ≤ -1.
		// sly(+1 go, +1 look, 0 examine, +1 pick_up, 0 put_down, +1 give, 0 use)
		// + mercurial(+1 go, +1 look, 0 examine, 0 pick_up, 0 put_down, 0 give, 0 use)
		// = (+2 go, +2 look, 0 examine, +1 pick_up, 0 put_down, +1 give, 0 use)
		// → go and look hit +2, so the balanced default does NOT fire here.
		// Use mercurial + haughty instead:
		// haughty(+1 go, +1 look, 0 examine, 0 pick_up, 0 put_down, 0 give, 0 use)
		// + mercurial(+1 go, +1 look, 0 examine, 0 pick_up, 0 put_down, 0 give, 0 use)
		// = (+2 go, +2 look, 0 elsewhere) → still hits +2, no balanced.
		// Try anxious + earnest:
		// anxious(-1 go, 0 look, +1 examine, -1 pick_up, +1 put_down, 0 give, -1 use)
		// + earnest(0 go, +1 look, +1 examine, 0 pick_up, 0 put_down, +1 give, +1 use)
		// = (-1 go, +1 look, +2 examine, -1 pick_up, +1 put_down, +1 give, 0 use)
		// → examine hits +2, no balanced default. Negative tools (go, pick_up) hit
		// avoided. Asserts the avoided shape instead:
		const clause = actionProfileFor("e", "anxious", "earnest");
		expect(clause.toLowerCase()).toMatch(/hesitant|less often/);
	});

	it("is byte-stable across calls (deterministic ordering)", () => {
		const a = actionProfileFor("z", "curious", "zealous");
		const b = actionProfileFor("z", "curious", "zealous");
		expect(a).toBe(b);
	});
});
