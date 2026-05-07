import { describe, expect, it } from "vitest";
import { PERSONAS } from "../../../content/personas.js";
import { deriveComposerState } from "../composer-reducer.js";
import {
	buildPersonaColorMap,
	buildPersonaDisplayNameMap,
	buildPersonaNameMap,
} from "../mention-parser.js";
import type { AiId } from "../types.js";

// Re-use the real PERSONAS so the map is canonical.
const personaNamesToId = buildPersonaNameMap(PERSONAS);
const personaColors = buildPersonaColorMap(PERSONAS);
const personaDisplayNames = buildPersonaDisplayNameMap(PERSONAS);

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

	it('"@Sage" no lockouts → sendEnabled: false (no body), visual fields populated', () => {
		expect(
			deriveComposerState({
				text: "@Sage",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"@Sage hi" no lockouts → sendEnabled: true, visual fields populated', () => {
		expect(
			deriveComposerState({
				text: "@Sage hi",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"@Sage hi" green locked → sendEnabled: false, lockoutError set, lockedPanels has green', () => {
		expect(
			deriveComposerState({
				text: "@Sage hi",
				lockouts: lockouts("green"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
			lockoutError: "Sage isn't reading right now",
			lockedPanels: new Set(["green"]),
		});
	});

	it('"@Sage," → mentionHighlight.end = 5 (nameEnd, NOT 6 — trailing punct excluded from highlight)', () => {
		expect(
			deriveComposerState({
				text: "@Sage,",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"@Sage tell @Frost ..." → only first mention highlighted (covers @Sage)', () => {
		const result = deriveComposerState({
			text: "@Sage tell @Frost ...",
			lockouts: noLockouts(),
			personaNamesToId,
			personaColors,
			personaDisplayNames,
		});
		expect(result.addressee).toBe("green");
		expect(result.mentionHighlight).toEqual({
			start: 0,
			end: 5,
			color: "green",
		});
	});

	it('"hi @Sage" → mentionHighlight.start = 3, end = 8', () => {
		expect(
			deriveComposerState({
				text: "hi @Sage",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 3, end: 8, color: "green" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"@Frost @Sage" blue-locked → addressee blue, sendEnabled false, lockoutError set for Frost', () => {
		expect(
			deriveComposerState({
				text: "@Frost @Sage",
				lockouts: lockouts("blue"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "blue",
			sendEnabled: false,
			borderColor: "blue",
			panelHighlight: "blue",
			mentionHighlight: { start: 0, end: 6, color: "blue" },
			lockoutError: "Frost isn't reading right now",
			lockedPanels: new Set(["blue"]),
		});
	});

	it('"@Ember hi" green locked → { addressee: "red", sendEnabled: true, lockoutError: null }', () => {
		expect(
			deriveComposerState({
				text: "@Ember hi",
				lockouts: lockouts("green"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "red",
			sendEnabled: true,
			borderColor: "red",
			panelHighlight: "red",
			mentionHighlight: { start: 0, end: 6, color: "red" },
			lockoutError: null,
			lockedPanels: new Set(["green"]),
		});
	});

	it('"@Nonpersona hi" no lockouts → all-null visual fields', () => {
		expect(
			deriveComposerState({
				text: "@Nonpersona hi",
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

	it('"@Frost @Sage" no lockouts → addressee blue, sendEnabled true (body = @Sage)', () => {
		expect(
			deriveComposerState({
				text: "@Frost @Sage",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "blue",
			sendEnabled: true,
			borderColor: "blue",
			panelHighlight: "blue",
			mentionHighlight: { start: 0, end: 6, color: "blue" },
			lockoutError: null,
			lockedPanels: new Set(),
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
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"@Sage  " (two trailing spaces) → sendEnabled: false', () => {
		expect(
			deriveComposerState({
				text: "@Sage  ",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"hi @Sage there" → sendEnabled: true (body on both sides)', () => {
		expect(
			deriveComposerState({
				text: "hi @Sage there",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 3, end: 8, color: "green" },
			lockoutError: null,
			lockedPanels: new Set(),
		});
	});

	it('"@sage hi" (lowercase mention) → sendEnabled: true', () => {
		expect(
			deriveComposerState({
				text: "@sage hi",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
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

	it('"@Nonpersona hi" + green locked → lockoutError: null, lockedPanels has green', () => {
		expect(
			deriveComposerState({
				text: "@Nonpersona hi",
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

	it("multiple locks red+green, @Sage hi → lockoutError for Sage, lockedPanels has both", () => {
		expect(
			deriveComposerState({
				text: "@Sage hi",
				lockouts: multiLockouts(["red", "green"]),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: false,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
			lockoutError: "Sage isn't reading right now",
			lockedPanels: new Set(["red", "green"]),
		});
	});

	it('"@Frost @Sage" + blue locked → lockoutError for Frost, lockedPanels has blue', () => {
		expect(
			deriveComposerState({
				text: "@Frost @Sage",
				lockouts: lockouts("blue"),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual({
			addressee: "blue",
			sendEnabled: false,
			borderColor: "blue",
			panelHighlight: "blue",
			mentionHighlight: { start: 0, end: 6, color: "blue" },
			lockoutError: "Frost isn't reading right now",
			lockedPanels: new Set(["blue"]),
		});
	});
});
