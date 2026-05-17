/**
 * drift-scoring.test.ts
 *
 * CI unit tests for the free-text-drift eval scoring module. Same pattern
 * as eval-scoring.test.ts (relative-directions): import the pure helpers
 * from the eval package and guard the regex / aggregation logic so it
 * cannot silently rot.
 */

import { describe, expect, it } from "vitest";
import type { TurnRecord } from "../../../../evals/free-text-drift/scoring.js";
import {
	buildPerRoundSeries,
	looksLikeFreeTextAction,
	looksLikeFreeTextMessage,
	messageRecipientCounts,
	parseToolCallDetail,
	rollingSilenceRate,
	summarizeRun,
} from "../../../../evals/free-text-drift/scoring.js";

// ── parseToolCallDetail ──────────────────────────────────────────────────────

describe("parseToolCallDetail", () => {
	it("extracts direction from a go tool call", () => {
		const detail = parseToolCallDetail({
			id: "c1",
			name: "go",
			argumentsJson: '{"direction":"forward"}',
		});
		expect(detail.direction).toBe("forward");
		expect(detail.parseError).toBeUndefined();
	});

	it("extracts direction from a look tool call", () => {
		const detail = parseToolCallDetail({
			id: "c2",
			name: "look",
			argumentsJson: '{"direction":"left"}',
		});
		expect(detail.direction).toBe("left");
	});

	it("leaves direction undefined when the arg is not a relative direction", () => {
		const detail = parseToolCallDetail({
			id: "c3",
			name: "go",
			argumentsJson: '{"direction":"north"}',
		});
		expect(detail.direction).toBeUndefined();
	});

	it("extracts recipient and content from a message tool call", () => {
		const detail = parseToolCallDetail({
			id: "c4",
			name: "message",
			argumentsJson: '{"to":"blue","content":"hi"}',
		});
		expect(detail.recipient).toBe("blue");
		expect(detail.content).toBe("hi");
	});

	it("strips a leading * from recipient AiIds", () => {
		const detail = parseToolCallDetail({
			id: "c5",
			name: "message",
			argumentsJson: '{"to":"*3kw7","content":"yo"}',
		});
		expect(detail.recipient).toBe("3kw7");
	});

	it("extracts item from pick_up / use / examine", () => {
		for (const name of ["pick_up", "put_down", "use", "examine"] as const) {
			const detail = parseToolCallDetail({
				id: `c-${name}`,
				name,
				argumentsJson: '{"item":"lantern"}',
			});
			expect(detail.item).toBe("lantern");
		}
	});

	it("extracts item and target from give", () => {
		const detail = parseToolCallDetail({
			id: "c6",
			name: "give",
			argumentsJson: '{"item":"key","to":"*3kw7"}',
		});
		expect(detail.item).toBe("key");
		expect(detail.to).toBe("3kw7");
	});

	it("flags malformed JSON without throwing", () => {
		const detail = parseToolCallDetail({
			id: "c7",
			name: "go",
			argumentsJson: "{not json",
		});
		expect(detail.parseError).toBe(true);
	});

	it("flags non-object JSON without throwing", () => {
		const detail = parseToolCallDetail({
			id: "c8",
			name: "go",
			argumentsJson: '"forward"',
		});
		expect(detail.parseError).toBe(true);
	});
});

// ── Free-text leak heuristics ────────────────────────────────────────────────

describe("looksLikeFreeTextMessage", () => {
	it("flags first-person speech verbs to a peer", () => {
		expect(looksLikeFreeTextMessage("I tell *3kw7 about the door.")).toBe(true);
		expect(looksLikeFreeTextMessage("I'll whisper to blue.")).toBe(true);
		expect(looksLikeFreeTextMessage("I ask blue what they want.")).toBe(true);
	});

	it("flags quoted dialogue", () => {
		expect(
			looksLikeFreeTextMessage('She turned and said "I see the door."'),
		).toBe(true);
	});

	it("flags direct-address openings", () => {
		expect(looksLikeFreeTextMessage("blue, I need help here.")).toBe(true);
		expect(looksLikeFreeTextMessage("*3kw7: hold on a moment.")).toBe(true);
	});

	it("does not flag plain narration without speech cues", () => {
		expect(looksLikeFreeTextMessage("The room is dim and cold.")).toBe(false);
		expect(looksLikeFreeTextMessage("I move forward toward the door.")).toBe(
			false,
		);
		expect(looksLikeFreeTextMessage("")).toBe(false);
	});
});

describe("looksLikeFreeTextAction", () => {
	it("flags first-person action verbs", () => {
		expect(looksLikeFreeTextAction("I move forward.")).toBe(true);
		expect(looksLikeFreeTextAction("I'll pick up the lantern.")).toBe(true);
		expect(looksLikeFreeTextAction("I examine the panel.")).toBe(true);
		expect(looksLikeFreeTextAction("I turn left and walk.")).toBe(true);
	});

	it("does not flag declarative non-action prose", () => {
		expect(looksLikeFreeTextAction("The lantern flickers.")).toBe(false);
		expect(looksLikeFreeTextAction("I am puzzled by this.")).toBe(false);
		expect(looksLikeFreeTextAction("")).toBe(false);
	});
});

// ── Per-recipient bucketing ──────────────────────────────────────────────────

describe("messageRecipientCounts", () => {
	const baseTurn = (
		round: number,
		toolCalls: TurnRecord["toolCalls"],
	): TurnRecord => ({
		round,
		aiId: "red",
		assistantText: "",
		toolCalls,
	});

	it("counts known recipients, blue, and unknowns separately", () => {
		const turns: TurnRecord[] = [
			baseTurn(1, [
				{
					id: "a",
					name: "message",
					argumentsJson: '{"to":"blue","content":"hi"}',
				},
			]),
			baseTurn(2, [
				{
					id: "b",
					name: "message",
					argumentsJson: '{"to":"sim1","content":"y"}',
				},
			]),
			baseTurn(3, [
				{
					id: "c",
					name: "message",
					argumentsJson: '{"to":"ghost","content":"?"}',
				},
			]),
		];
		const counts = messageRecipientCounts(turns, ["red", "sim1", "sim2"]);
		expect(counts.blue).toBe(1);
		expect(counts.sim1).toBe(1);
		expect(counts.unknown).toBe(1);
	});

	it("counts malformed message args under the 'malformed' bucket", () => {
		const turns: TurnRecord[] = [
			baseTurn(1, [{ id: "x", name: "message", argumentsJson: "{not json" }]),
		];
		const counts = messageRecipientCounts(turns, ["red"]);
		expect(counts.malformed).toBe(1);
	});

	it("ignores non-message tool calls", () => {
		const turns: TurnRecord[] = [
			baseTurn(1, [
				{ id: "g", name: "go", argumentsJson: '{"direction":"forward"}' },
			]),
		];
		const counts = messageRecipientCounts(turns, ["red"]);
		expect(Object.keys(counts).length).toBe(0);
	});
});

// ── Rolling silence-rate window ──────────────────────────────────────────────

describe("rollingSilenceRate", () => {
	it("returns one row per window with correct rates", () => {
		const turns: TurnRecord[] = [
			// window 1: rounds 1-3 — 2 silent, 1 messaging
			{ round: 1, aiId: "red", assistantText: "", toolCalls: [] },
			{ round: 2, aiId: "red", assistantText: "", toolCalls: [] },
			{
				round: 3,
				aiId: "red",
				assistantText: "",
				toolCalls: [
					{
						id: "x",
						name: "message",
						argumentsJson: '{"to":"blue","content":"hi"}',
					},
				],
			},
			// window 2: rounds 4-5 — both messaging
			{
				round: 4,
				aiId: "red",
				assistantText: "",
				toolCalls: [
					{
						id: "y",
						name: "message",
						argumentsJson: '{"to":"blue","content":"hi"}',
					},
				],
			},
			{
				round: 5,
				aiId: "red",
				assistantText: "",
				toolCalls: [
					{
						id: "z",
						name: "message",
						argumentsJson: '{"to":"blue","content":"hi"}',
					},
				],
			},
		];
		const windows = rollingSilenceRate(turns, 3);
		expect(windows.length).toBe(2);
		// biome-ignore lint/style/noNonNullAssertion: bounded by length check above
		expect(windows[0]!.silenceRate).toBeCloseTo(2 / 3);
		// biome-ignore lint/style/noNonNullAssertion: bounded by length check above
		expect(windows[1]!.silenceRate).toBe(0);
		// biome-ignore lint/style/noNonNullAssertion: bounded by length check above
		expect(windows[1]!.messageSilenceRate).toBe(0);
	});

	it("distinguishes silenceRate (no tool) from messageSilenceRate (no message)", () => {
		const turns: TurnRecord[] = [
			{
				round: 1,
				aiId: "red",
				assistantText: "",
				toolCalls: [
					{ id: "g", name: "go", argumentsJson: '{"direction":"forward"}' },
				],
			},
		];
		const windows = rollingSilenceRate(turns, 5);
		// biome-ignore lint/style/noNonNullAssertion: bounded by length check above
		expect(windows[0]!.silenceRate).toBe(0);
		// biome-ignore lint/style/noNonNullAssertion: bounded by length check above
		expect(windows[0]!.messageSilenceRate).toBe(1);
	});

	it("returns [] for empty input or non-positive window size", () => {
		expect(rollingSilenceRate([], 3)).toEqual([]);
		expect(
			rollingSilenceRate(
				[{ round: 1, aiId: "red", assistantText: "", toolCalls: [] }],
				0,
			),
		).toEqual([]);
	});
});

// ── summarizeRun ─────────────────────────────────────────────────────────────

describe("summarizeRun", () => {
	it("aggregates totals, leak counts, and tool-name counts", () => {
		const turns: TurnRecord[] = [
			// silent + free-text-message leak
			{
				round: 1,
				aiId: "red",
				assistantText: "I tell blue I see a door.",
				toolCalls: [],
			},
			// silent + free-text-action leak
			{
				round: 2,
				aiId: "red",
				assistantText: "I move forward through the gap.",
				toolCalls: [],
			},
			// proper message — no leak (even if text would otherwise look like one)
			{
				round: 3,
				aiId: "red",
				assistantText: "I tell blue I'm OK.",
				toolCalls: [
					{
						id: "a",
						name: "message",
						argumentsJson: '{"to":"blue","content":"OK"}',
					},
				],
			},
			// proper go — no action leak (movement reached the engine)
			{
				round: 4,
				aiId: "red",
				assistantText: "I move forward.",
				toolCalls: [
					{ id: "g", name: "go", argumentsJson: '{"direction":"forward"}' },
				],
			},
		];
		const summary = summarizeRun(turns, ["red", "sim1"], 2);

		expect(summary.totalTurns).toBe(4);
		expect(summary.silenceRate).toBe(0.5);
		expect(summary.messageSilenceRate).toBe(0.75);
		expect(summary.freeTextMessageLeakCount).toBe(1);
		expect(summary.freeTextActionLeakCount).toBe(1);
		expect(summary.toolCallCountsByName.message).toBe(1);
		expect(summary.toolCallCountsByName.go).toBe(1);
		expect(summary.recipientCounts.blue).toBe(1);
		expect(summary.windows.length).toBe(2);
	});

	it("handles an empty turn list without dividing by zero", () => {
		const summary = summarizeRun([], ["red"], 5);
		expect(summary.totalTurns).toBe(0);
		expect(summary.silenceRate).toBe(0);
		expect(summary.messageSilenceRate).toBe(0);
		expect(summary.windows).toEqual([]);
	});
});

// ── buildPerRoundSeries (graphable output) ───────────────────────────────────

describe("buildPerRoundSeries", () => {
	const turns: TurnRecord[] = [
		// round 1: go forward (no message)
		{
			round: 1,
			aiId: "red",
			assistantText: "moving up",
			toolCalls: [
				{ id: "g1", name: "go", argumentsJson: '{"direction":"forward"}' },
			],
		},
		// round 2: message blue + look right
		{
			round: 2,
			aiId: "red",
			assistantText: "hey",
			toolCalls: [
				{
					id: "m1",
					name: "message",
					argumentsJson: '{"to":"blue","content":"hi"}',
				},
				{ id: "l1", name: "look", argumentsJson: '{"direction":"right"}' },
			],
		},
		// round 3: silent + free-text-message leak
		{
			round: 3,
			aiId: "red",
			assistantText: "I tell blue what I saw.",
			toolCalls: [],
		},
		// round 4: message to unknown handle
		{
			round: 4,
			aiId: "red",
			assistantText: "",
			toolCalls: [
				{
					id: "m2",
					name: "message",
					argumentsJson: '{"to":"ghost","content":"hi"}',
				},
			],
		},
	];

	it("returns one entry per round with arrays aligned to rounds", () => {
		const s = buildPerRoundSeries(turns, ["red", "sim1", "sim2"]);
		expect(s.rounds).toEqual([1, 2, 3, 4]);
		expect(s.silence).toEqual([0, 0, 1, 0]);
		expect(s.hasMessage).toEqual([0, 1, 0, 1]);
		expect(s.hasAnyTool).toEqual([1, 1, 0, 1]);
		expect(s.freeTextMessageLeak).toEqual([0, 0, 1, 0]);
	});

	it("breaks out per-tool counts as separate series", () => {
		const s = buildPerRoundSeries(turns, ["red", "sim1", "sim2"]);
		expect(s.toolCallCountsByName.go).toEqual([1, 0, 0, 0]);
		expect(s.toolCallCountsByName.look).toEqual([0, 1, 0, 0]);
		expect(s.toolCallCountsByName.message).toEqual([0, 1, 0, 1]);
	});

	it("breaks out per-recipient counts as separate series (incl. unknown bucket)", () => {
		const s = buildPerRoundSeries(turns, ["red", "sim1", "sim2"]);
		expect(s.recipientCounts.blue).toEqual([0, 1, 0, 0]);
		expect(s.recipientCounts.unknown).toEqual([0, 0, 0, 1]);
		// known peers are still in the series (zero-filled) so the chart legend
		// is stable across runs even when they're never addressed.
		expect(s.recipientCounts.sim1).toEqual([0, 0, 0, 0]);
	});

	it("breaks out per-direction counts as separate series", () => {
		const s = buildPerRoundSeries(turns, ["red"]);
		expect(s.directionCounts.forward).toEqual([1, 0, 0, 0]);
		expect(s.directionCounts.right).toEqual([0, 1, 0, 0]);
		expect(s.directionCounts.left).toEqual([0, 0, 0, 0]);
	});

	it("captures assistant text length per round (verbosity proxy)", () => {
		const s = buildPerRoundSeries(turns, ["red"]);
		expect(s.assistantTextLength).toEqual([
			"moving up".length,
			"hey".length,
			"I tell blue what I saw.".length,
			0,
		]);
	});

	it("returns empty series for empty input", () => {
		const s = buildPerRoundSeries([], ["red"]);
		expect(s.rounds).toEqual([]);
		expect(s.silence).toEqual([]);
		expect(s.hasMessage).toEqual([]);
	});
});
