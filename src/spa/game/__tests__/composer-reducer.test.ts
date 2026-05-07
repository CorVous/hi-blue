import { describe, expect, it } from "vitest";
import { deriveComposerState } from "../composer-reducer.js";
import {
	buildPersonaColorMap,
	buildPersonaNameMap,
} from "../mention-parser.js";
import type { AiId, AiPersona } from "../types.js";

const COMPOSER_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		budgetPerPhase: 5,
	},
};

const personaNamesToId = buildPersonaNameMap(COMPOSER_PERSONAS);
const personaColors = buildPersonaColorMap(COMPOSER_PERSONAS);

function noLockouts(): ReadonlyMap<AiId, boolean> {
	return new Map<AiId, boolean>([
		["red", false],
		["green", false],
		["blue", false],
	]);
}

function lockouts(locked: AiId): ReadonlyMap<AiId, boolean> {
	const m = new Map<AiId, boolean>([
		["red", false],
		["green", false],
		["blue", false],
	]);
	m.set(locked, true);
	return m;
}

describe("deriveComposerState", () => {
	it("empty text → all-null visual fields", () => {
		expect(
			deriveComposerState({
				text: "",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: null,
			sendEnabled: false,
			borderColor: null,
			panelHighlight: null,
			mentionHighlight: null,
		});
	});

	it('"hi" → all-null visual fields', () => {
		expect(
			deriveComposerState({
				text: "hi",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: null,
			sendEnabled: false,
			borderColor: null,
			panelHighlight: null,
			mentionHighlight: null,
		});
	});

	it('"@Sage" no lockouts → sendEnabled: false (no body), visual fields populated', () => {
		expect(
			deriveComposerState({
				text: "@Sage",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
		});
	});

	it('"@Sage hi" no lockouts → sendEnabled: true, visual fields populated', () => {
		expect(
			deriveComposerState({
				text: "@Sage hi",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
		});
	});

	it('"@Sage hi" green locked → sendEnabled: false BUT visual fields still populated', () => {
		expect(
			deriveComposerState({
				text: "@Sage hi",
				lockouts: lockouts("green"),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
		});
	});

	it('"@Sage," → mentionHighlight.end = 5 (nameEnd, NOT 6 — trailing punct excluded from highlight)', () => {
		expect(
			deriveComposerState({
				text: "@Sage,",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
		});
	});

	it('"@Sage tell @Frost ..." → only first mention highlighted (covers @Sage)', () => {
		const result = deriveComposerState({
			text: "@Sage tell @Frost ...",
			lockouts: noLockouts(),
			personaNamesToId,
			personaColors,
		});
		expect(result.addressee).toBe("green");
		expect(result.mentionHighlight).toEqual({
			start: 0,
			end: 5,
			color: "#81b29a",
		});
	});

	it('"hi @Sage" → mentionHighlight.start = 3, end = 8', () => {
		expect(
			deriveComposerState({
				text: "hi @Sage",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 3, end: 8, color: "#81b29a" },
		});
	});

	it('"@Frost @Sage" blue-locked → addressee blue, sendEnabled false, visual fields all blue, range covers @Frost', () => {
		expect(
			deriveComposerState({
				text: "@Frost @Sage",
				lockouts: lockouts("blue"),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "blue",
			sendEnabled: false,
			borderColor: "#5fa8d3",
			panelHighlight: "blue",
			mentionHighlight: { start: 0, end: 6, color: "#5fa8d3" },
		});
	});

	it('"@Ember hi" green locked → { addressee: "red", sendEnabled: true }', () => {
		expect(
			deriveComposerState({
				text: "@Ember hi",
				lockouts: lockouts("green"),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "red",
			sendEnabled: true,
			borderColor: "#e07a5f",
			panelHighlight: "red",
			mentionHighlight: { start: 0, end: 6, color: "#e07a5f" },
		});
	});

	it('"@Nonpersona hi" no lockouts → all-null visual fields', () => {
		expect(
			deriveComposerState({
				text: "@Nonpersona hi",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: null,
			sendEnabled: false,
			borderColor: null,
			panelHighlight: null,
			mentionHighlight: null,
		});
	});

	it('"@Frost @Sage" no lockouts → addressee blue, sendEnabled true (body = @Sage)', () => {
		expect(
			deriveComposerState({
				text: "@Frost @Sage",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "blue",
			sendEnabled: true,
			borderColor: "#5fa8d3",
			panelHighlight: "blue",
			mentionHighlight: { start: 0, end: 6, color: "#5fa8d3" },
		});
	});

	// Body-after-mention rule: persisted prefix cases
	it('"@Sage " (trailing space only) → sendEnabled: false', () => {
		expect(
			deriveComposerState({
				text: "@Sage ",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
		});
	});

	it('"@Sage  " (two trailing spaces) → sendEnabled: false', () => {
		expect(
			deriveComposerState({
				text: "@Sage  ",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
		});
	});

	it('"hi @Sage there" → sendEnabled: true (body on both sides)', () => {
		expect(
			deriveComposerState({
				text: "hi @Sage there",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 3, end: 8, color: "#81b29a" },
		});
	});

	it('"@sage hi" (lowercase mention) → sendEnabled: true', () => {
		expect(
			deriveComposerState({
				text: "@sage hi",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
		});
	});
});
