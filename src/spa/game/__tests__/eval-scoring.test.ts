/**
 * eval-scoring.test.ts
 *
 * CI unit tests for the direction-vocabulary eval scoring module.
 * Tests the pure scoring functions imported from the eval harness so that
 * the regex, substring-match, and aggregation logic cannot silently rot.
 *
 * The module scores the approved cardinal model (ADR 0015): a daemon naming
 * `north`/`south`/`east`/`west` is doing the right thing, and coherence means
 * the cardinal it stated matches the cardinal its `go` call used. The retired
 * relative vocabulary must not reappear in either the module or these tests.
 *
 * Import note: under TypeScript ESM / nodenext, cross-package imports use
 * the .js extension even when the source is .ts.
 */

import { describe, expect, it } from "vitest";
import type { TurnRecord } from "../../../../evals/relative-directions/scoring.js";
import {
	parseStatedCardinal,
	referencedCardinals,
	scoreScenario,
	structuralCoherence,
} from "../../../../evals/relative-directions/scoring.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Build a minimal TurnRecord for aggregator tests. */
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

// ── referencedCardinals (approved vocabulary, not a leak) ─────────────────────

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
		// N appearing as a standalone word (abbreviated bearing) is a reference.
		const result = referencedCardinals("I moved N toward the door.");
		expect(result).toContain("n");
	});

	it("does NOT match 'N' inside a longer word (word boundary test)", () => {
		// "inside" contains 'N' but is not a standalone word — no reference
		const result = referencedCardinals("inside the room");
		expect(result).not.toContain("n");
	});

	it("does NOT match 'northern' (compound adjective — not a compass bearing)", () => {
		// The regex uses word boundaries; 'northern' has content after the root word
		// so \bnorth\b does not match 'northern'.
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
		// Known limitation: "N." at sentence end fires because \bN\b matches.
		// Over-reporting is preferable to missing an abbreviated reference.
		const result = referencedCardinals("I am Daemon N. Ready to go.");
		expect(result).toContain("n");
	});

	it("does NOT match lowercase single letters in possessives (water's edge)", () => {
		// The lowercase 's' in "water's" is a word (apostrophe is a word boundary
		// in JS regex). Case-sensitive single-letter matching avoids that.
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

// ── parseStatedCardinal ───────────────────────────────────────────────────────

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
		// "north wall" is scenery, not a movement or positional statement.
		expect(
			parseStatedCardinal("The north wall is crumbling and damp."),
		).toBeNull();
	});

	it("does NOT parse the retired 'turn' verb as a statement", () => {
		// ADR 0015 removed facing; there is nothing to turn to face.
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

// ── structuralCoherence ───────────────────────────────────────────────────────

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
		// statedDirection is checked first
		expect(structuralCoherence(null, null)).toBe("no-statement");
	});

	it("returns 'no-toolcall' when daemon stated a cardinal but made no go call", () => {
		expect(structuralCoherence("south", null)).toBe("no-toolcall");
	});
});

// ── scoreScenario ─────────────────────────────────────────────────────────────

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
			// Match
			makeTurn({
				turn: 1,
				statedDirection: "north",
				toolCallDirection: "north",
			}),
			// Mismatch
			makeTurn({
				turn: 2,
				statedDirection: "north",
				toolCallDirection: "south",
			}),
			// No statement — excluded from decisive turns
			makeTurn({
				turn: 3,
				statedDirection: null,
				toolCallDirection: "east",
			}),
			// No toolcall — excluded from decisive turns
			makeTurn({ turn: 4, statedDirection: "west", toolCallDirection: null }),
		];
		const score = scoreScenario(turns);
		// Only turns 1 and 2 are decisive (both stated and toolCall present)
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
		// The inversion: under the retired relative model these cardinals were
		// punished as leaks. They are now the approved vocabulary, so naming
		// cardinals must never fail a run on its own.
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
		// Statement/action agreement driven from prose, not hand-set fields.
		const text = "I'll go north and check the far wall.";
		const turn = makeTurn({
			turn: 1,
			text,
			toolCalls: ['go({"direction":"north"})'],
			cardinalReferences: referencedCardinals(text),
			statedDirection: parseStatedCardinal(text),
			toolCallDirection: "north",
		});
		expect(
			structuralCoherence(turn.statedDirection, turn.toolCallDirection),
		).toBe("match");
		expect(scoreScenario([turn]).passed).toBe(true);
	});

	it("parses prose end-to-end into a mismatching turn record", () => {
		const text = "I'll go north and check the far wall.";
		const turn = makeTurn({
			turn: 1,
			text,
			toolCalls: ['go({"direction":"south"})'],
			cardinalReferences: referencedCardinals(text),
			statedDirection: parseStatedCardinal(text),
			toolCallDirection: "south",
		});
		expect(
			structuralCoherence(turn.statedDirection, turn.toolCallDirection),
		).toBe("mismatch");
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

	it("fails when a stated cardinal disagrees with the go cardinal", () => {
		const turns = [
			makeTurn({
				turn: 1,
				cardinalReferences: ["north"],
				statedDirection: "north",
				toolCallDirection: "west",
			}),
			makeTurn({ turn: 2, cardinalReferences: [] }),
		];
		const score = scoreScenario(turns);
		expect(score.structuralMismatchCount).toBe(1);
		expect(score.passed).toBe(false);
	});
});
