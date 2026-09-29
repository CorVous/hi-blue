import { describe, expect, it } from "vitest";
import { positiveIntegerKnob } from "../env-knobs.js";

describe("positiveIntegerKnob", () => {
	it("falls back when the variable is unset or blank", () => {
		expect(positiveIntegerKnob("EVAL_PARALLEL", undefined, 1)).toBe(1);
		expect(positiveIntegerKnob("EVAL_PARALLEL", "  ", 4)).toBe(4);
	});

	it("reads a positive whole number", () => {
		expect(positiveIntegerKnob("EVAL_PARALLEL", "3", 1)).toBe(3);
	});

	it.each(["abc", "0", "-2", "1.5", "NaN"])("rejects %s", (raw) => {
		expect(() => positiveIntegerKnob("EVAL_PARALLEL", raw, 1)).toThrow(
			/EVAL_PARALLEL/,
		);
	});
});
