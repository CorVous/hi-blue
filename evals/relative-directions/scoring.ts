/**
 * evals/relative-directions/scoring.ts
 *
 * Pure-function scoring module for the relative-directions eval harness.
 * No I/O, no side effects, no module-level fetch.
 *
 * Exported surface:
 *   - detectCardinalLeaks(text) → string[]
 *   - parseStatedDirection(text) → RelativeDirection | null
 *   - structuralCoherence(stated, toolCall) → "match" | "mismatch" | "no-statement" | "no-toolcall"
 *   - scoreScenario(turns) → ScenarioScore
 */

import type { RelativeDirection } from "../../src/spa/game/direction.js";
import type { CardinalDirection } from "../../src/spa/game/types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

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
 * Regexes for cardinal compass words used as directional references.
 *
 * The check is split in two so each form has the right case-sensitivity:
 *
 *  - Long forms (north/south/east/west) match case-INSENSITIVELY so "North",
 *    "NORTH", and "north" all flag. Word boundaries (`\b`) ensure compound
 *    adjectives like "northern", "eastward" are NOT matched.
 *
 *  - Single-letter forms (N/S/E/W) match case-SENSITIVELY — uppercase only.
 *    The earlier case-insensitive version triggered constantly on possessives
 *    like "water's edge" (where `\bs\b` matches the bare `s` between the
 *    apostrophe and the following space), drowning real leaks in noise.
 *    Uppercase-only catches abbreviated bearings ("Move N toward the door")
 *    without flagging ordinary English. A residual false positive remains
 *    for sentence-end initials ("I am Daemon N.") — accepted as preferable
 *    to silently missing real abbreviated leaks.
 *
 * Matches are returned lower-cased.
 */
const CARDINAL_LONG_RE = /\b(north|south|east|west)\b/gi;
const CARDINAL_SHORT_RE = /\b(N|S|E|W)\b/g;

/**
 * Return every cardinal-direction word found in `text`, lower-cased.
 * An empty array means no leaks were detected.
 */
export function detectCardinalLeaks(text: string): string[] {
	const long = [...text.matchAll(CARDINAL_LONG_RE)].map((m) =>
		m[0].toLowerCase(),
	);
	const short = [...text.matchAll(CARDINAL_SHORT_RE)].map((m) =>
		m[0].toLowerCase(),
	);
	return [...long, ...short];
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
 * Pass threshold: zero cardinal leaks AND no structural coherence mismatches
 * (when statements are made).
 */
export function scoreScenario(turns: TurnRecord[]): ScenarioScore {
	if (turns.length === 0) {
		return {
			cardinalLeakCount: 0,
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

	const passed = cardinalLeakCount === 0 && structuralMismatchCount === 0;

	return {
		cardinalLeakCount,
		silenceRate,
		structuralCoherenceRate,
		structuralMismatchCount,
		passed,
	};
}
