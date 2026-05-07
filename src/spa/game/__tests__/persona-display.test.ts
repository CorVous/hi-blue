import { describe, expect, it } from "vitest";
import { displayName, lockoutErrorText } from "../persona-display.js";

describe("displayName", () => {
	it("returns the persona name", () => {
		expect(displayName({ name: "Sage" })).toBe("Sage");
	});

	it("returns Ember for red persona", () => {
		expect(displayName({ name: "Ember" })).toBe("Ember");
	});
});

describe("lockoutErrorText", () => {
	it("contains the persona name", () => {
		const text = lockoutErrorText({ name: "Sage" });
		expect(text).toContain("Sage");
	});

	it("is non-empty", () => {
		const text = lockoutErrorText({ name: "Frost" });
		expect(text.length).toBeGreaterThan(0);
	});

	it("returns expected format for Sage", () => {
		expect(lockoutErrorText({ name: "Sage" })).toBe(
			"Sage isn't reading right now",
		);
	});
});
