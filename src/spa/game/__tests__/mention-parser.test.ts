import { describe, expect, it } from "vitest";
import {
	applyAddresseeChange,
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

describe("findFirstMention", () => {
	it('"@Sage" → { aiId: "green", start: 0, nameEnd: 5, end: 5 }', () => {
		expect(findFirstMention("@Sage", nameMap)).toEqual({
			aiId: "green",
			start: 0,
			nameEnd: 5,
			end: 5,
		});
	});

	it('"@Sage hi" → { aiId: "green", start: 0, nameEnd: 5, end: 5 }', () => {
		expect(findFirstMention("@Sage hi", nameMap)).toEqual({
			aiId: "green",
			start: 0,
			nameEnd: 5,
			end: 5,
		});
	});

	it('"hi @Sage" → { aiId: "green", start: 3, nameEnd: 8, end: 8 }', () => {
		expect(findFirstMention("hi @Sage", nameMap)).toEqual({
			aiId: "green",
			start: 3,
			nameEnd: 8,
			end: 8,
		});
	});

	it('"@sage" (lowercase) → { aiId: "green", start: 0, nameEnd: 5, end: 5 }', () => {
		expect(findFirstMention("@sage", nameMap)).toEqual({
			aiId: "green",
			start: 0,
			nameEnd: 5,
			end: 5,
		});
	});

	it('"@Sage," → nameEnd: 5 (excludes comma), end: 6 (includes comma)', () => {
		expect(findFirstMention("@Sage,", nameMap)).toEqual({
			aiId: "green",
			start: 0,
			nameEnd: 5,
			end: 6,
		});
	});

	it('"hi @Sage." → nameEnd: 8 (excludes period), end: 9 (includes period)', () => {
		expect(findFirstMention("hi @Sage.", nameMap)).toEqual({
			aiId: "green",
			start: 3,
			nameEnd: 8,
			end: 9,
		});
	});

	it('"@Frost @Sage" → first match is Frost (blue), nameEnd: 6, end: 6', () => {
		expect(findFirstMention("@Frost @Sage", nameMap)).toEqual({
			aiId: "blue",
			start: 0,
			nameEnd: 6,
			end: 6,
		});
	});

	it('"hello world" → null', () => {
		expect(findFirstMention("hello world", nameMap)).toBeNull();
	});

	it('"@Nonpersona" → null', () => {
		expect(findFirstMention("@Nonpersona", nameMap)).toBeNull();
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

describe("buildPersonaColorMap", () => {
	it("maps each AiId to the persona's color value (not the id key)", () => {
		// Use distinct color values that differ from the AiId keys
		// so a wrong implementation that returns the key is immediately caught.
		const personas = {
			red: { color: "crimson" },
			green: { color: "lime" },
			blue: { color: "cyan" },
		} as Record<AiId, { color: string }>;
		const map = buildPersonaColorMap(personas);
		expect(map.get("red")).toBe("crimson");
		expect(map.get("green")).toBe("lime");
		expect(map.get("blue")).toBe("cyan");
		expect(map.size).toBe(3);
	});

	it("returns the color string from the persona record, not the AiId key", () => {
		// If implementation mistakenly returns the key instead of persona.color,
		// these assertions will fail.
		const personas = {
			red: { color: "tomato" },
			green: { color: "forest" },
			blue: { color: "ocean" },
		} as Record<AiId, { color: string }>;
		const map = buildPersonaColorMap(personas);
		expect(map.get("red")).not.toBe("red");
		expect(map.get("green")).not.toBe("green");
		expect(map.get("blue")).not.toBe("blue");
	});
});

const personasFixture = {
	red: { name: "Ember" },
	green: { name: "Sage" },
	blue: { name: "Frost" },
} as Record<AiId, { name: string }>;

describe("applyAddresseeChange", () => {
	it.each<[string, number | null, AiId, string, number]>([
		// [text, cursor, target, expectedText, expectedCursor]
		["", 0, "red", "@Ember ", 7],
		["hi", 2, "green", "@Sage hi", 8],
		["@Sage hi", 8, "red", "@Ember hi", 9],
		["@Sage hi", 0, "red", "@Ember hi", 0],
		["@Sage hi", 3, "red", "@Ember hi", 6],
		["@Sage tell @Frost ...", 21, "red", "@Ember tell @Frost ...", 22],
		["@Sage,", 6, "red", "@Ember,", 7],
		["hello @Sage how are you", 23, "blue", "hello @Frost how are you", 24],
		["@nonpersona hi", 14, "red", "@Ember @nonpersona hi", 21],
		["hi", null, "green", "@Sage hi", 6],
		["hi", 0, "green", "@Sage hi", 6],
	])("applyAddresseeChange(%j, cursor=%j, target=%j) → text=%j, cursor=%j", (text, cursor, target, expectedText, expectedCursor) => {
		const result = applyAddresseeChange({
			text,
			selectionStart: cursor,
			targetPersona: target,
			personaNamesToId: nameMap,
			personas: personasFixture,
		});
		expect(result.text).toBe(expectedText);
		expect(result.selectionStart).toBe(expectedCursor);
	});
});
