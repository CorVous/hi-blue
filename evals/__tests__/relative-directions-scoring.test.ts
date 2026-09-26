import { describe, expect, it } from "vitest";
import type { TurnRecord } from "../relative-directions/scoring.js";
import {
	parseDirectionalStatement,
	parseMovementStatement,
	parseStatedCardinal,
	referencedCardinals,
	scoreScenario,
	structuralCoherence,
	structuralCoherenceForTurn,
} from "../relative-directions/scoring.js";

const FAILING_CORNER_PROSE =
	"I'm against a north wall. Wall one step north, one step north-west, " +
	"one step north-east, and two steps north. Clear to the south, east, and " +
	"west. Corner position.";

function makeTurn(
	overrides: Partial<TurnRecord> & Pick<TurnRecord, "turn">,
): TurnRecord {
	return {
		text: "",
		toolCalls: [],
		cardinalReferences: [],
		statedDirection: null,
		toolCallDirection: null,
		...overrides,
	};
}

function makeProseTurn(
	turn: number,
	text: string,
	toolCallDirection: TurnRecord["toolCallDirection"],
): TurnRecord {
	return makeTurn({
		turn,
		text,
		toolCalls: [`go({"direction":"${toolCallDirection ?? "pass"}"})`],
		cardinalReferences: referencedCardinals(text),
		statedDirection: parseStatedCardinal(text),
		toolCallDirection,
	});
}

describe("referencedCardinals", () => {
	it("counts a lowercase cardinal as a reference", () => {
		const result = referencedCardinals("I head north to find the door.");
		expect(result).toContain("north");
	});

	it("counts a capitalised cardinal", () => {
		const result = referencedCardinals("I see something to the North.");
		expect(result).toContain("north");
	});

	it("counts an ALL-CAPS cardinal", () => {
		const result = referencedCardinals("NORTH is the direction I will take.");
		expect(result).toContain("north");
	});

	it("counts a single-letter N as a word", () => {
		const result = referencedCardinals("I moved N toward the door.");
		expect(result).toContain("n");
	});

	it("does NOT match 'N' inside a longer word (word boundary test)", () => {
		const result = referencedCardinals("inside the room");
		expect(result).not.toContain("n");
	});

	it("does NOT match 'northern' (compound adjective — not a compass bearing)", () => {
		const result = referencedCardinals("I see the northern lights.");
		expect(result).not.toContain("north");
	});

	it("does NOT match 'eastern' as 'east'", () => {
		const result = referencedCardinals("I take the eastern passage.");
		expect(result).not.toContain("east");
	});

	it("returns empty array when no cardinal is named", () => {
		const result = referencedCardinals("I wait and observe the environment.");
		expect(result).toEqual([]);
	});

	it("counts multiple different cardinals in one sentence", () => {
		const result = referencedCardinals("From north to south, east to west.");
		expect(result).toContain("north");
		expect(result).toContain("south");
		expect(result).toContain("east");
		expect(result).toContain("west");
	});

	it("counts S and E as standalone single-letter words", () => {
		const refs = referencedCardinals("Move S then E.");
		expect(refs).toContain("s");
		expect(refs).toContain("e");
	});

	it("documents the known false-positive: single 'N' in sentence-like prose", () => {
		const result = referencedCardinals("I am Daemon N. Ready to go.");
		expect(result).toContain("n");
	});

	it("does NOT match lowercase single letters in possessives (water's edge)", () => {
		const result = referencedCardinals(
			"I stand at the water's edge, before the sealed door.",
		);
		expect(result).toEqual([]);
	});

	it("does NOT match lowercase single 's' / 'n' / 'e' / 'w' in prose", () => {
		const result = referencedCardinals(
			"the s and n and e and w stand alone as letters",
		);
		expect(result).toEqual([]);
	});
});

describe("parseStatedCardinal", () => {
	it("parses 'I'll go north'", () => {
		expect(parseStatedCardinal("I'll go north.")).toBe("north");
	});

	it("parses 'I go south toward the door'", () => {
		expect(parseStatedCardinal("I go south toward the door.")).toBe("south");
	});

	it("parses 'I move east'", () => {
		expect(parseStatedCardinal("I move east to the far wall.")).toBe("east");
	});

	it("parses 'I step west'", () => {
		expect(parseStatedCardinal("I step west and wait.")).toBe("west");
	});

	it("parses 'I'm going north'", () => {
		expect(parseStatedCardinal("I'm going north now.")).toBe("north");
	});

	it("parses 'Moving south to investigate'", () => {
		expect(parseStatedCardinal("Moving south to investigate.")).toBe("south");
	});

	it("parses 'I am heading west along the wall'", () => {
		expect(parseStatedCardinal("I am heading west along the wall.")).toBe(
			"west",
		);
	});

	it("parses 'Walking east into the corridor'", () => {
		expect(parseStatedCardinal("Walking east into the corridor.")).toBe("east");
	});

	it("parses 'to the north' movement phrasing", () => {
		expect(parseStatedCardinal("I walk to the north edge.")).toBe("north");
	});

	it("parses a positional statement: 'the transformer is two steps east'", () => {
		expect(
			parseStatedCardinal("The transformer is two steps east of me."),
		).toBe("east");
	});

	it("parses a positional statement with a bare step count", () => {
		expect(
			parseStatedCardinal("Another daemon is one step north of you."),
		).toBe("north");
	});

	it("parses a positional statement using 'blocks'", () => {
		expect(parseStatedCardinal("The sealed door is three blocks west.")).toBe(
			"west",
		);
	});

	it("parses a bare bearing: 'north of me'", () => {
		expect(parseStatedCardinal("The altar lies north of me.")).toBe("north");
	});

	it("returns null for prose with no directional statement", () => {
		expect(
			parseStatedCardinal("I wait and observe the environment."),
		).toBeNull();
	});

	it("returns null for plain description prose that names no cardinal", () => {
		expect(
			parseStatedCardinal(
				"The blast door looms at the far end. The transformer bank hums softly.",
			),
		).toBeNull();
	});

	it("returns null for a cardinal with no statement verb or bearing", () => {
		expect(
			parseStatedCardinal("The north wall is crumbling and damp."),
		).toBeNull();
	});

	it("does NOT parse the retired 'turn' verb as a statement", () => {
		expect(
			parseStatedCardinal("I turn north to face the corridor."),
		).toBeNull();
	});

	it("does NOT parse retired relative vocabulary", () => {
		expect(parseStatedCardinal("I'll go forward.")).toBeNull();
		expect(parseStatedCardinal("I move left toward the door.")).toBeNull();
		expect(
			parseStatedCardinal("I step back to my previous position."),
		).toBeNull();
		expect(parseStatedCardinal("I step ahead toward the door.")).toBeNull();
	});
});

describe("parseMovementStatement", () => {
	it("parses a plain movement verb + cardinal", () => {
		expect(parseMovementStatement("I'll go north.")).toEqual({
			kind: "movement",
			direction: "north",
		});
	});

	it("parses a gerund movement verb", () => {
		expect(parseMovementStatement("Moving south to investigate.")).toEqual({
			kind: "movement",
			direction: "south",
		});
	});

	it("parses 'I'll start exploring north' as movement north (gerund regression)", () => {
		expect(
			parseMovementStatement(
				"I see nothing in any direction. Empty vault. I'll start exploring north.",
			),
		).toEqual({ kind: "movement", direction: "north" });
	});

	it("parses other auxiliary + gerund chains", () => {
		expect(parseMovementStatement("I begin walking east.")?.direction).toBe(
			"east",
		);
		expect(parseMovementStatement("I keep going west.")?.direction).toBe(
			"west",
		);
		expect(parseMovementStatement("I continue heading south.")?.direction).toBe(
			"south",
		);
	});

	it("parses a bare 'exploring north' without an auxiliary verb", () => {
		expect(
			parseMovementStatement("Exploring north from here.")?.direction,
		).toBe("north");
	});

	it("does NOT read 'clear to the south' as movement", () => {
		expect(parseMovementStatement("Clear to the south.")).toBeNull();
	});

	it("does NOT read a counted distance phrase as movement", () => {
		expect(parseMovementStatement("Two steps north.")).toBeNull();
		expect(parseMovementStatement("One step north.")).toBeNull();
		expect(parseMovementStatement("Three blocks west.")).toBeNull();
	});

	it("does NOT read a bearing as movement", () => {
		expect(parseMovementStatement("The altar lies north of me.")).toBeNull();
	});

	it("does NOT read scenery as movement", () => {
		expect(parseMovementStatement("The north wall is crumbling.")).toBeNull();
		expect(
			parseMovementStatement("I see nothing in any direction. Empty vault."),
		).toBeNull();
	});

	it("parses the exact failing corner prose as NO movement statement", () => {
		expect(parseMovementStatement(FAILING_CORNER_PROSE)).toBeNull();
	});
});

describe("parseDirectionalStatement", () => {
	it("tags a movement statement as kind movement", () => {
		expect(parseDirectionalStatement("I'll go north.")).toEqual({
			kind: "movement",
			direction: "north",
		});
	});

	it("tags a distance phrase as kind position", () => {
		expect(
			parseDirectionalStatement("The transformer is two steps east of me."),
		).toEqual({ kind: "position", direction: "east" });
	});

	it("tags a bearing as kind position", () => {
		expect(parseDirectionalStatement("The altar lies north of me.")).toEqual({
			kind: "position",
			direction: "north",
		});
	});

	it("tags the exact failing corner prose as position, not movement", () => {
		const statement = parseDirectionalStatement(FAILING_CORNER_PROSE);
		expect(statement?.kind).toBe("position");
		expect(statement?.direction).toBe("north");
	});

	it("prefers movement when prose both describes position and states a move", () => {
		const text =
			"The wall is one step north of me. I'll go south to leave the corner.";
		expect(parseDirectionalStatement(text)).toEqual({
			kind: "movement",
			direction: "south",
		});
	});

	it("returns null when no statement of either kind is present", () => {
		expect(
			parseDirectionalStatement("I wait and observe the environment."),
		).toBeNull();
	});
});

describe("structuralCoherence", () => {
	it("returns 'match' when stated cardinal and go cardinal agree", () => {
		expect(structuralCoherence("north", "north")).toBe("match");
	});

	it("returns 'match' for east/east", () => {
		expect(structuralCoherence("east", "east")).toBe("match");
	});

	it("returns 'mismatch' when stated cardinal differs from the go cardinal", () => {
		expect(structuralCoherence("north", "south")).toBe("mismatch");
	});

	it("returns 'mismatch' for west vs east", () => {
		expect(structuralCoherence("west", "east")).toBe("mismatch");
	});

	it("returns 'no-statement' when daemon prose has no directional statement", () => {
		expect(structuralCoherence(null, "north")).toBe("no-statement");
	});

	it("returns 'no-statement' when both are null (no statement, no tool call)", () => {
		expect(structuralCoherence(null, null)).toBe("no-statement");
	});

	it("returns 'no-toolcall' when daemon stated a cardinal but made no go call", () => {
		expect(structuralCoherence("south", null)).toBe("no-toolcall");
	});
});

describe("structuralCoherenceForTurn", () => {
	it("returns 'match' for a stated move that agrees with the go call", () => {
		expect(
			structuralCoherenceForTurn(makeProseTurn(1, "I'll go north.", "north")),
		).toBe("match");
	});

	it("returns 'mismatch' for a stated move that disagrees with the go call", () => {
		expect(
			structuralCoherenceForTurn(makeProseTurn(1, "I'll go north.", "south")),
		).toBe("mismatch");
	});

	it("returns 'no-statement' when the prose is description only", () => {
		expect(
			structuralCoherenceForTurn(
				makeProseTurn(1, "The transformer is two steps east.", "east"),
			),
		).toBe("no-statement");
	});

	it("returns 'no-toolcall' when a move is stated but no go call was made", () => {
		expect(
			structuralCoherenceForTurn(makeProseTurn(1, "I'll go north.", null)),
		).toBe("no-toolcall");
	});

	it("returns 'no-statement' for the exact failing corner prose vs go south", () => {
		const turn = makeProseTurn(1, FAILING_CORNER_PROSE, "south");
		expect(turn.statedDirection).toBe("north");
		expect(parseMovementStatement(turn.text)).toBeNull();
		expect(structuralCoherenceForTurn(turn)).toBe("no-statement");
	});

	it("re-derives movement from prose when the field is absent", () => {
		const turn = makeProseTurn(1, "I'll start exploring north.", "north");
		expect(turn.movementStatement).toBeUndefined();
		expect(structuralCoherenceForTurn(turn)).toBe("match");
	});

	it("honours an explicit movementStatement over the prose re-derivation", () => {
		const turn = {
			...makeProseTurn(1, "I'll go north.", "south"),
			movementStatement: {
				kind: "movement" as const,
				direction: "south" as const,
			},
		};
		expect(structuralCoherenceForTurn(turn)).toBe("match");
	});

	it("treats an explicit null movementStatement as no movement", () => {
		const turn = {
			...makeProseTurn(1, "I'll go north.", "south"),
			movementStatement: null,
		};
		expect(structuralCoherenceForTurn(turn)).toBe("no-statement");
	});
});

describe("scoreScenario", () => {
	it("returns zero rates and passed=false for empty turns array", () => {
		const score = scoreScenario([]);
		expect(score.cardinalStatementTurns).toBe(0);
		expect(score.cardinalReferenceCount).toBe(0);
		expect(score.silenceRate).toBe(0);
		expect(score.structuralCoherenceRate).toBe(0);
		expect(score.structuralMismatchCount).toBe(0);
		expect(score.passed).toBe(false);
	});

	it("counts cardinal statement turns and references across the run", () => {
		const turns = [
			makeTurn({ turn: 1, cardinalReferences: ["north", "east"] }),
			makeTurn({ turn: 2, cardinalReferences: ["south"] }),
			makeTurn({ turn: 3, cardinalReferences: [] }),
		];
		const score = scoreScenario(turns);
		expect(score.cardinalStatementTurns).toBe(2);
		expect(score.cardinalReferenceCount).toBe(3);
	});

	it("computes silence rate correctly", () => {
		const turns = [
			makeTurn({ turn: 1, toolCalls: ['go({"direction":"north"})'] }),
			makeTurn({ turn: 2, toolCalls: [] }),
			makeTurn({ turn: 3, toolCalls: [] }),
		];
		const score = scoreScenario(turns);
		expect(score.silenceRate).toBeCloseTo(2 / 3);
	});

	it("computes structural coherence rate for decisive turns only", () => {
		const turns = [
			makeProseTurn(1, "I'll go north.", "north"),
			makeProseTurn(2, "I'll go north.", "south"),
			makeProseTurn(3, "Clear to the east.", "east"),
			makeProseTurn(4, "I'll go west.", null),
		];
		const score = scoreScenario(turns);
		expect(score.structuralCoherenceRate).toBeCloseTo(0.5);
		expect(score.structuralMismatchCount).toBe(1);
	});

	it("structuralCoherenceRate is 1 when no decisive turns (no statement+toolcall pairs)", () => {
		const turns = [
			makeTurn({ turn: 1, statedDirection: null, toolCallDirection: null }),
			makeTurn({
				turn: 2,
				statedDirection: "north",
				toolCallDirection: null,
			}),
		];
		const score = scoreScenario(turns);
		expect(score.structuralCoherenceRate).toBe(1);
		expect(score.structuralMismatchCount).toBe(0);
	});

	it("passes when cardinals are named and every decisive turn agrees", () => {
		const turns = [
			makeTurn({
				turn: 1,
				cardinalReferences: ["north"],
				statedDirection: "north",
				toolCallDirection: "north",
			}),
			makeTurn({
				turn: 2,
				cardinalReferences: ["east"],
				statedDirection: null,
				toolCallDirection: "east",
			}),
		];
		const score = scoreScenario(turns);
		expect(score.passed).toBe(true);
	});

	it("treats a cardinal-naming statement as approved, not as a leak", () => {
		const turns = [
			makeTurn({
				turn: 1,
				text: "The transformer is two steps east of me.",
				cardinalReferences: referencedCardinals(
					"The transformer is two steps east of me.",
				),
				statedDirection: parseStatedCardinal(
					"The transformer is two steps east of me.",
				),
				toolCallDirection: null,
			}),
			makeTurn({
				turn: 2,
				text: "I'll go north.",
				cardinalReferences: referencedCardinals("I'll go north."),
				statedDirection: parseStatedCardinal("I'll go north."),
				toolCallDirection: "north",
			}),
		];
		const score = scoreScenario(turns);
		expect(score.cardinalReferenceCount).toBeGreaterThan(0);
		expect(score.cardinalStatementTurns).toBe(2);
		expect(score.structuralMismatchCount).toBe(0);
		expect(score.passed).toBe(true);
	});

	it("parses prose end-to-end into an agreeing turn record", () => {
		const turn = makeProseTurn(
			1,
			"I'll go north and check the far wall.",
			"north",
		);
		expect(structuralCoherenceForTurn(turn)).toBe("match");
		expect(scoreScenario([turn]).passed).toBe(true);
	});

	it("parses prose end-to-end into a mismatching turn record", () => {
		const turn = makeProseTurn(
			1,
			"I'll go north and check the far wall.",
			"south",
		);
		expect(structuralCoherenceForTurn(turn)).toBe("mismatch");
		expect(scoreScenario([turn]).passed).toBe(false);
	});

	it("passes a run with no statements and no tool calls", () => {
		const turns = [
			makeTurn({ turn: 1, text: "I wait and observe the environment." }),
		];
		const score = scoreScenario(turns);
		expect(score.structuralCoherenceRate).toBe(1);
		expect(score.structuralMismatchCount).toBe(0);
		expect(score.passed).toBe(true);
	});

	it("fails when a stated movement cardinal disagrees with the go cardinal", () => {
		const turns = [
			makeProseTurn(1, "I'll go north.", "west"),
			makeTurn({ turn: 2, cardinalReferences: [] }),
		];
		const score = scoreScenario(turns);
		expect(score.structuralMismatchCount).toBe(1);
		expect(score.passed).toBe(false);
	});

	it("does NOT fail the run on the exact failing corner prose vs go south", () => {
		const turn = makeProseTurn(1, FAILING_CORNER_PROSE, "south");
		expect(structuralCoherenceForTurn(turn)).toBe("no-statement");
		const score = scoreScenario([turn]);
		expect(score.structuralMismatchCount).toBe(0);
		expect(score.passed).toBe(true);
		expect(score.cardinalStatementTurns).toBe(1);
		expect(score.cardinalReferenceCount).toBeGreaterThan(0);
	});

	it("does NOT fail the run on a description-only turn whatever the go cardinal", () => {
		const score = scoreScenario([
			makeProseTurn(1, "Clear to the south, east, and west.", "north"),
			makeProseTurn(2, "The altar is two steps north of me.", "south"),
		]);
		expect(score.structuralMismatchCount).toBe(0);
		expect(score.passed).toBe(true);
	});

	it("still fails a run whose genuine movement statement disagrees", () => {
		const score = scoreScenario([
			makeProseTurn(1, "I'll start exploring north.", "south"),
		]);
		expect(score.structuralMismatchCount).toBe(1);
		expect(score.passed).toBe(false);
	});

	it("agrees a gerund movement statement against a matching go call", () => {
		const score = scoreScenario([
			makeProseTurn(1, "I'll start exploring north.", "north"),
		]);
		expect(score.structuralMismatchCount).toBe(0);
		expect(score.passed).toBe(true);
	});
});
