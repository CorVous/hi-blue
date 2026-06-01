/**
 * Unit tests for the per-temperament action-tool bias mapping
 * (daemon-action-variation).
 *
 * Covers the 5-tool surface (`go`, `face`, `pick_up`, `put_down`,
 * `use`): full coverage of the pool, [-2, +2] scale, the `use` baseline
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
	it("covers the merged 5-tool surface (no examine, no give, look→face)", () => {
		expect([...ACTION_TOOLS]).toEqual([
			"go",
			"face",
			"pick_up",
			"put_down",
			"use",
		]);
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

	it("floors `go` for a draw that would otherwise bottom out movement", () => {
		// Doubled melancholic: raw go = -2 + -2 = -4, floored to -1.
		expect(toolBiasSum("melancholic", "melancholic").go).toBe(-1);
		// melancholic + diffident: raw go = -2 + -2 = -4, floored to -1.
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

	it("never names a removed tool (examine / look / give) in any clause", () => {
		for (const t1 of TEMPERAMENT_POOL) {
			for (const t2 of TEMPERAMENT_POOL) {
				const clause = actionProfileFor("z", t1, t2);
				expect(clause).not.toContain("`examine`");
				expect(clause).not.toContain("`look`");
				expect(clause).not.toContain("`give`");
			}
		}
	});

	it("names every preferred tool (bias ≥ 2) explicitly with a lean", () => {
		// curious + meticulous: face = 2+2 = 4, use = 1+1 = 2 → both named.
		const clause = actionProfileFor("a", "meticulous", "curious");
		expect(clause).toContain("leans toward");
		expect(clause).toContain("`face`");
		expect(clause).toContain("`use`");
	});

	it("encodes a ~70/30 split intent (variety over fixation)", () => {
		const clause = actionProfileFor("a", "meticulous", "curious");
		expect(clause).toMatch(/70|30/);
		expect(clause.toLowerCase()).toMatch(/variety|other available|spread/);
	});

	it("flags avoided tools (bias ≤ -1) without making them zero-emission", () => {
		// diffident + aloof: face = -2, pick_up = -3 → avoided. go (-3) and
		// use (-2) are critical-path, so they are floored and excluded.
		const clause = actionProfileFor("b", "diffident", "aloof");
		expect(clause.toLowerCase()).toMatch(/hesitant|less often/);
		// Cautious personas must still emit avoided tools occasionally.
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

	it("orders preferred tools by descending bias", () => {
		// curious + meticulous: face=4 > use=2 — `face` must come first.
		const clause = actionProfileFor("a", "meticulous", "curious");
		const faceIdx = clause.indexOf("`face`");
		const useIdx = clause.indexOf("`use`");
		expect(faceIdx).toBeGreaterThanOrEqual(0);
		expect(useIdx).toBeGreaterThan(faceIdx);
	});

	it("gives a go-heavy pair a go lean", () => {
		// zealous + hot-headed: go = 2+2 = 4 → `go` preferred.
		const clause = actionProfileFor("c", "zealous", "hot-headed");
		expect(clause).toContain("`go`");
	});

	it("falls through to the balanced default when no tool reaches ±threshold", () => {
		// stoic + earnest: go -1+0=-1, face 0+1=1, pick_up 0, put_down 0,
		// use 0+1=1 — nothing reaches the +2 preferred threshold, and the
		// only negative (go = -1) is a critical-path tool, so it is excluded
		// from the avoided list. Result: the balanced default, alone.
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
