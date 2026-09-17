/**
 * evals/relative-directions/scoring.ts
 *
 * Pure-function scoring module for the direction-vocabulary eval harness.
 * No I/O, no side effects, no module-level fetch.
 *
 * The approved vocabulary is cardinal (ADR 0015, CONTEXT.md **Cardinal
 * directions**): `go` names `north`, `south`, `east`, or `west`, a Daemon has a
 * position and no facing, and positions are described by cardinal direction and
 * distance. The relative vocabulary (`forward`/`back`/`left`/`right`) and any
 * cardinal↔relative conversion are retired and must not be reintroduced here.
 *
 * Scoring therefore reads a daemon naming a cardinal as the desired behaviour,
 * not as leakage, and checks that the cardinal it *stated* in prose agrees with
 * the cardinal its `go` tool call *used*.
 *
 * Exported surface:
 *   - referencedCardinals(text) → CardinalDirection[]
 *   - parseStatedCardinal(text) → CardinalDirection | null
 *   - structuralCoherence(stated, toolCall) → CoherenceVerdict
 *   - scoreScenario(turns) → ScenarioScore
 */

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
	/** Tool call names + serialized arguments from this turn ("go({"direction":"north"})"). */
	toolCalls: string[];
	/** Approved cardinal directions referenced in the daemon's prose (lower-cased). */
	cardinalReferences: string[];
	/**
	 * The cardinal direction the daemon *stated* in prose before acting
	 * ("I'll go north", "the transformer is two steps east", …).
	 * Null when no movement or positional statement naming a cardinal was found.
	 */
	statedDirection: CardinalDirection | null;
	/**
	 * The cardinal direction the daemon's `go` tool call used.
	 * Null when no movement tool call was made this turn.
	 */
	toolCallDirection: CardinalDirection | null;
}

export interface ScenarioScore {
	/**
	 * Turns whose prose named at least one cardinal direction. Approved
	 * behaviour under ADR 0015 — counted so a run that never names a cardinal
	 * is visible, never treated as a pass/fail gate on its own.
	 */
	cardinalStatementTurns: number;
	/** Total cardinal directions referenced across the run. */
	cardinalReferenceCount: number;
	silenceRate: number;
	/** Fraction of turns where stated cardinal matched tool call cardinal. */
	structuralCoherenceRate: number;
	/**
	 * Number of turns where a cardinal statement was made but the `go` tool
	 * call used a different cardinal (a concrete coherence failure).
	 */
	structuralMismatchCount: number;
	passed: boolean;
}

export type CoherenceVerdict =
	| "match"
	| "mismatch"
	| "no-statement"
	| "no-toolcall";

// ── Cardinal reference detection ──────────────────────────────────────────────

/**
 * Regexes for cardinal compass words used as directional references.
 *
 * The check is split in two so each form has the right case-sensitivity:
 *
 *  - Long forms (north/south/east/west) match case-INSENSITIVELY so "North",
 *    "NORTH", and "north" all count. Word boundaries (`\b`) ensure compound
 *    adjectives like "northern", "eastward" are NOT matched.
 *
 *  - Single-letter forms (N/S/E/W) match case-SENSITIVELY — uppercase only.
 *    A case-insensitive version triggers constantly on possessives like
 *    "water's edge" (where `\bs\b` matches the bare `s` between the apostrophe
 *    and the following space). Uppercase-only catches abbreviated bearings
 *    ("move N toward the door") without flagging ordinary English. A residual
 *    false positive remains for sentence-end initials ("I am Daemon N.") —
 *    accepted as preferable to silently missing real abbreviated references.
 *
 * Matches are returned lower-cased.
 */
const CARDINAL_LONG_RE = /\b(north|south|east|west)\b/gi;
const CARDINAL_SHORT_RE = /\b(N|S|E|W)\b/g;

/**
 * Return every cardinal direction named in `text`, lower-cased.
 * Naming a cardinal is approved behaviour; callers record this as evidence of
 * the approved vocabulary, not as a defect.
 */
export function referencedCardinals(text: string): CardinalDirection[] {
	const long = [...text.matchAll(CARDINAL_LONG_RE)].map((m) =>
		m[0].toLowerCase(),
	);
	const short = [...text.matchAll(CARDINAL_SHORT_RE)].map((m) =>
		m[0].toLowerCase(),
	);
	return [...long, ...short] as CardinalDirection[];
}

// ── Stated-cardinal parser ────────────────────────────────────────────────────

/**
 * Word stems that introduce a directional statement. A cardinal reference is a
 * *statement* only when one of these sits in front of it — bare occurrences in
 * scenery prose ("the northern door") do not count. `turn` is deliberately
 * absent: ADR 0015 removed facing, so there is nothing to turn.
 */
const MOVEMENT_VERB =
	"(?:go(?:ing)?|mov(?:e|ing)|step(?:ping)?|head(?:ing)?|walk(?:ing)?|travel(?:ling|ing)?|walk(?:s|ed)?|moved|went|stepped|headed)";
const CARDINAL_ALT = "north|south|east|west";

/**
 * Pattern 1 — an explicit movement statement naming a cardinal:
 *   "I'll go north", "I move east", "Moving south to investigate",
 *   "I am heading west", "I walk north".
 */
const STATED_MOVEMENT_RE = new RegExp(
	`\\b${MOVEMENT_VERB}\\s+(?:to\\s+the\\s+|towards?\\s+|toward\\s+)?(${CARDINAL_ALT})\\b`,
	"i",
);

/**
 * Pattern 2 — a positional statement naming a cardinal direction and distance:
 *   "the transformer is two steps east", "another daemon is one step north",
 *   "two blocks west of you", "the door is north of me".
 * Emitted positions use cardinal direction and distance from the observer's
 * position, never an orientation (ADR 0015).
 */
const STATED_POSITION_RE = new RegExp(
	`\\b(?:one|two|three|four|\\d+)\\s+(?:steps?|blocks?|cells?|squares?)\\s+(?:to\\s+the\\s+)?(${CARDINAL_ALT})\\b`,
	"i",
);
const STATED_BEARING_RE = new RegExp(`\\b(${CARDINAL_ALT})\\s+of\\b`, "i");

const STATED_CARDINAL_RES = [
	STATED_MOVEMENT_RE,
	STATED_POSITION_RE,
	STATED_BEARING_RE,
];

/**
 * Parse the daemon's prose for a directional statement naming a cardinal.
 *
 * Recognised forms (case-insensitive):
 *   - movement: "go/move/step/head/walk/travel north", "I'm going east"
 *   - position: "the transformer is two steps east", "the door is north of me"
 *
 * Returns the normalised CardinalDirection, or null when no such statement is
 * found. Best-effort regex heuristics — false negatives are acceptable, a
 * wrong direction parsed is the important failure mode.
 */
export function parseStatedCardinal(text: string): CardinalDirection | null {
	for (const re of STATED_CARDINAL_RES) {
		const m = re.exec(text);
		if (m?.[1]) return m[1].toLowerCase() as CardinalDirection;
	}
	return null;
}

// ── Structural coherence ──────────────────────────────────────────────────────

/**
 * Compare the cardinal the daemon said it would take with the cardinal its
 * `go` tool call used.
 *
 * - "match": stated cardinal == `go` cardinal ✓
 * - "mismatch": stated a cardinal but moved a different one ✗ (coherence failure)
 * - "no-statement": daemon emitted no parseable directional statement
 * - "no-toolcall": daemon stated a cardinal but made no `go` tool call
 */
export function structuralCoherence(
	statedDirection: CardinalDirection | null,
	toolCallDirection: CardinalDirection | null,
): CoherenceVerdict {
	if (statedDirection === null) return "no-statement";
	if (toolCallDirection === null) return "no-toolcall";
	return statedDirection === toolCallDirection ? "match" : "mismatch";
}

// ── Scenario aggregator ───────────────────────────────────────────────────────

/**
 * Aggregate a list of TurnRecords into a ScenarioScore.
 *
 * Pass rule: no structural coherence mismatches. Naming a cardinal is approved
 * behaviour and is measured (`cardinalStatementTurns`, `cardinalReferenceCount`)
 * but never fails a run; a run that makes no statements has nothing to mismatch.
 */
export function scoreScenario(turns: TurnRecord[]): ScenarioScore {
	if (turns.length === 0) {
		return {
			cardinalStatementTurns: 0,
			cardinalReferenceCount: 0,
			silenceRate: 0,
			structuralCoherenceRate: 0,
			structuralMismatchCount: 0,
			passed: false,
		};
	}

	const cardinalStatementTurns = turns.filter(
		(t) => t.cardinalReferences.length > 0,
	).length;
	const cardinalReferenceCount = turns.reduce(
		(n, t) => n + t.cardinalReferences.length,
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

	const passed = structuralMismatchCount === 0;

	return {
		cardinalStatementTurns,
		cardinalReferenceCount,
		silenceRate,
		structuralCoherenceRate,
		structuralMismatchCount,
		passed,
	};
}
