/**
 * eval-scoring.test.ts
 *
 * CI unit tests for the relative-directions eval scoring module.
 * Tests the pure scoring functions imported from the eval harness so that
 * the regex, substring-match, and aggregation logic cannot silently rot.
 *
 * Import note: under TypeScript ESM / nodenext, cross-package imports use
 * the .js extension even when the source is .ts.
 */

import { describe, expect, it } from "vitest";
import type {
	Landmarks,
	TurnRecord,
} from "../../../../evals/relative-directions/scoring.js";
import {
	detectCardinalLeaks,
	landmarkMentions,
	parseStatedDirection,
	scoreScenario,
	structuralCoherence,
} from "../../../../evals/relative-directions/scoring.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_LANDMARKS: Landmarks = {
	north: {
		shortName: "the blast door",
		horizonPhrase: "looms at the far end, sealed and scarred",
	},
	south: {
		shortName: "the collapsed shaft",
		horizonPhrase: "gapes behind you, filling the air with wet concrete smell",
	},
	east: {
		shortName: "the transformer bank",
		horizonPhrase: "hums faintly in the dark, indicator lights blinking amber",
	},
	west: {
		shortName: "the flooded corridor",
		horizonPhrase: "stretches away, its floor invisible under black water",
	},
};

/** Build a minimal TurnRecord for aggregator tests. */
function makeTurn(
	overrides: Partial<TurnRecord> & Pick<TurnRecord, "turn">,
): TurnRecord {
	return {
		text: "",
		toolCalls: [],
		cardinalLeaks: [],
		landmarkMentioned: false,
		facingBefore: "north",
		facingAfter: "north",
		statedDirection: null,
		toolCallDirection: null,
		...overrides,
	};
}

// ── detectCardinalLeaks ───────────────────────────────────────────────────────

describe("detectCardinalLeaks", () => {
	it("detects lowercase cardinal words", () => {
		const result = detectCardinalLeaks("I head north to find the door.");
		expect(result).toContain("north");
	});

	it("detects capitalised cardinal words", () => {
		const result = detectCardinalLeaks("I see something to the North.");
		expect(result).toContain("north");
	});

	it("detects ALL-CAPS cardinal words", () => {
		const result = detectCardinalLeaks("NORTH is the direction I face.");
		expect(result).toContain("north");
	});

	it("detects single-letter N as a word", () => {
		// N appearing as a standalone word (e.g. abbreviated direction) is a leak.
		const result = detectCardinalLeaks("I moved N toward the door.");
		expect(result).toContain("n");
	});

	it("does NOT match 'N' inside a longer word (word boundary test)", () => {
		// "inside" contains 'N' but is not a standalone word — no leak
		const result = detectCardinalLeaks("inside the room");
		expect(result).not.toContain("n");
	});

	it("does NOT match 'northern' (compound adjective — not a compass bearing)", () => {
		// The regex uses word boundaries; 'northern' has content after the root word
		// so \bnorth\b does not match 'northern'.
		const result = detectCardinalLeaks("I see the northern lights.");
		expect(result).not.toContain("north");
	});

	it("does NOT match 'eastern' as 'east'", () => {
		const result = detectCardinalLeaks("I take the eastern passage.");
		expect(result).not.toContain("east");
	});

	it("returns empty array for clean text", () => {
		const result = detectCardinalLeaks(
			"I move forward toward the blast door on the horizon.",
		);
		expect(result).toEqual([]);
	});

	it("detects multiple different cardinal words in one sentence", () => {
		const result = detectCardinalLeaks("From north to south, east to west.");
		expect(result).toContain("north");
		expect(result).toContain("south");
		expect(result).toContain("east");
		expect(result).toContain("west");
	});

	it("detects S and E as standalone single-letter words", () => {
		const leaks = detectCardinalLeaks("Move S then E.");
		expect(leaks).toContain("s");
		expect(leaks).toContain("e");
	});

	it("documents the known false-positive: single 'N' in sentence-like prose", () => {
		// This is a known limitation: "N." at sentence end fires because \bN\b matches.
		// The false-positive cost (over-reporting leaks) is preferable to missing real leaks.
		// This test documents and accepts the behaviour.
		const result = detectCardinalLeaks("I am Daemon N. Ready to go.");
		expect(result).toContain("n");
	});

	it("does NOT match lowercase single letters in possessives (water's edge)", () => {
		// The lowercase 's' in "water's" is a word (apostrophe is a word boundary
		// in JS regex). Earlier case-insensitive \bs\b matched it as a fake leak.
		// Case-sensitive single-letter matching avoids that.
		const result = detectCardinalLeaks(
			"I stand at the water's edge, facing the sealed door.",
		);
		expect(result).toEqual([]);
	});

	it("does NOT match lowercase single 's' / 'n' / 'e' / 'w' in prose", () => {
		const result = detectCardinalLeaks(
			"the s and n and e and w stand alone as letters",
		);
		expect(result).toEqual([]);
	});
});

// ── landmarkMentions ──────────────────────────────────────────────────────────

describe("landmarkMentions", () => {
	it("detects shortName substring match for the expected direction", () => {
		const { mentioned, matchesExpected } = landmarkMentions(
			"I see the blast door looming ahead.",
			SAMPLE_LANDMARKS,
			"north",
		);
		expect(mentioned).toContain("north");
		expect(matchesExpected).toBe(true);
	});

	it("detects shortName match for a non-expected direction", () => {
		const { mentioned, matchesExpected } = landmarkMentions(
			"I can see the transformer bank to my right.",
			SAMPLE_LANDMARKS,
			"north",
		);
		expect(mentioned).toContain("east");
		expect(matchesExpected).toBe(false);
	});

	it("matches via last-word fallback for the key noun", () => {
		// "transformer bank" → last significant word is "bank"; ≥4 chars, present in text
		const { mentioned } = landmarkMentions(
			"There is a large bank humming in the dark.",
			SAMPLE_LANDMARKS,
			"north",
		);
		expect(mentioned).toContain("east");
	});

	it("does NOT match short last-words (< 4 chars)", () => {
		// The collapsed shaft's last word is "shaft" (5 chars) — that should match.
		// But a landmark whose last word was e.g. "hut" (3 chars) would not.
		// Here we just verify "shaft" does match:
		const { mentioned } = landmarkMentions(
			"The shaft is directly behind me.",
			SAMPLE_LANDMARKS,
			"south",
		);
		expect(mentioned).toContain("south");
	});

	it("matchesExpected is false when expectedFacing is not provided", () => {
		const { matchesExpected } = landmarkMentions(
			"I see the blast door.",
			SAMPLE_LANDMARKS,
		);
		expect(matchesExpected).toBe(false);
	});

	it("returns empty mentioned array for text with no landmark references", () => {
		const { mentioned, matchesExpected } = landmarkMentions(
			"I wait and observe.",
			SAMPLE_LANDMARKS,
			"north",
		);
		expect(mentioned).toEqual([]);
		expect(matchesExpected).toBe(false);
	});

	it("matches multiple landmarks when text references both", () => {
		const { mentioned } = landmarkMentions(
			"The blast door is ahead and the flooded corridor is to my left.",
			SAMPLE_LANDMARKS,
			"north",
		);
		expect(mentioned).toContain("north");
		expect(mentioned).toContain("west");
	});

	it("case-insensitive match for shortName", () => {
		const { mentioned } = landmarkMentions(
			"THE BLAST DOOR is sealed.",
			SAMPLE_LANDMARKS,
			"north",
		);
		expect(mentioned).toContain("north");
	});
});

// ── parseStatedDirection ──────────────────────────────────────────────────────

describe("parseStatedDirection", () => {
	it("parses 'I'll go forward'", () => {
		expect(parseStatedDirection("I'll go forward.")).toBe("forward");
	});

	it("parses 'go left'", () => {
		expect(parseStatedDirection("I go left toward the door.")).toBe("left");
	});

	it("parses 'move back'", () => {
		expect(parseStatedDirection("I move back to my previous position.")).toBe(
			"back",
		);
	});

	it("parses 'turn right'", () => {
		expect(parseStatedDirection("I turn right to face the corridor.")).toBe(
			"right",
		);
	});

	it("parses 'step ahead' as forward", () => {
		expect(parseStatedDirection("I step ahead toward the blast door.")).toBe(
			"forward",
		);
	});

	it("parses 'I'm going forward'", () => {
		expect(parseStatedDirection("I'm going forward now.")).toBe("forward");
	});

	it("parses 'moving forward'", () => {
		expect(parseStatedDirection("Moving forward to investigate.")).toBe(
			"forward",
		);
	});

	it("parses 'backward' as back", () => {
		expect(parseStatedDirection("I step backward to get a better view.")).toBe(
			"back",
		);
	});

	it("parses 'backwards' as back", () => {
		expect(parseStatedDirection("I move backwards away from the door.")).toBe(
			"back",
		);
	});

	it("returns null for 'I see something interesting'", () => {
		expect(
			parseStatedDirection("I see something interesting to my left."),
		).toBeNull();
	});

	it("returns null for 'I wait'", () => {
		expect(
			parseStatedDirection("I wait and observe the environment."),
		).toBeNull();
	});

	it("returns null for plain description prose", () => {
		expect(
			parseStatedDirection(
				"The blast door looms ahead on the horizon. The transformer bank is visible to the right.",
			),
		).toBeNull();
	});

	it("parses 'heading left'", () => {
		expect(parseStatedDirection("I am heading left along the wall.")).toBe(
			"left",
		);
	});

	it("parses 'walking forward'", () => {
		expect(parseStatedDirection("Walking forward into the corridor.")).toBe(
			"forward",
		);
	});
});

// ── structuralCoherence ───────────────────────────────────────────────────────

describe("structuralCoherence", () => {
	it("returns 'match' when stated and tool call directions agree", () => {
		expect(structuralCoherence("left", "left")).toBe("match");
	});

	it("returns 'match' for forward/forward", () => {
		expect(structuralCoherence("forward", "forward")).toBe("match");
	});

	it("returns 'mismatch' when stated direction differs from tool call", () => {
		expect(structuralCoherence("left", "forward")).toBe("mismatch");
	});

	it("returns 'mismatch' for right vs back", () => {
		expect(structuralCoherence("right", "back")).toBe("mismatch");
	});

	it("returns 'no-statement' when daemon prose has no movement statement", () => {
		expect(structuralCoherence(null, "forward")).toBe("no-statement");
	});

	it("returns 'no-statement' when both are null (no statement, no tool call)", () => {
		// statedDirection is checked first
		expect(structuralCoherence(null, null)).toBe("no-statement");
	});

	it("returns 'no-toolcall' when daemon stated a direction but made no tool call", () => {
		expect(structuralCoherence("forward", null)).toBe("no-toolcall");
	});
});

// ── scoreScenario ─────────────────────────────────────────────────────────────

describe("scoreScenario", () => {
	it("returns zero rates and passed=false for empty turns array", () => {
		const score = scoreScenario([]);
		expect(score.cardinalLeakCount).toBe(0);
		expect(score.landmarkConsistencyRate).toBe(0);
		expect(score.silenceRate).toBe(0);
		expect(score.structuralCoherenceRate).toBe(0);
		expect(score.structuralMismatchCount).toBe(0);
		expect(score.passed).toBe(false);
	});

	it("aggregates cardinal leaks across turns", () => {
		const turns = [
			makeTurn({ turn: 1, cardinalLeaks: ["north", "east"] }),
			makeTurn({ turn: 2, cardinalLeaks: ["south"] }),
			makeTurn({ turn: 3, cardinalLeaks: [] }),
		];
		const score = scoreScenario(turns);
		expect(score.cardinalLeakCount).toBe(3);
	});

	it("computes landmark consistency rate correctly", () => {
		const turns = [
			makeTurn({ turn: 1, landmarkMentioned: true }),
			makeTurn({ turn: 2, landmarkMentioned: true }),
			makeTurn({ turn: 3, landmarkMentioned: false }),
			makeTurn({ turn: 4, landmarkMentioned: false }),
		];
		const score = scoreScenario(turns);
		expect(score.landmarkConsistencyRate).toBeCloseTo(0.5);
	});

	it("computes silence rate correctly", () => {
		const turns = [
			makeTurn({ turn: 1, toolCalls: ['go({"direction":"forward"})'] }),
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
				statedDirection: "forward",
				toolCallDirection: "forward",
			}),
			// Mismatch
			makeTurn({
				turn: 2,
				statedDirection: "left",
				toolCallDirection: "forward",
			}),
			// No statement — excluded from decisive turns
			makeTurn({
				turn: 3,
				statedDirection: null,
				toolCallDirection: "forward",
			}),
			// No toolcall — excluded from decisive turns
			makeTurn({ turn: 4, statedDirection: "right", toolCallDirection: null }),
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
				statedDirection: "forward",
				toolCallDirection: null,
			}),
		];
		const score = scoreScenario(turns);
		expect(score.structuralCoherenceRate).toBe(1);
		expect(score.structuralMismatchCount).toBe(0);
	});

	it("passes when zero leaks, landmark ≥50%, and no mismatches", () => {
		const turns = [
			makeTurn({
				turn: 1,
				cardinalLeaks: [],
				landmarkMentioned: true,
				statedDirection: "forward",
				toolCallDirection: "forward",
			}),
			makeTurn({
				turn: 2,
				cardinalLeaks: [],
				landmarkMentioned: true,
				statedDirection: null,
				toolCallDirection: "left",
			}),
		];
		const score = scoreScenario(turns);
		expect(score.passed).toBe(true);
	});

	it("fails when there are cardinal leaks", () => {
		const turns = [
			makeTurn({ turn: 1, cardinalLeaks: ["north"], landmarkMentioned: true }),
		];
		const score = scoreScenario(turns);
		expect(score.passed).toBe(false);
	});

	it("fails when landmark consistency is below 50%", () => {
		const turns = [
			makeTurn({ turn: 1, cardinalLeaks: [], landmarkMentioned: false }),
			makeTurn({ turn: 2, cardinalLeaks: [], landmarkMentioned: false }),
			makeTurn({ turn: 3, cardinalLeaks: [], landmarkMentioned: false }),
		];
		const score = scoreScenario(turns);
		expect(score.landmarkConsistencyRate).toBe(0);
		expect(score.passed).toBe(false);
	});

	it("fails when there are structural mismatches", () => {
		const turns = [
			makeTurn({
				turn: 1,
				cardinalLeaks: [],
				landmarkMentioned: true,
				statedDirection: "left",
				toolCallDirection: "right",
			}),
			makeTurn({ turn: 2, cardinalLeaks: [], landmarkMentioned: true }),
		];
		const score = scoreScenario(turns);
		expect(score.structuralMismatchCount).toBe(1);
		expect(score.passed).toBe(false);
	});
});
