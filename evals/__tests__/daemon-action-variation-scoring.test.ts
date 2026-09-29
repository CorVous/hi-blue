import { describe, expect, it } from "vitest";
import type { RepetitionRecord } from "../daemon-action-variation/scoring.js";
import {
	buildRunSummary,
	summarizeScenario,
} from "../daemon-action-variation/scoring.js";

function rep(
	repetition: number,
	fields: Partial<RepetitionRecord>,
): RepetitionRecord {
	return {
		repetition,
		scenario: "exploration",
		personaLabel: "Ember",
		temperaments: ["curious", "wry"],
		assistantText: "",
		toolCalls: [],
		...fields,
	};
}

describe("summarizeScenario", () => {
	it("scores silent and acting repetitions", () => {
		const summary = summarizeScenario([
			rep(1, {}),
			rep(2, {
				toolCalls: [
					{ id: "g", name: "go", argumentsJson: '{"direction":"north"}' },
				],
			}),
		]);
		expect(summary.repetitions).toBe(2);
		expect(summary.errorCount).toBe(0);
		expect(summary.silenceRate).toBe(0.5);
		expect(summary.toolCallRates.go).toBe(0.5);
	});

	it("excludes errored repetitions instead of scoring them as silent", () => {
		const summary = summarizeScenario([
			rep(1, { error: "Model request failed 502" }),
			rep(2, {
				toolCalls: [
					{ id: "g", name: "go", argumentsJson: '{"direction":"north"}' },
				],
			}),
		]);
		expect(summary.repetitions).toBe(1);
		expect(summary.errorCount).toBe(1);
		expect(summary.silenceRate).toBe(0);
		expect(summary.toolCallRates.go).toBe(1);
	});

	it("reports zero rates when every repetition errored", () => {
		const summary = summarizeScenario([
			rep(1, { error: "a" }),
			rep(2, { error: "b" }),
		]);
		expect(summary.repetitions).toBe(0);
		expect(summary.errorCount).toBe(2);
		expect(summary.silenceRate).toBe(0);
		expect(summary.anyActionRate).toBe(0);
	});
});

describe("buildRunSummary", () => {
	it("totals errors across scenarios and weights rates by scored repetitions", () => {
		const a = summarizeScenario([rep(1, { error: "x" }), rep(2, {})]);
		const b = summarizeScenario([
			rep(1, {
				toolCalls: [{ id: "u", name: "use", argumentsJson: "{}" }],
			}),
		]);
		const run = buildRunSummary([a, b], 0);
		expect(run.totalRepetitions).toBe(2);
		expect(run.totalErrors).toBe(1);
		expect(run.overall.silenceRate).toBe(0.5);
		expect(run.overall.useRate).toBe(0.5);
	});
});
