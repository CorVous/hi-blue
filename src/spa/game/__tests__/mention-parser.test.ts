import { describe, expect, it } from "vitest";
import {
	applyAddresseeChange,
	buildMentionRegex,
	buildPersonaColorMap,
	buildPersonaNameMap,
	findFirstMention,
	splitMentionSegments,
} from "../mention-parser.js";
import type { AiId } from "../types.js";

const nameMap = new Map<string, AiId>([
	["ember", "red"],
	["sage", "green"],
	["frost", "cyan"],
]);

describe("findFirstMention aiId", () => {
	it.each<[string, AiId | null]>([
		["*Sage", "green"],
		["*Sage hi", "green"],
		["hi *Sage", "green"],
		["hello *Sage how are you", "green"],
		["*sage", "green"],
		["*SAGE", "green"],
		["*SaGe", "green"],
		["*Sage,", "green"],
		["*Sage.", "green"],
		["*Sage *Frost", "green"],
		["*Frost *Sage", "cyan"],
		["", null],
		["hello world", null],
		["email me at user@host", null],
		["*Nonpersona hi", null],
		["*Nonpersona", null],
		["*", null],
		["*Ember", "red"],
		["*Frost", "cyan"],
	])("findFirstMention(%j)?.aiId → %j", (text, expected) => {
		expect(findFirstMention(text, nameMap)?.aiId ?? null).toBe(expected);
	});
});

describe("findFirstMention", () => {
	it.each<[string, AiId, number, number, number]>([
		["*Sage", "green", 0, 5, 5],
		["*Sage hi", "green", 0, 5, 5],
		["hi *Sage", "green", 3, 8, 8],
		["*sage", "green", 0, 5, 5],
		["*Sage,", "green", 0, 5, 6],
		["hi *Sage.", "green", 3, 8, 9],
		["*Frost *Sage", "cyan", 0, 6, 6],
	])("%j → aiId %j, start %j, nameEnd %j (excludes trailing punctuation), end %j (includes it)", (text, aiId, start, nameEnd, end) => {
		expect(findFirstMention(text, nameMap)).toEqual({
			aiId,
			start,
			nameEnd,
			end,
		});
	});
});

describe("buildPersonaNameMap", () => {
	it("builds a map with lowercased keys pointing to AiId values", () => {
		const personas = {
			red: { name: "Ember" },
			green: { name: "Sage" },
			cyan: { name: "Frost" },
		} as Record<AiId, { name: string }>;
		const map = buildPersonaNameMap(personas);
		expect(map.get("ember")).toBe("red");
		expect(map.get("sage")).toBe("green");
		expect(map.get("frost")).toBe("cyan");
		expect(map.size).toBe(3);
	});
});

describe("buildPersonaColorMap", () => {
	it("maps each AiId to the persona's color value (not the id key)", () => {
		const personas = {
			red: { color: "crimson" },
			green: { color: "lime" },
			cyan: { color: "cyan" },
		} as Record<AiId, { color: string }>;
		const map = buildPersonaColorMap(personas);
		expect(map.get("red")).toBe("crimson");
		expect(map.get("green")).toBe("lime");
		expect(map.get("cyan")).toBe("cyan");
		expect(map.size).toBe(3);
	});
});

const personasFixture = {
	red: { name: "Ember" },
	green: { name: "Sage" },
	cyan: { name: "Frost" },
} as Record<AiId, { name: string }>;

describe("applyAddresseeChange", () => {
	it.each<[string, number | null, AiId, string, number]>([
		["", 0, "red", "*Ember ", 7],
		["hi", 2, "green", "*Sage hi", 8],
		["*Sage hi", 8, "red", "*Ember hi", 9],
		["*Sage hi", 0, "red", "*Ember hi", 0],
		["*Sage hi", 3, "red", "*Ember hi", 6],
		["*Sage tell *Frost ...", 21, "red", "*Ember tell *Frost ...", 22],
		["*Sage,", 6, "red", "*Ember,", 7],
		["hello *Sage how are you", 23, "cyan", "hello *Frost how are you", 24],
		["*nonpersona hi", 14, "red", "*Ember *nonpersona hi", 21],
		["hi", null, "green", "*Sage hi", 6],
		["hi", 0, "green", "*Sage hi", 6],
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

const coloredPersonas: Record<AiId, { name: string; color: string }> = {
	red: { name: "Ember", color: "#e07a5f" },
	green: { name: "Sage", color: "#81b29a" },
};

function allMatches(regex: RegExp | null, text: string): string[] {
	if (!regex) return [];
	return [...text.matchAll(regex)].map((m) => m[0]);
}

describe("buildMentionRegex", () => {
	it("returns null when no persona has a name", () => {
		expect(buildMentionRegex({})).toBeNull();
		expect(buildMentionRegex({ red: { name: "" } })).toBeNull();
	});

	it("matches whole names case-insensitively, with or without the sigil", () => {
		const regex = buildMentionRegex(coloredPersonas);
		expect(allMatches(regex, "*ember and SAGE, not Embers")).toEqual([
			"*ember",
			"SAGE",
		]);
	});

	it("escapes regex metacharacters in names", () => {
		const regex = buildMentionRegex({ red: { name: "A.B" } });
		expect(allMatches(regex, "AxB")).toEqual([]);
		expect(allMatches(regex, "A.B")).toEqual(["A.B"]);
	});
});

describe("splitMentionSegments", () => {
	it("returns no segments for empty text", () => {
		expect(splitMentionSegments("", coloredPersonas)).toEqual([]);
	});

	it("returns one text segment when there are no personas", () => {
		expect(splitMentionSegments("hello", {})).toEqual([
			{ kind: "text", text: "hello" },
		]);
	});

	it("splits text around mentions and carries the persona colour", () => {
		expect(
			splitMentionSegments("hi *Ember, ask sage.", coloredPersonas),
		).toEqual([
			{ kind: "text", text: "hi " },
			{ kind: "mention", text: "*Ember", color: "#e07a5f" },
			{ kind: "text", text: ", ask " },
			{ kind: "mention", text: "sage", color: "#81b29a" },
			{ kind: "text", text: "." },
		]);
	});

	it("omits empty text segments between adjacent mentions", () => {
		expect(splitMentionSegments("Ember Sage", coloredPersonas)).toEqual([
			{ kind: "mention", text: "Ember", color: "#e07a5f" },
			{ kind: "text", text: " " },
			{ kind: "mention", text: "Sage", color: "#81b29a" },
		]);
	});
});
