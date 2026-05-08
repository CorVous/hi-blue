import { describe, expect, it } from "vitest";
import { deriveComposerState } from "../composer-reducer.js";
import {
	buildPersonaColorMap,
	buildPersonaDisplayNameMap,
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
		typingQuirks: [
			"You speak in fragments. Short bursts. Rarely complete sentences.",
			"You lean on em-dashes — interrupting yourself mid-sentence — and rarely use commas where a dash would do.",
		],
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirks: [
			"You lean on ellipses… trailing off mid-thought… rarely landing cleanly.",
			"You use ALL-CAPS to emphasize the one or two words that MATTER in any given sentence.",
		],
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: [
			'You never use contractions. You will not say "won\'t" or "can\'t" — you say "will not" and "cannot" every time.',
			"You end almost every reply with a question, no matter what the topic is — does that make sense?",
		],
		blurb: "You are laconic and diffident. Hold the key at phase end.",
	},
};

const personaNamesToId = buildPersonaNameMap(COMPOSER_PERSONAS);
const personaColors = buildPersonaColorMap(COMPOSER_PERSONAS);
const personaDisplayNames = buildPersonaDisplayNameMap(COMPOSER_PERSONAS);

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

function multiLockouts(locked: AiId[]): ReadonlyMap<AiId, boolean> {
	const m = new Map<AiId, boolean>([
		["red", false],
		["green", false],
		["blue", false],
	]);
	for (const id of locked) m.set(id, true);
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
				personaDisplayNames,
			}),
		).toEqual({
			addressee: null,
			sendEnabled: false,
			borderColor: null,
			panelHighlight: null,
			mentionHighlight: null,
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"hi" → all-null visual fields', () => {
		expect(
			deriveComposerState({
				text: "hi",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: null,
			sendEnabled: false,
			borderColor: null,
			panelHighlight: null,
			mentionHighlight: null,
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"*Sage" no lockouts → sendEnabled: false (no body), visual fields populated', () => {
		expect(
			deriveComposerState({
				text: "*Sage",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"*Sage hi" no lockouts → sendEnabled: true, visual fields populated', () => {
		expect(
			deriveComposerState({
				text: "*Sage hi",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"*Sage hi" green locked → sendEnabled: false, lockoutError set, lockedPanels has green', () => {
		expect(
			deriveComposerState({
				text: "*Sage hi",
				lockouts: lockouts("green"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
			lockoutError: "Sage isn't reading right now",
			lockedPanels: new Set(["green"]),
		});
	});

	it('"*Sage," → mentionHighlight.end = 5 (nameEnd, NOT 6 — trailing punct excluded from highlight)', () => {
		expect(
			deriveComposerState({
				text: "*Sage,",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"*Sage tell *Frost ..." → only first mention highlighted (covers *Sage)', () => {
		const result = deriveComposerState({
			text: "*Sage tell *Frost ...",
			lockouts: noLockouts(),
			personaNamesToId,
			personaColors,
			personaDisplayNames,
		});
		expect(result.addressee).toBe("green");
		expect(result.mentionHighlight).toEqual({
			start: 0,
			end: 5,
			color: "#81b29a",
		});
	});

	it('"hi *Sage" → mentionHighlight.start = 3, end = 8', () => {
		expect(
			deriveComposerState({
				text: "hi *Sage",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 3, end: 8, color: "#81b29a" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"*Frost *Sage" blue-locked → addressee blue, sendEnabled false, lockoutError set for Frost', () => {
		expect(
			deriveComposerState({
				text: "*Frost *Sage",
				lockouts: lockouts("blue"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "blue",
			sendEnabled: false,
			borderColor: "#5fa8d3",
			panelHighlight: "blue",
			mentionHighlight: { start: 0, end: 6, color: "#5fa8d3" },
			lockoutError: "Frost isn't reading right now",
			lockedPanels: new Set(["blue"]),
		});
	});

	it('"*Ember hi" green locked → { addressee: "red", sendEnabled: true, lockoutError: null }', () => {
		expect(
			deriveComposerState({
				text: "*Ember hi",
				lockouts: lockouts("green"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "red",
			sendEnabled: true,
			borderColor: "#e07a5f",
			panelHighlight: "red",
			mentionHighlight: { start: 0, end: 6, color: "#e07a5f" },
			lockoutError: null,
			lockedPanels: new Set(["green"]),
		});
	});

	it('"*Nonpersona hi" no lockouts → all-null visual fields', () => {
		expect(
			deriveComposerState({
				text: "*Nonpersona hi",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: null,
			sendEnabled: false,
			borderColor: null,
			panelHighlight: null,
			mentionHighlight: null,
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"*Frost *Sage" no lockouts → addressee blue, sendEnabled true (body = *Sage)', () => {
		expect(
			deriveComposerState({
				text: "*Frost *Sage",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "blue",
			sendEnabled: true,
			borderColor: "#5fa8d3",
			panelHighlight: "blue",
			mentionHighlight: { start: 0, end: 6, color: "#5fa8d3" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	// Body-after-mention rule: persisted prefix cases
	it('"*Sage " (trailing space only) → sendEnabled: false', () => {
		expect(
			deriveComposerState({
				text: "*Sage ",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"*Sage  " (two trailing spaces) → sendEnabled: false', () => {
		expect(
			deriveComposerState({
				text: "*Sage  ",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"hi *Sage there" → sendEnabled: true (body on both sides)', () => {
		expect(
			deriveComposerState({
				text: "hi *Sage there",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 3, end: 8, color: "#81b29a" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"*sage hi" (lowercase mention) → sendEnabled: true', () => {
		expect(
			deriveComposerState({
				text: "*sage hi",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	// New lockout-specific tests
	it("empty text + green locked → lockoutError: null, lockedPanels has green", () => {
		expect(
			deriveComposerState({
				text: "",
				lockouts: lockouts("green"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: null,
			sendEnabled: false,
			borderColor: null,
			panelHighlight: null,
			mentionHighlight: null,
			lockoutError: null,
			lockedPanels: new Set(["green"]),
		});
	});

	it('"*Nonpersona hi" + green locked → lockoutError: null, lockedPanels has green', () => {
		expect(
			deriveComposerState({
				text: "*Nonpersona hi",
				lockouts: lockouts("green"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: null,
			sendEnabled: false,
			borderColor: null,
			panelHighlight: null,
			mentionHighlight: null,
			lockoutError: null,
			lockedPanels: new Set(["green"]),
		});
	});

	it("multiple locks red+green, *Sage hi → lockoutError for Sage, lockedPanels has both", () => {
		expect(
			deriveComposerState({
				text: "*Sage hi",
				lockouts: multiLockouts(["red", "green"]),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "#81b29a",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "#81b29a" },
			lockoutError: "Sage isn't reading right now",
			lockedPanels: new Set(["red", "green"]),
		});
	});

	it('"*Frost *Sage" + blue locked → lockoutError for Frost, lockedPanels has blue', () => {
		expect(
			deriveComposerState({
				text: "*Frost *Sage",
				lockouts: lockouts("blue"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "blue",
			sendEnabled: false,
			borderColor: "#5fa8d3",
			panelHighlight: "blue",
			mentionHighlight: { start: 0, end: 6, color: "#5fa8d3" },
			lockoutError: "Frost isn't reading right now",
			lockedPanels: new Set(["blue"]),
		});
	});
});
