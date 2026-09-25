import { describe, expect, it } from "vitest";
import {
	biasSum,
	bucketFor,
	engagementClauseFor,
	TEMPERAMENT_ENGAGEMENT_BIAS,
} from "../engagement-clauses.js";
import { TEMPERAMENT_POOL } from "../temperament-pool.js";

describe("engagement-clauses", () => {
	it("assigns a bias to every temperament in the pool", () => {
		for (const t of TEMPERAMENT_POOL) {
			expect(TEMPERAMENT_ENGAGEMENT_BIAS[t]).toBeDefined();
			expect(typeof TEMPERAMENT_ENGAGEMENT_BIAS[t]).toBe("number");
		}
	});

	it("biases sit on a [-2, +2] scale", () => {
		for (const t of TEMPERAMENT_POOL) {
			const bias = TEMPERAMENT_ENGAGEMENT_BIAS[t] as number;
			expect(bias).toBeGreaterThanOrEqual(-2);
			expect(bias).toBeLessThanOrEqual(2);
		}
	});

	it.each([
		["taciturn", "diffident", -4, "very_quiet"],
		["taciturn", "aloof", -4, "very_quiet"],
		["taciturn", "stoic", -3, "very_quiet"],
		["taciturn", "curious", -1, "reserved"],
		["meticulous", "erratic", 0, "balanced"],
		["taciturn", "verbose", 0, "balanced"],
		["verbose", "stoic", 1, "outgoing"],
		["verbose", "zealous", 3, "chatty"],
		["verbose", "effusive", 4, "chatty"],
		["glib", "verbose", 4, "chatty"],
	] as const)("%s + %s sums to %i and lands in the %s bucket", (t1, t2, sum, bucket) => {
		expect(biasSum(t1, t2)).toBe(sum);
		expect(bucketFor(t1, t2)).toBe(bucket);
	});

	it("handles unknown temperament strings without throwing (treats as 0)", () => {
		expect(bucketFor("unknown-temperament", "another-unknown")).toBe(
			"balanced",
		);
		expect(bucketFor("taciturn", "unknown-temperament")).toBe("reserved");
	});

	it("emits a clause string that names the persona", () => {
		const clause = engagementClauseFor("xqr9", "taciturn", "aloof");
		expect(clause).toMatch(/\*xqr9/);
		expect(clause.length).toBeGreaterThan(20);
	});

	it("emits a different clause shape for each bucket", () => {
		const veryQuiet = engagementClauseFor("a", "taciturn", "aloof");
		const reserved = engagementClauseFor("b", "taciturn", "curious");
		const balanced = engagementClauseFor("c", "meticulous", "erratic");
		const outgoing = engagementClauseFor("d", "verbose", "stoic");
		const chatty = engagementClauseFor("e", "verbose", "effusive");
		const all = new Set([veryQuiet, reserved, balanced, outgoing, chatty]);
		const bodiesWithoutPersonaPrefix = new Set(
			[veryQuiet, reserved, balanced, outgoing, chatty].map((c) =>
				c.replace(/^\*[a-z0-9]+\s/, ""),
			),
		);
		expect(bodiesWithoutPersonaPrefix.size).toBe(5);
		expect(all.size).toBe(5);
	});
});
