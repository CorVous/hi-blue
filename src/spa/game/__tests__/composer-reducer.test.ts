import { describe, expect, it } from "vitest";
import { PERSONAS } from "../../../content/personas.js";
import { deriveComposerState } from "../composer-reducer.js";
import { buildPersonaColorMap, buildPersonaNameMap } from "../mention-parser.js";
import type { AiId } from "../types.js";

// Re-use the real PERSONAS so the map is canonical.
const personaNamesToId = buildPersonaNameMap(PERSONAS);
const personaColors = buildPersonaColorMap(PERSONAS);

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
	it('empty text → all fields null/false', () => {
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

	it('"hi" → all fields null/false', () => {
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

	it('"@Sage" no lockouts → visual fields populated with green', () => {
		expect(
			deriveComposerState({
				text: "@Sage",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
		});
	});

	it('"@Sage hi" no lockouts → visual fields populated, range [0,5)', () => {
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
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
		});
	});

	it('"@Sage hi" green locked → sendEnabled false BUT visual fields still populated', () => {
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
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
		});
	});

	it('"@Ember hi" green locked → addressee red, visual fields red', () => {
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
			borderColor: "red",
			panelHighlight: "red",
			mentionHighlight: { start: 0, end: 6, color: "red" },
		});
	});

	it('"@Nonpersona hi" no lockouts → all fields null/false', () => {
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

	it('"@Sage," no lockouts → trailing comma excluded from range', () => {
		expect(
			deriveComposerState({
				text: "@Sage,",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
		});
	});

	it('"@Sage tell @Frost ..." → only first mention fields used', () => {
		expect(
			deriveComposerState({
				text: "@Sage tell @Frost ...",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 0, end: 5, color: "green" },
		});
	});

	it('"hi @Sage how" → range [3, 8)', () => {
		expect(
			deriveComposerState({
				text: "hi @Sage how",
				lockouts: noLockouts(),
				personaNamesToId,
				personaColors,
			}),
		).toEqual({
			addressee: "green",
			sendEnabled: true,
			borderColor: "green",
			panelHighlight: "green",
			mentionHighlight: { start: 3, end: 8, color: "green" },
		});
	});

	it('"@Frost @Sage" no lockouts → addressee blue, visual fields blue', () => {
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
			borderColor: "blue",
			panelHighlight: "blue",
			mentionHighlight: { start: 0, end: 6, color: "blue" },
		});
	});

	it('"@Frost @Sage" blue locked → sendEnabled false, visual fields still blue', () => {
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
			borderColor: "blue",
			panelHighlight: "blue",
			mentionHighlight: { start: 0, end: 6, color: "blue" },
		});
	});
});
