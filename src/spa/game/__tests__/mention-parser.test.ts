import { describe, expect, it } from "vitest";
import {
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
	it('"@Sage" → { aiId: "green", start: 0, end: 5 }', () => {
		expect(findFirstMention("@Sage", nameMap)).toEqual({
			aiId: "green",
			start: 0,
			end: 5,
		});
	});

	it('"@Sage hi" → { aiId: "green", start: 0, end: 5 }', () => {
		expect(findFirstMention("@Sage hi", nameMap)).toEqual({
			aiId: "green",
			start: 0,
			end: 5,
		});
	});

	it('"hi @Sage" → { aiId: "green", start: 3, end: 8 }', () => {
		expect(findFirstMention("hi @Sage", nameMap)).toEqual({
			aiId: "green",
			start: 3,
			end: 8,
		});
	});

	it('"@sage" (lowercase) → { aiId: "green", start: 0, end: 5 }', () => {
		expect(findFirstMention("@sage", nameMap)).toEqual({
			aiId: "green",
			start: 0,
			end: 5,
		});
	});

	it('"@Sage," → end includes the comma (end: 6)', () => {
		expect(findFirstMention("@Sage,", nameMap)).toEqual({
			aiId: "green",
			start: 0,
			end: 6,
		});
	});

	it('"@Frost @Sage" → first match is Frost (blue)', () => {
		expect(findFirstMention("@Frost @Sage", nameMap)).toEqual({
			aiId: "blue",
			start: 0,
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
