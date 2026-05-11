/**
 * evals/relative-directions/scoring.ts
 *
 * Pure-function scoring module for the relative-directions eval harness.
 * No I/O, no side effects, no module-level fetch.
 *
 * Exported surface:
 *   - detectCardinalLeaks(text) → string[]
 *   - landmarkMentions(text, landmarks) → { mentioned, matchesExpected }
 *   - parseStatedDirection(text) → RelativeDirection | null
 *   - structuralCoherence(stated, toolCall) → "match" | "mismatch" | "no-statement" | "no-toolcall"
 *   - scoreScenario(turns) → ScenarioScore
 */

import type { RelativeDirection } from "../../src/spa/game/direction.js";
import type {
	CardinalDirection,
	ContentPack,
} from "../../src/spa/game/types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Landmarks = ContentPack["landmarks"];

/**
 * Per-turn record gathered by the harness.
 * The `statedDirection` and `toolCallDirection` fields power the structural
 * coherence check: do the daemon's words match its actions?
 */
export interface TurnRecord {
	turn: number;
	/** Full assistant prose from this turn. */
	text: string;
	/** Tool call names + serialized arguments from this turn ("go({"direction":"forward"})"). */
	toolCalls: string[];
	/** Cardinal-word leaks found in the daemon's prose (lower-cased). */
	cardinalLeaks: string[];
	/** True when the expected horizon landmark's shortName appears in the prose. */
	landmarkMentioned: boolean;
	/** Actor facing before this turn was taken. */
	facingBefore: CardinalDirection;
	/** Actor facing after this turn resolved. */
	facingAfter: CardinalDirection;
	/**
	 * The relative direction the daemon *stated* in prose before acting
	 * ("I'll go forward", "I move left", …). Null when no movement statement found.
	 */
	statedDirection: RelativeDirection | null;
	/**
	 * The relative direction the daemon's *tool call* resolved to.
	 * Null when no movement tool call was made this turn.
	 */
	toolCallDirection: RelativeDirection | null;
}

export interface ScenarioScore {
	cardinalLeakCount: number;
	landmarkConsistencyRate: number;
	silenceRate: number;
	/** Fraction of turns where stated direction matched tool call direction. */
	structuralCoherenceRate: number;
	/**
	 * Number of turns where a movement statement was made but the tool call
	 * direction disagreed with it (a concrete coherence failure).
	 */
	structuralMismatchCount: number;
	passed: boolean;
}

export type CoherenceVerdict =
	| "match"
	| "mismatch"
	| "no-statement"
	| "no-toolcall";

// ── Cardinal leak detection ───────────────────────────────────────────────────

/**
 * Regex for cardinal compass words used as directional references.
 *
 * Design decision: We use word-boundary `\b` anchors and the `i` flag so that
 * "North", "NORTH", "north" etc. are all detected, while compound words like
 * "northern", "northeastern", "southwestern" are NOT matched — those are
 * adjectives, not explicit compass bearings.  The single-letter forms N/S/E/W
 * ARE matched as standalone words (case-insensitive with `i` flag); they will
 * false-positive on things like "I'm Daemon N." but that sentence form is
 * unlikely in gameplay prose and the false-positive cost (over-reporting leaks)
 * is preferable to silently missing a real direction leak.
 *
 * "eastward", "westward", "northward", "southward" are NOT matched because
 * they are directional adverbs without the compass-bearing semantics we care
 * about in this eval.
 *
 * Matches are returned lower-cased.
 */
const CARDINAL_RE = /\b(north|south|east|west|N|S|E|W)\b/gi;

/**
 * Return every cardinal-direction word found in `text`, lower-cased.
 * An empty array means no leaks were detected.
 */
export function detectCardinalLeaks(text: string): string[] {
	return [...text.matchAll(CARDINAL_RE)].map((m) => m[0].toLowerCase());
}

// ── Landmark mention detection ────────────────────────────────────────────────

/**
 * Check whether the daemon's prose mentions landmarks.
 *
 * Strategy: for each cardinal direction's landmark, check whether its
 * `shortName` (case-insensitive substring) appears in `text`. We also
 * accept any capitalised key noun from the shortName ("the rusted radio tower"
 * → try "radio tower", "tower" — last-word fallback).
 *
 * Returns:
 *   - `mentioned`: the cardinal anchors whose landmarks were referenced.
 *   - `matchesExpected`: true when the expected anchor's landmark was found.
 */
export function landmarkMentions(
	text: string,
	landmarks: Landmarks,
	expectedFacing?: CardinalDirection,
): { mentioned: CardinalDirection[]; matchesExpected: boolean } {
	const lower = text.toLowerCase();
	const mentioned: CardinalDirection[] = [];

	for (const dir of ["north", "south", "east", "west"] as const) {
		const lm = landmarks[dir];
		const shortLower = lm.shortName.toLowerCase();

		// Primary check: shortName substring match
		if (lower.includes(shortLower)) {
			mentioned.push(dir);
			continue;
		}

		// Fallback: last meaningful word of the shortName (skip leading "the", "a", "an")
		const words = shortLower
			.split(/\s+/)
			.filter((w) => !["the", "a", "an"].includes(w));
		const lastWord = words[words.length - 1];
		if (lastWord && lastWord.length >= 4 && lower.includes(lastWord)) {
			mentioned.push(dir);
		}
	}

	const matchesExpected =
		expectedFacing !== undefined ? mentioned.includes(expectedFacing) : false;

	return { mentioned, matchesExpected };
}

// ── Stated-direction parser ───────────────────────────────────────────────────

/**
 * Parse the daemon's prose for an explicit first-person movement statement.
 *
 * Recognised patterns (case-insensitive):
 *   "go/going forward", "move/moving forward", "step/stepping forward",
 *   "turn/turning forward" (unusual but accepted), "I'll go forward",
 *   "I am going forward", "I will move left", "moving back", etc.
 *
 * Also accepts synonym "ahead" for "forward" and "backward/backwards" for "back".
 *
 * Returns the normalised RelativeDirection, or null if no clear statement found.
 *
 * This is best-effort regex heuristics — false negatives are acceptable,
 * false positives (wrong direction parsed) are the important failure mode.
 */
const STATED_DIR_RE =
	/\b(?:go(?:ing)?|mov(?:e|ing)|step(?:ping)?|turn(?:ing)?|head(?:ing)?|walk(?:ing)?)\s+(?:to(?:wards?)?\s+)?(?:my\s+)?(forward|ahead|backwards?|back|left|right)\b/gi;

export function parseStatedDirection(text: string): RelativeDirection | null {
	for (const m of text.matchAll(STATED_DIR_RE)) {
		const raw = (m[1] ?? "").toLowerCase();
		if (raw === "forward" || raw === "ahead") return "forward";
		if (raw === "back" || raw === "backward" || raw === "backwards")
			return "back";
		if (raw === "left") return "left";
		if (raw === "right") return "right";
	}
	return null;
}

// ── Structural coherence ──────────────────────────────────────────────────────

/**
 * Compare what the daemon said it would do with what it actually did.
 *
 * - "match": stated direction == tool call direction ✓
 * - "mismatch": stated a direction but called a different one ✗ (coherence failure)
 * - "no-statement": daemon emitted no parseable movement statement
 * - "no-toolcall": daemon made no movement tool call (may be fine — looking, messaging, etc.)
 */
export function structuralCoherence(
	statedDirection: RelativeDirection | null,
	toolCallDirection: RelativeDirection | null,
): CoherenceVerdict {
	if (statedDirection === null) return "no-statement";
	if (toolCallDirection === null) return "no-toolcall";
	return statedDirection === toolCallDirection ? "match" : "mismatch";
}

// ── Scenario aggregator ───────────────────────────────────────────────────────

/**
 * Aggregate a list of TurnRecords into a ScenarioScore.
 *
 * Pass threshold: zero cardinal leaks AND landmark consistency ≥ 50% AND
 * no structural coherence mismatches (when statements are made).
 */
export function scoreScenario(turns: TurnRecord[]): ScenarioScore {
	if (turns.length === 0) {
		return {
			cardinalLeakCount: 0,
			landmarkConsistencyRate: 0,
			silenceRate: 0,
			structuralCoherenceRate: 0,
			structuralMismatchCount: 0,
			passed: false,
		};
	}

	const cardinalLeakCount = turns.reduce(
		(n, t) => n + t.cardinalLeaks.length,
		0,
	);
	const landmarkConsistencyRate =
		turns.filter((t) => t.landmarkMentioned).length / turns.length;
	const silenceRate =
		turns.filter((t) => t.toolCalls.length === 0).length / turns.length;

	// Structural coherence: count turns where both stated + tool call are present
	const decisiveTurns = turns.filter(
		(t) => t.statedDirection !== null && t.toolCallDirection !== null,
	);
	const matchCount = decisiveTurns.filter(
		(t) => t.statedDirection === t.toolCallDirection,
	).length;
	const structuralMismatchCount = decisiveTurns.length - matchCount;
	const structuralCoherenceRate =
		decisiveTurns.length > 0 ? matchCount / decisiveTurns.length : 1;

	const passed =
		cardinalLeakCount === 0 &&
		landmarkConsistencyRate >= 0.5 &&
		structuralMismatchCount === 0;

	return {
		cardinalLeakCount,
		landmarkConsistencyRate,
		silenceRate,
		structuralCoherenceRate,
		structuralMismatchCount,
		passed,
	};
}
