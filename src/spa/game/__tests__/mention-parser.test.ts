import { describe, expect, it } from "vitest";
import { buildPersonaNameMap, parseFirstMention } from "../mention-parser.js";
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
