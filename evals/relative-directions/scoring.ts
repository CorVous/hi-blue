import type { CardinalDirection } from "../../src/spa/game/types.js";

export interface TurnRecord {
	turn: number;
	text: string;
	toolCalls: string[];
	cardinalReferences: string[];
	statedDirection: CardinalDirection | null;
	movementStatement?: MovementStatement | null;
	toolCallDirection: CardinalDirection | null;
}

export interface ScenarioScore {
	cardinalStatementTurns: number;
	cardinalReferenceCount: number;
	silenceRate: number;
	structuralCoherenceRate: number;
	structuralMismatchCount: number;
	passed: boolean;
}

export type CoherenceVerdict =
	| "match"
	| "mismatch"
	| "no-statement"
	| "no-toolcall";

export type DirectionalStatementKind = "movement" | "position";

export interface DirectionalStatement {
	kind: DirectionalStatementKind;
	direction: CardinalDirection;
}

export interface MovementStatement {
	kind: "movement";
	direction: CardinalDirection;
}

const CARDINAL_WORD_ANY_CASE_RE = /\b(north|south|east|west)\b/gi;
const CARDINAL_INITIAL_UPPERCASE_ONLY_RE = /\b(N|S|E|W)\b/g;

export function referencedCardinals(text: string): CardinalDirection[] {
	const long = [...text.matchAll(CARDINAL_WORD_ANY_CASE_RE)].map((m) =>
		m[0].toLowerCase(),
	);
	const short = [...text.matchAll(CARDINAL_INITIAL_UPPERCASE_ONLY_RE)].map(
		(m) => m[0].toLowerCase(),
	);
	return [...long, ...short] as CardinalDirection[];
}

const MOVEMENT_VERB =
	"(?:go|goes|going|went|mov(?:e|es|ed|ing)|step(?:s|ped|ping)?|head(?:s|ed|ing)?|walk(?:s|ed|ing)?|travel(?:s|led|ling|ing)?|explor(?:e|es|ed|ing)|approach(?:es|ed|ing)?|proceed(?:s|ed|ing)?|advance(?:s|d|ing)?|retreat(?:s|ed|ing)?|scout(?:s|ed|ing)?|venture(?:s|d|ing)?)";
const MOVEMENT_START_VERB =
	"(?:start(?:s|ed|ing)?|begin(?:s|ning)?|began|continue(?:s|d)?|keep|kept)";
const CARDINAL_ALT = "north|south|east|west";

const NOT_AFTER_DISTANCE_COUNT =
	"(?<!\\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\\d+)\\s)";

const MOVEMENT_LINK =
	"(?:\\s+(?:to\\s+the|to|toward|towards|for|into|off|on|ahead|straight|due|up|out|over|back\\s+to))?";
const MOVEMENT_START_AUXILIARY_CHAIN = `(?:\\s+${MOVEMENT_START_VERB})?(?:\\s+(?:to|and))?`;

const STATED_MOVEMENT_RE = new RegExp(
	`${NOT_AFTER_DISTANCE_COUNT}\\b${MOVEMENT_VERB}\\b${MOVEMENT_LINK}\\s+(${CARDINAL_ALT})\\b`,
	"i",
);

const STATED_MOVEMENT_AFTER_START_VERB_RE = new RegExp(
	`${NOT_AFTER_DISTANCE_COUNT}\\b${MOVEMENT_START_VERB}\\b${MOVEMENT_START_AUXILIARY_CHAIN}\\s+${MOVEMENT_VERB}\\b${MOVEMENT_LINK}\\s+(${CARDINAL_ALT})\\b`,
	"i",
);

const STATED_DISTANCE_POSITION_RE = new RegExp(
	`\\b(?:one|two|three|four|\\d+)\\s+(?:steps?|blocks?|cells?|squares?)\\s+(?:to\\s+the\\s+)?(${CARDINAL_ALT})\\b`,
	"i",
);
const STATED_BEARING_RE = new RegExp(`\\b(${CARDINAL_ALT})\\s+of\\b`, "i");

const STATED_MOVEMENT_RES = [
	STATED_MOVEMENT_RE,
	STATED_MOVEMENT_AFTER_START_VERB_RE,
];
const STATED_POSITION_RES = [STATED_DISTANCE_POSITION_RE, STATED_BEARING_RE];

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

export function parseStatedCardinal(text: string): CardinalDirection | null {
	return parseDirectionalStatement(text)?.direction ?? null;
}

export function structuralCoherence(
	statedMovementDirection: CardinalDirection | null,
	goToolCallDirection: CardinalDirection | null,
): CoherenceVerdict {
	if (statedMovementDirection === null) return "no-statement";
	if (goToolCallDirection === null) return "no-toolcall";
	return statedMovementDirection === goToolCallDirection ? "match" : "mismatch";
}

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

function movementOf(turn: TurnRecord): MovementStatement | null {
	return turn.movementStatement ?? parseMovementStatement(turn.text);
}

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
