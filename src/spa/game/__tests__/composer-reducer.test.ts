import { describe, expect, it } from "vitest";
import type { ComposerState } from "../composer-reducer.js";
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

const SAGE_COLOR = "#81b29a";
const FROST_COLOR = "#5fa8d3";
const EMBER_COLOR = "#e07a5f";

function lockoutsFor(locked: AiId[]): ReadonlyMap<AiId, boolean> {
	return new Map<AiId, boolean>(
		(["red", "green", "cyan"] as const).map((id) => [id, locked.includes(id)]),
	);
}

function unaddressed(lockedPanels: AiId[] = []): ComposerState {
	return {
		addressee: null,
		sendEnabled: false,
		borderColor: null,
		panelHighlight: null,
		mentionHighlight: null,
		lockoutError: null,
		lockedPanels: new Set(lockedPanels),
	};
}

function addressed(
	addressee: AiId,
	color: string,
	highlight: { start: number; end: number },
	state: {
		sendEnabled: boolean;
		lockoutError?: string;
		lockedPanels?: AiId[];
	},
): ComposerState {
	return {
		addressee,
		sendEnabled: state.sendEnabled,
		borderColor: color,
		panelHighlight: addressee,
		mentionHighlight: { ...highlight, color },
		lockoutError: state.lockoutError ?? null,
		lockedPanels: new Set(state.lockedPanels ?? []),
	};
}

const SAGE_FIRST = { start: 0, end: 5 };
const SAGE_AFTER_HI = { start: 3, end: 8 };
const SIX_LETTER_FIRST = { start: 0, end: 6 };

describe("deriveComposerState", () => {
	it.each<{
		name: string;
		text: string;
		locked: AiId[];
		expected: ComposerState;
	}>([
		{
			name: "empty text → all-null visual fields",
			text: "",
			locked: [],
			expected: unaddressed(),
		},
		{
			name: '"hi" → all-null visual fields',
			text: "hi",
			locked: [],
			expected: unaddressed(),
		},
		{
			name: '"*Sage" no lockouts → sendEnabled: false (no body), visual fields populated',
			text: "*Sage",
			locked: [],
			expected: addressed("green", SAGE_COLOR, SAGE_FIRST, {
				sendEnabled: false,
			}),
		},
		{
			name: '"*Sage hi" no lockouts → sendEnabled: true, visual fields populated',
			text: "*Sage hi",
			locked: [],
			expected: addressed("green", SAGE_COLOR, SAGE_FIRST, {
				sendEnabled: true,
			}),
		},
		{
			name: '"*Sage hi" green locked → sendEnabled: false, lockoutError set, lockedPanels has green',
			text: "*Sage hi",
			locked: ["green"],
			expected: addressed("green", SAGE_COLOR, SAGE_FIRST, {
				sendEnabled: false,
				lockoutError: "Sage isn't reading right now",
				lockedPanels: ["green"],
			}),
		},
		{
			name: '"*Sage," → mentionHighlight.end = 5 (nameEnd, NOT 6 — trailing punct excluded from highlight)',
			text: "*Sage,",
			locked: [],
			expected: addressed("green", SAGE_COLOR, SAGE_FIRST, {
				sendEnabled: false,
			}),
		},
		{
			name: '"hi *Sage" → mentionHighlight.start = 3, end = 8',
			text: "hi *Sage",
			locked: [],
			expected: addressed("green", SAGE_COLOR, SAGE_AFTER_HI, {
				sendEnabled: true,
			}),
		},
		{
			name: '"*Frost *Sage" cyan-locked → addressee cyan, sendEnabled false, lockoutError set for Frost',
			text: "*Frost *Sage",
			locked: ["cyan"],
			expected: addressed("cyan", FROST_COLOR, SIX_LETTER_FIRST, {
				sendEnabled: false,
				lockoutError: "Frost isn't reading right now",
				lockedPanels: ["cyan"],
			}),
		},
		{
			name: '"*Ember hi" green locked → addressee red, sendEnabled true, no lockoutError',
			text: "*Ember hi",
			locked: ["green"],
			expected: addressed("red", EMBER_COLOR, SIX_LETTER_FIRST, {
				sendEnabled: true,
				lockedPanels: ["green"],
			}),
		},
		{
			name: '"*Nonpersona hi" no lockouts → all-null visual fields',
			text: "*Nonpersona hi",
			locked: [],
			expected: unaddressed(),
		},
		{
			name: '"*Frost *Sage" no lockouts → addressee cyan, sendEnabled true (body = *Sage)',
			text: "*Frost *Sage",
			locked: [],
			expected: addressed("cyan", FROST_COLOR, SIX_LETTER_FIRST, {
				sendEnabled: true,
			}),
		},
		{
			name: '"*Sage " (trailing space only) → sendEnabled: false',
			text: "*Sage ",
			locked: [],
			expected: addressed("green", SAGE_COLOR, SAGE_FIRST, {
				sendEnabled: false,
			}),
		},
		{
			name: '"*Sage  " (two trailing spaces) → sendEnabled: false',
			text: "*Sage  ",
			locked: [],
			expected: addressed("green", SAGE_COLOR, SAGE_FIRST, {
				sendEnabled: false,
			}),
		},
		{
			name: '"hi *Sage there" → sendEnabled: true (body on both sides)',
			text: "hi *Sage there",
			locked: [],
			expected: addressed("green", SAGE_COLOR, SAGE_AFTER_HI, {
				sendEnabled: true,
			}),
		},
		{
			name: '"*sage hi" (lowercase mention) → sendEnabled: true',
			text: "*sage hi",
			locked: [],
			expected: addressed("green", SAGE_COLOR, SAGE_FIRST, {
				sendEnabled: true,
			}),
		},
		{
			name: "empty text + green locked → lockoutError: null, lockedPanels has green",
			text: "",
			locked: ["green"],
			expected: unaddressed(["green"]),
		},
		{
			name: '"*Nonpersona hi" + green locked → lockoutError: null, lockedPanels has green',
			text: "*Nonpersona hi",
			locked: ["green"],
			expected: unaddressed(["green"]),
		},
		{
			name: "multiple locks red+green, *Sage hi → lockoutError for Sage, lockedPanels has both",
			text: "*Sage hi",
			locked: ["red", "green"],
			expected: addressed("green", SAGE_COLOR, SAGE_FIRST, {
				sendEnabled: false,
				lockoutError: "Sage isn't reading right now",
				lockedPanels: ["red", "green"],
			}),
		},
	])("$name", ({ text, locked, expected }) => {
		expect(
			deriveComposerState({
				text,
				lockouts: lockoutsFor(locked),
				personaNamesToId,
				personaColors,
				personaDisplayNames,
			}),
		).toEqual(expected);
	});

	it('"*Sage tell *Frost ..." → only first mention highlighted (covers *Sage)', () => {
		const result = deriveComposerState({
			text: "*Sage tell *Frost ...",
			lockouts: lockoutsFor([]),
			personaNamesToId,
			personaColors,
			personaDisplayNames,
		});
		expect(result.addressee).toBe("green");
		expect(result.mentionHighlight).toEqual({
			...SAGE_FIRST,
			color: SAGE_COLOR,
		});
	});
});
