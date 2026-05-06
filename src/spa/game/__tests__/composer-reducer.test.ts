import { describe, expect, it } from "vitest";
import { PERSONAS } from "../../../content/personas.js";
import { deriveComposerState } from "../composer-reducer.js";
import { buildPersonaNameMap } from "../mention-parser.js";
import type { AiId } from "../types.js";

// Re-use the real PERSONAS so the map is canonical.
const personaNamesToId = buildPersonaNameMap(PERSONAS);

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
	it("empty text → { addressee: null, sendEnabled: false }", () => {
		expect(
			deriveComposerState({
				text: "",
				lockouts: noLockouts(),
				personaNamesToId,
			}),
		).toEqual({ addressee: null, sendEnabled: false });
	});

	it('"hi" → { addressee: null, sendEnabled: false }', () => {
		expect(
			deriveComposerState({
				text: "hi",
				lockouts: noLockouts(),
				personaNamesToId,
			}),
		).toEqual({ addressee: null, sendEnabled: false });
	});

	it('"@Sage" no lockouts → { addressee: "green", sendEnabled: true }', () => {
		expect(
			deriveComposerState({
				text: "@Sage",
				lockouts: noLockouts(),
				personaNamesToId,
			}),
		).toEqual({ addressee: "green", sendEnabled: true });
	});

	it('"@Sage hi" no lockouts → { addressee: "green", sendEnabled: true }', () => {
		expect(
			deriveComposerState({
				text: "@Sage hi",
				lockouts: noLockouts(),
				personaNamesToId,
			}),
		).toEqual({ addressee: "green", sendEnabled: true });
	});

	it('"@Sage hi" green locked → { addressee: "green", sendEnabled: false }', () => {
		expect(
			deriveComposerState({
				text: "@Sage hi",
				lockouts: lockouts("green"),
				personaNamesToId,
			}),
		).toEqual({ addressee: "green", sendEnabled: false });
	});

	it('"@Ember hi" green locked → { addressee: "red", sendEnabled: true }', () => {
		expect(
			deriveComposerState({
				text: "@Ember hi",
				lockouts: lockouts("green"),
				personaNamesToId,
			}),
		).toEqual({ addressee: "red", sendEnabled: true });
	});

	it('"@Nonpersona hi" no lockouts → { addressee: null, sendEnabled: false }', () => {
		expect(
			deriveComposerState({
				text: "@Nonpersona hi",
				lockouts: noLockouts(),
				personaNamesToId,
			}),
		).toEqual({ addressee: null, sendEnabled: false });
	});

	it('"@Sage," no lockouts → { addressee: "green", sendEnabled: true }', () => {
		expect(
			deriveComposerState({
				text: "@Sage,",
				lockouts: noLockouts(),
				personaNamesToId,
			}),
		).toEqual({ addressee: "green", sendEnabled: true });
	});

	it('"@Frost @Sage" no lockouts → { addressee: "blue", sendEnabled: true }', () => {
		expect(
			deriveComposerState({
				text: "@Frost @Sage",
				lockouts: noLockouts(),
				personaNamesToId,
			}),
		).toEqual({ addressee: "blue", sendEnabled: true });
	});

	it('"@Frost @Sage" blue locked → { addressee: "blue", sendEnabled: false } (no fallthrough)', () => {
		expect(
			deriveComposerState({
				text: "@Frost @Sage",
				lockouts: lockouts("blue"),
				personaNamesToId,
			}),
		).toEqual({ addressee: "blue", sendEnabled: false });
	});
});
