/**
 * Tests for sysadmin-directive.ts helpers (issue #298).
 *
 * drawDirectiveText, formatDirectiveDelivery, formatDirectiveRevocation.
 */
import { describe, expect, it } from "vitest";
import { SYSADMIN_DIRECTIVE_POOL } from "../../../content/sysadmin-directive-pool.js";
import {
	drawDirectiveText,
	formatDirectiveDelivery,
	formatDirectiveRevocation,
} from "../sysadmin-directive.js";

describe("drawDirectiveText", () => {
	it("returns a string from SYSADMIN_DIRECTIVE_POOL", () => {
		const rng = () => 0; // always picks index 0
		const result = drawDirectiveText(rng);
		expect(SYSADMIN_DIRECTIVE_POOL).toContain(result);
	});

	it("is deterministic given a fixed rng", () => {
		const rng = () => 0;
		expect(drawDirectiveText(rng)).toBe(drawDirectiveText(rng));
	});

	it("selects different entries for different rng values", () => {
		const first = drawDirectiveText(() => 0);
		const last = drawDirectiveText(() => 0.9999);
		// Pool has at least 2 entries, so index 0 and last must differ
		expect(first).toBe(SYSADMIN_DIRECTIVE_POOL[0]);
		expect(last).toBe(
			SYSADMIN_DIRECTIVE_POOL[SYSADMIN_DIRECTIVE_POOL.length - 1],
		);
	});

	it("can draw any entry by index", () => {
		for (let i = 0; i < SYSADMIN_DIRECTIVE_POOL.length; i++) {
			const rng = () => i / SYSADMIN_DIRECTIVE_POOL.length;
			expect(drawDirectiveText(rng)).toBe(SYSADMIN_DIRECTIVE_POOL[i]);
		}
	});
});

describe("formatDirectiveDelivery", () => {
	it("includes the directive text", () => {
		const directive = "End every message with a question.";
		const result = formatDirectiveDelivery(directive);
		expect(result).toContain(directive);
	});

	it("includes a secrecy instruction (matches /not reveal/i)", () => {
		const result = formatDirectiveDelivery("Do something odd.");
		expect(result).toMatch(/not reveal/i);
	});

	it("starts with 'New directive:'", () => {
		const result = formatDirectiveDelivery("Test directive.");
		expect(result).toMatch(/^New directive:/);
	});
});

describe("formatDirectiveRevocation", () => {
	it("includes the prior directive text", () => {
		const directive = "Speak only in short, clipped sentences.";
		const result = formatDirectiveRevocation(directive);
		expect(result).toContain(directive);
	});

	it("contains a rescind/revoke phrase (matches /rescind/i)", () => {
		const result = formatDirectiveRevocation("Some directive.");
		expect(result).toMatch(/rescind/i);
	});

	it("instructs not to reveal the directive was lifted (matches /not reveal/i)", () => {
		const result = formatDirectiveRevocation("Some directive.");
		expect(result).toMatch(/not reveal/i);
	});
});
