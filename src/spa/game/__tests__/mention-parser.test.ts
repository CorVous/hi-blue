import { describe, expect, it } from "vitest";
import {
	buildPersonaColorMap,
	buildPersonaNameMap,
	findFirstMention,
	parseFirstMention,
} from "../mention-parser.js";
import type { AiId } from "../types.js";

// Build a minimal name→id map for the three canonical personas.
const nameMap = new Map<string, AiId>([
	["ember", "red"],
	["sage", "green"],
	["frost", "blue"],
]);

describe("parseFirstMention", () => {
	it.each<[string, AiId | null]>([
		["@Sage", "green"],
		["@Sage hi", "green"],
		["hi @Sage", "green"],
		["hello @Sage how are you", "green"],
		["@sage", "green"],
		["@SAGE", "green"],
		["@SaGe", "green"],
		["@Sage,", "green"],
		["@Sage.", "green"],
		["@Sage @Frost", "green"],
		["@Frost @Sage", "blue"],
		["", null],
		["hello world", null],
		["email me at user@host", null],
		["@Nonpersona hi", null],
		["@", null],
		["@Ember", "red"],
		["@Frost", "blue"],
	])("parseFirstMention(%j) → %j", (text, expected) => {
		expect(parseFirstMention(text, nameMap)).toBe(expected);
	});
});

describe("buildPersonaNameMap", () => {
	it("builds a map with lowercased keys pointing to AiId values", () => {
		const personas = {
			red: { name: "Ember" },
			green: { name: "Sage" },
			blue: { name: "Frost" },
		} as Record<AiId, { name: string }>;
		const map = buildPersonaNameMap(personas);
		expect(map.get("ember")).toBe("red");
		expect(map.get("sage")).toBe("green");
		expect(map.get("frost")).toBe("blue");
		expect(map.size).toBe(3);
	});
});

describe("findFirstMention", () => {
	const colorMap = new Map<string, AiId>([
		["ember", "red"],
		["sage", "green"],
		["frost", "blue"],
	]);

	it("returns null for empty string", () => {
		expect(findFirstMention("", colorMap)).toBeNull();
	});

	it("returns null for text with no mention", () => {
		expect(findFirstMention("hello world", colorMap)).toBeNull();
	});

	it("returns null for email-style user@host (no leading whitespace)", () => {
		expect(findFirstMention("email me at user@host", colorMap)).toBeNull();
	});

	it("returns null for @Nonpersona", () => {
		expect(findFirstMention("@Nonpersona hi", colorMap)).toBeNull();
	});

	it("@Sage → { aiId: 'green', start: 0, end: 5 }", () => {
		expect(findFirstMention("@Sage", colorMap)).toEqual({
			aiId: "green",
			start: 0,
			end: 5,
		});
	});

	it("@Sage hi → range still [0, 5)", () => {
		expect(findFirstMention("@Sage hi", colorMap)).toEqual({
			aiId: "green",
			start: 0,
			end: 5,
		});
	});

	it("hi @Sage how → range [3, 8)", () => {
		expect(findFirstMention("hi @Sage how", colorMap)).toEqual({
			aiId: "green",
			start: 3,
			end: 8,
		});
	});

	it("@Sage, → range [0, 5) (trailing comma excluded)", () => {
		expect(findFirstMention("@Sage,", colorMap)).toEqual({
			aiId: "green",
			start: 0,
			end: 5,
		});
	});

	it("@Sage @Frost → first mention wins (green, [0, 5))", () => {
		expect(findFirstMention("@Sage @Frost", colorMap)).toEqual({
			aiId: "green",
			start: 0,
			end: 5,
		});
	});

	it("@Frost @Sage → first mention wins (blue, [0, 6))", () => {
		expect(findFirstMention("@Frost @Sage", colorMap)).toEqual({
			aiId: "blue",
			start: 0,
			end: 6,
		});
	});

	it("hi @Sage how are you → correct range [3, 8)", () => {
		expect(findFirstMention("hi @Sage how are you", colorMap)).toEqual({
			aiId: "green",
			start: 3,
			end: 8,
		});
	});

	it("@Ember → { aiId: 'red', start: 0, end: 6 }", () => {
		expect(findFirstMention("@Ember", colorMap)).toEqual({
			aiId: "red",
			start: 0,
			end: 6,
		});
	});

	it("@Frost → { aiId: 'blue', start: 0, end: 6 }", () => {
		expect(findFirstMention("@Frost", colorMap)).toEqual({
			aiId: "blue",
			start: 0,
			end: 6,
		});
	});
});

describe("buildPersonaColorMap", () => {
	it("builds a map from AiId to color string", () => {
		const personas = {
			red: { color: "red" },
			green: { color: "green" },
			blue: { color: "blue" },
		} as Record<AiId, { color: string }>;
		const map = buildPersonaColorMap(personas);
		expect(map.get("red")).toBe("red");
		expect(map.get("green")).toBe("green");
		expect(map.get("blue")).toBe("blue");
		expect(map.size).toBe(3);
	});
});
