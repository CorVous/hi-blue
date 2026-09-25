import { describe, expect, it } from "vitest";
import { deriveComposerState } from "../composer-reducer.js";
import {
	buildPersonaColorMap,
	buildPersonaDisplayNameMap,
	buildPersonaNameMap,
} from "../mention-parser.js";
import type { AiId } from "../types.js";
import { TEST_PERSONAS } from "./fixtures/make-game-state";

const personaNamesToId = buildPersonaNameMap(TEST_PERSONAS);
const personaColors = buildPersonaColorMap(TEST_PERSONAS);
const personaDisplayNames = buildPersonaDisplayNameMap(TEST_PERSONAS);

function noLockouts(): ReadonlyMap<AiId, boolean> {
	return new Map<AiId, boolean>([
		["red", false],
		["green", false],
		["cyan", false],
	]);
}

function lockouts(locked: AiId): ReadonlyMap<AiId, boolean> {
	const m = new Map<AiId, boolean>([
		["red", false],
		["green", false],
		["cyan", false],
	]);
	m.set(locked, true);
	return m;
}

function multiLockouts(locked: AiId[]): ReadonlyMap<AiId, boolean> {
	const m = new Map<AiId, boolean>([
		["red", false],
		["green", false],
		["cyan", false],
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

	it('"*Frost *Sage" cyan-locked → addressee cyan, sendEnabled false, lockoutError set for Frost', () => {
		expect(
			deriveComposerState({
				text: "*Frost *Sage",
				lockouts: lockouts("cyan"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "cyan",
			sendEnabled: false,
			borderColor: "#5fa8d3",
			panelHighlight: "cyan",
			mentionHighlight: { start: 0, end: 6, color: "#5fa8d3" },
			lockoutError: "Frost isn't reading right now",
			lockedPanels: new Set(["cyan"]),
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

	it('"*Frost *Sage" no lockouts → addressee cyan, sendEnabled true (body = *Sage)', () => {
		expect(
			deriveComposerState({
				text: "*Frost *Sage",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "cyan",
			sendEnabled: true,
			borderColor: "#5fa8d3",
			panelHighlight: "cyan",
			mentionHighlight: { start: 0, end: 6, color: "#5fa8d3" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

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

	it('"*Frost *Sage" + cyan locked → lockoutError for Frost, lockedPanels has cyan', () => {
		expect(
			deriveComposerState({
				text: "*Frost *Sage",
				lockouts: lockouts("cyan"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "cyan",
			sendEnabled: false,
			borderColor: "#5fa8d3",
			panelHighlight: "cyan",
			mentionHighlight: { start: 0, end: 6, color: "#5fa8d3" },
			lockoutError: "Frost isn't reading right now",
			lockedPanels: new Set(["cyan"]),
		});
	});
});
