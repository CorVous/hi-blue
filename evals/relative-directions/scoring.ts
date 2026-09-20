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
 * not as leakage, and checks that the cardinal it *intended to move* agrees with
 * the cardinal its `go` tool call *used*.
 *
 * **Movement vs position.** Prose names a cardinal for two different reasons:
 *
 *   - a MOVEMENT statement declares an intended action ("I'll go north",
 *     "I'll start exploring north") and must agree with the `go` call;
 *   - a POSITION statement describes where something *is* ("two steps north",
 *     "north of me", "clear to the south") and says nothing about what the
 *     daemon is about to do, so it can never disagree with a `go` call.
 *
 * Conflating the two produced a live false positive: a turn that described its
 * corner position ("Wall one step north … Clear to the south, east, and west")
 * while correctly moving `south` was scored `mismatch`. Coherence is therefore
 * decided from movement statements only; `parseStatedCardinal` is retained as
 * the broader "any directional statement" parser for positional reporting, and
 * `scoreScenario` re-derives movement from each turn's prose when a record does
 * not carry it explicitly.
 *
 * Exported surface:
 *   - referencedCardinals(text) → CardinalDirection[]
 *   - parseDirectionalStatement(text) → DirectionalStatement | null
 *   - parseMovementStatement(text) → MovementStatement | null
 *   - parseStatedCardinal(text) → CardinalDirection | null  (movement ?? position)
 *   - structuralCoherence(statedMovementCardinal, toolCallCardinal) → CoherenceVerdict
 *   - structuralCoherenceForTurn(turn) → CoherenceVerdict
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
	 * The cardinal direction the daemon *stated* in prose, whether as a movement
	 * intent ("I'll go north") or a positional description ("two steps north").
	 * Reporting-only: it is evidence of the approved cardinal vocabulary and is
	 * NEVER used for coherence, because a description states no intent.
	 * Null when no directional statement naming a cardinal was found.
	 */
	statedDirection: CardinalDirection | null;
	/**
	 * The MOVEMENT statement the daemon made this turn, if any. This is the only
	 * statement kind that coherence compares against the `go` tool call: a
	 * positional description ("clear to the south") yields null here and no
	 * coherence verdict beyond "no-statement".
	 * Null when the prose states no movement intent. Optional so turn records
	 * built positionally stay assignable; absent is read as "no movement stated".
	 */
	movementStatement?: MovementStatement | null;
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
	 * call used a different cardinal (a concrete coherence failure). Only
	 * MOVEMENT statements can produce this: a positional description never
	 * counts as a stated intent.
	 */
	structuralMismatchCount: number;
	passed: boolean;
}

export type CoherenceVerdict =
	| "match"
	| "mismatch"
	| "no-statement"
	| "no-toolcall";

/**
 * Which kind of directional statement the prose contained.
 *
 *   - "movement": the daemon declared an intended move ("I'll go north") —
 *     this is the only kind that can agree or disagree with a `go` tool call.
 *   - "position": the daemon described where something is ("two steps north",
 *     "north of me", "clear to the south") — an observation, never an intent.
 */
export type DirectionalStatementKind = "movement" | "position";

/** A directional statement found in prose, tagged with the kind that was found. */
export interface DirectionalStatement {
	kind: DirectionalStatementKind;
	direction: CardinalDirection;
}

/**
 * A directional statement proven to be a movement intent. Narrower than
 * `DirectionalStatement`, so coherence can take only statements that are
 * actually about movement.
 */
export interface MovementStatement {
	kind: "movement";
	direction: CardinalDirection;
}

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
 * Word stems that introduce a MOVEMENT statement. A cardinal reference is a
 * movement *statement* only when one of these verbs sits in front of it —
 * bare occurrences in scenery prose ("the northern door") do not count.
 * `turn` is deliberately absent: ADR 0015 removed facing, so there is nothing
 * to turn.
 *
 * Gerunds and auxiliary forms count ("moving north", "start exploring north"),
 * because a daemon announcing a move often wraps the verb: `MOVEMENT_LINK`
 * lets an article, adverb, or particle sit between the verb and the cardinal,
 * and Pattern 1b covers a start/continue auxiliary in front of the gerund.
 */
const MOVEMENT_VERB =
	"(?:go|goes|going|went|mov(?:e|es|ed|ing)|step(?:s|ped|ping)?|head(?:s|ed|ing)?|walk(?:s|ed|ing)?|travel(?:s|led|ling|ing)?|explor(?:e|es|ed|ing)|approach(?:es|ed|ing)?|proceed(?:s|ed|ing)?|advance(?:s|d|ing)?|retreat(?:s|ed|ing)?|scout(?:s|ed|ing)?|venture(?:s|d|ing)?)";
const MOVEMENT_START_VERB =
	"(?:start(?:s|ed|ing)?|begin(?:s|ning)?|began|continue(?:s|d)?|keep|kept)";
const CARDINAL_ALT = "north|south|east|west";

/**
 * A count word directly before the movement verb belongs to a POSITIONAL
 * distance phrase, not to a movement verb: "one step north", "two steps
 * north", "three blocks west". The distance noun and the movement verb share
 * their spelling for "step", and reading "one step north" as the verb "step"
 * is exactly how a room description was misread as a stated move. Movement
 * patterns therefore refuse to start immediately after a count word.
 */
const DISTANCE_PREFIX =
	"(?<!\\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\\d+)\\s)";

/**
 * Filler permitted between a movement verb and the cardinal: an article
 * ("to the north") or a preposition/adverb/particle ("off toward north",
 * "on north", "straight ahead"). Optional, so a bare "go north" still matches.
 * An auxiliary start/continue verb belongs to Pattern 1b, not here.
 */
const MOVEMENT_LINK =
	"(?:\\s+(?:to\\s+the|to|toward|towards|for|into|off|on|ahead|straight|due|up|out|over|back\\s+to))?";
/**
 * Optional auxiliary chain before the movement verb: "I'll start exploring
 * north", "I will begin walking east", "I continue heading west". Only used by
 * Pattern 1b, where the auxiliary precedes the movement gerund.
 */
const MOVEMENT_AUX = `(?:\\s+${MOVEMENT_START_VERB})?(?:\\s+(?:to|and))?`;

/**
 * Pattern 1 — an explicit movement statement naming a cardinal:
 *   "I'll go north", "I move east", "Moving south to investigate",
 *   "I am heading west", "I walk north".
 */
const STATED_MOVEMENT_RE = new RegExp(
	`${DISTANCE_PREFIX}\\b${MOVEMENT_VERB}\\b${MOVEMENT_LINK}\\s+(${CARDINAL_ALT})\\b`,
	"i",
);

/**
 * Pattern 1b — an auxiliary verb chain in which the movement verb is a gerund
 * preceded by a start/continue verb:
 *   "I'll start exploring north", "I begin walking east", "I keep going west".
 * The movement verb may be followed by its own link phrase ("start moving to
 * the east"), so the same `MOVEMENT_LINK` group applies here.
 */
const STATED_MOVEMENT_CHAIN_RE = new RegExp(
	`${DISTANCE_PREFIX}\\b${MOVEMENT_START_VERB}\\b${MOVEMENT_AUX}\\s+${MOVEMENT_VERB}\\b${MOVEMENT_LINK}\\s+(${CARDINAL_ALT})\\b`,
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

const STATED_MOVEMENT_RES = [STATED_MOVEMENT_RE, STATED_MOVEMENT_CHAIN_RE];
const STATED_POSITION_RES = [STATED_POSITION_RE, STATED_BEARING_RE];

/**
 * Parse the daemon's prose for an intended MOVEMENT statement naming a cardinal.
 *
 * Recognised forms (case-insensitive):
 *   - "go/move/step/head/walk/travel/explore north", "I'm going east"
 *   - gerund and auxiliary chains: "I'll start exploring north", "begin walking east"
 *
 * Returns `{ kind: "movement", direction }`, or null when the prose contains no
 * movement intent. Descriptions of where things ARE do not qualify — see
 * `parseDirectionalStatement` for those. Best-effort regex heuristics — false
 * negatives are acceptable, a wrong direction parsed is the important failure
 * mode, and a *description* parsed as movement is exactly the false positive
 * this function exists to prevent.
 */
export function parseMovementStatement(text: string): MovementStatement | null {
	for (const re of STATED_MOVEMENT_RES) {
		const m = re.exec(text);
		if (m?.[1]) {
			return {
				kind: "movement",
				direction: m[1].toLowerCase() as CardinalDirection,
			};
		}
	}
	return null;
}

/**
 * Parse the daemon's prose for any directional statement naming a cardinal,
 * tagged with whether it declares a movement intent or describes a position.
 *
 * Movement wins over position when both appear in the same prose: a sentence
 * that describes the room *and* announces a move is a movement statement for
 * coherence purposes. When only description is present, the result is
 * `kind: "position"` and coherence never fires on it.
 *
 * Returns null when no directional statement is found at all.
 */
export function parseDirectionalStatement(
	text: string,
): DirectionalStatement | null {
	const movement = parseMovementStatement(text);
	if (movement) return movement;
	for (const re of STATED_POSITION_RES) {
		const m = re.exec(text);
		if (m?.[1]) {
			return {
				kind: "position",
				direction: m[1].toLowerCase() as CardinalDirection,
			};
		}
	}
	return null;
}

/**
 * Parse the daemon's prose for a directional statement naming a cardinal,
 * preferring a MOVEMENT intent when one exists and falling back to a POSITION
 * description.
 *
 * This is the broad, reporting-oriented parser: it answers "did the daemon name
 * a cardinal it is acting on or describing?", which is evidence of the approved
 * vocabulary. It is NOT the coherence input — `structuralCoherence` uses the
 * movement-only `parseMovementStatement`, because a positional description
 * cannot disagree with a `go` call.
 *
 * Returns the normalised CardinalDirection, or null when no such statement is
 * found.
 */
export function parseStatedCardinal(text: string): CardinalDirection | null {
	return parseDirectionalStatement(text)?.direction ?? null;
}

// ── Structural coherence ──────────────────────────────────────────────────────

/**
 * Compare a stated cardinal against the cardinal a `go` tool call used.
 *
 * Callers MUST pass a MOVEMENT cardinal — the direction the daemon said it
 * would *take* — never a direction it merely described. Describing where
 * something is ("two steps north", "clear to the south") expresses no intent,
 * so it cannot disagree with a `go` call; feeding such a description in here is
 * precisely the false positive this module was fixed for. Use
 * `parseMovementStatement` to obtain a movement cardinal, or
 * `structuralCoherenceForTurn` to decide from a turn record without having to
 * remember the distinction.
 *
 * - "match": stated movement cardinal == `go` cardinal ✓
 * - "mismatch": stated a movement cardinal but moved a different one ✗
 * - "no-statement": no movement cardinal was stated (a description is not one)
 * - "no-toolcall": a movement cardinal was stated but no `go` tool call was made
 */
export function structuralCoherence(
	statedDirection: CardinalDirection | null,
	toolCallDirection: CardinalDirection | null,
): CoherenceVerdict {
	if (statedDirection === null) return "no-statement";
	if (toolCallDirection === null) return "no-toolcall";
	return statedDirection === toolCallDirection ? "match" : "mismatch";
}

/**
 * Decide coherence for one turn without the caller having to know which
 * statement kinds count.
 *
 * Reads the MOVEMENT statement only: a turn whose prose merely described a
 * position has no movement cardinal and therefore yields "no-statement", no
 * matter what `go` cardinal was used. When `movementStatement` is absent, the
 * movement intent is re-derived from the turn's own `text` (the same fallback
 * `scoreScenario` uses), so a caller cannot get the old description-as-move
 * behaviour by simply not populating the field.
 */
export function structuralCoherenceForTurn(
	turn: Pick<TurnRecord, "statedDirection" | "toolCallDirection" | "text"> & {
		movementStatement?: MovementStatement | null;
	},
): CoherenceVerdict {
	const movement =
		turn.movementStatement === undefined
			? parseMovementStatement(turn.text)
			: turn.movementStatement;
	return structuralCoherence(
		movement?.direction ?? null,
		turn.toolCallDirection,
	);
}

// ── Scenario aggregator ───────────────────────────────────────────────────────

/**
 * Aggregate a list of TurnRecords into a ScenarioScore.
 *
 * Pass rule: no structural coherence mismatches between a stated MOVEMENT
 * intent and the `go` cardinal used. Naming a cardinal is approved behaviour
 * and is measured (`cardinalStatementTurns`, `cardinalReferenceCount`) but
 * never fails a run; a run that makes no movement statements — including one
 * that only describes where things are — has nothing to mismatch.
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

	// Structural coherence: only MOVEMENT statements count. Turns that merely
	// described a position state no intent and are excluded, so a daemon that
	// narrates its surroundings ("clear to the south") while moving elsewhere
	// cannot be scored as incoherent. A movement statement with no `go` call is
	// "no-toolcall" and is likewise not a decisive turn.
	//
	// `movementStatement` is optional on TurnRecord so the harness's existing
	// record-building code keeps compiling; when a record omits it, the movement
	// intent is re-derived from the turn's own prose here. That keeps detection
	// live for callers that only carry `text` + `statedDirection`, and is why
	// this module owns the movement/position split rather than the caller.
	const movementOf = (t: TurnRecord): MovementStatement | null =>
		t.movementStatement ?? parseMovementStatement(t.text);
	const decisiveTurns = turns.filter(
		(t) => movementOf(t) !== null && t.toolCallDirection !== null,
	);
	const matchCount = decisiveTurns.filter(
		(t) => movementOf(t)?.direction === t.toolCallDirection,
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
