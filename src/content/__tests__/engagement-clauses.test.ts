/**
 * Unit tests for the temperament → engagement bucket mapping (spike #239
 * step 8). Exercises the bucket boundaries and a few representative pairs.
 */

import { describe, expect, it } from "vitest";
import {
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

	it("places extreme single-direction pairs in the extreme buckets", () => {
		expect(bucketFor("taciturn", "diffident")).toBe("very_quiet"); // -4
		expect(bucketFor("taciturn", "aloof")).toBe("very_quiet"); // -4
		expect(bucketFor("verbose", "effusive")).toBe("chatty"); // +4
		expect(bucketFor("glib", "verbose")).toBe("chatty"); // +4
	});

	it("places a sum of 0 in the balanced bucket", () => {
		expect(bucketFor("meticulous", "erratic")).toBe("balanced"); // 0+0
		expect(bucketFor("taciturn", "verbose")).toBe("balanced"); // -2+2
	});

	it("respects the -3 / +3 bucket boundaries", () => {
		// taciturn (-2) + stoic (-1) = -3 → very_quiet
		expect(bucketFor("taciturn", "stoic")).toBe("very_quiet");
		// taciturn (-2) + curious (+1) = -1 → reserved (not balanced)
		expect(bucketFor("taciturn", "curious")).toBe("reserved");
		// verbose (+2) + zealous (+1) = +3 → chatty
		expect(bucketFor("verbose", "zealous")).toBe("chatty");
		// verbose (+2) + stoic (-1) = +1 → outgoing (not balanced)
		expect(bucketFor("verbose", "stoic")).toBe("outgoing");
	});

	it("handles unknown temperament strings without throwing (treats as 0)", () => {
		expect(bucketFor("unknown-temperament", "another-unknown")).toBe(
			"balanced",
		);
		expect(bucketFor("taciturn", "unknown-temperament")).toBe("reserved"); // -2+0=-2
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
		// Each clause names a different persona, but the *body* should differ
		// per bucket — pull out the persona prefix and compare bodies.
		const bodies = new Set(
			[veryQuiet, reserved, balanced, outgoing, chatty].map((c) =>
				c.replace(/^\*[a-z0-9]+\s/, ""),
			),
		);
		expect(bodies.size).toBe(5);
		expect(all.size).toBe(5);
	});
});
