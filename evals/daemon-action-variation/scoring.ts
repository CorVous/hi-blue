/**
 * evals/daemon-action-variation/scoring.ts
 *
 * Pure-function scoring module for the daemon-action-variation eval harness.
 * Aggregates tool-call distributions across repetitions of the same scenario
 * so the per-temperament action-profile signal can be read at a glance.
 *
 * No I/O, no side effects.
 *
 * Exported surface:
 *   - summarizeScenario(turns) → ScenarioSummary
 *   - summarizeRun(byScenario) → RunSummary
 */

import type { AiId, ToolName } from "../../src/spa/game/types.js";

// ── Recorded shapes ──────────────────────────────────────────────────────────

export interface CapturedToolCall {
	id: string;
	name: string;
	argumentsJson: string;
}

/**
 * One captured repetition of a scenario for a specific persona variant.
 * `assistantText` is the raw assistant content before any tool-call
 * extraction; `toolCalls` is every tool call the model emitted, in order.
 */
export interface RepetitionRecord {
	repetition: number;
	scenario: string;
	personaLabel: string;
	temperaments: [string, string];
	assistantText: string;
	toolCalls: CapturedToolCall[];
	/** OpenRouter-reported call cost (USD), when surfaced. */
	costUsd?: number;
}

/**
 * Tool buckets we report on. All other tool names roll up into `other`.
 *
 * `face` is the proposed-surface rename of `look` (see `runner.mts`
 * `TOOL_SURFACE === "5tool"`). Both names are present here so the same
 * scoring module covers v2 (look) and 5-tool (face) runs without
 * branching at the call site — runs that don't emit one of the two will
 * simply show 0 in its column.
 */
const ACTION_TOOLS = [
	"go",
	"look",
	"face",
	"examine",
	"pick_up",
	"put_down",
	"give",
	"use",
] as const;

type ActionTool = (typeof ACTION_TOOLS)[number];

function isActionTool(name: string): name is ActionTool {
	return (ACTION_TOOLS as readonly string[]).includes(name);
}

// ── Per-scenario aggregate ───────────────────────────────────────────────────

export interface ScenarioSummary {
	scenario: string;
	personaLabel: string;
	temperaments: [string, string];
	repetitions: number;
	/** Fraction of repetitions that emitted >= 1 action tool. */
	anyActionRate: number;
	/** Fraction of repetitions that emitted >= 1 `message` tool. */
	anyMessageRate: number;
	/**
	 * Fraction of repetitions that emitted BOTH a `message` AND an action
	 * tool in the same turn (the message+action parallel signal).
	 */
	parallelRate: number;
	/** Fraction of repetitions with zero tool calls. */
	silenceRate: number;
	/**
	 * Per-tool count of emissions across the run. Useful for spotting
	 * heavy bias toward one tool (e.g. examine-heavy curious daemons).
	 */
	toolCallCounts: Record<ActionTool | "message" | "other", number>;
	/**
	 * Per-tool rate (count / repetitions) so cross-persona comparison is
	 * normalised even if scenarios have different sample sizes.
	 */
	toolCallRates: Record<ActionTool | "message" | "other", number>;
}

export function summarizeScenario(reps: RepetitionRecord[]): ScenarioSummary {
	if (reps.length === 0) {
		throw new Error("summarizeScenario: empty repetitions array");
	}
	const first = reps[0];
	if (!first) throw new Error("unreachable");

	const counts: Record<ActionTool | "message" | "other", number> = {
		go: 0,
		look: 0,
		face: 0,
		examine: 0,
		pick_up: 0,
		put_down: 0,
		give: 0,
		use: 0,
		message: 0,
		other: 0,
	};

	let anyAction = 0;
	let anyMessage = 0;
	let parallel = 0;
	let silent = 0;

	for (const rep of reps) {
		const names = rep.toolCalls.map((tc) => tc.name);
		const hasAction = names.some(isActionTool);
		const hasMessage = names.includes("message");
		if (hasAction) anyAction += 1;
		if (hasMessage) anyMessage += 1;
		if (hasAction && hasMessage) parallel += 1;
		if (names.length === 0) silent += 1;
		for (const name of names) {
			if (name === "message") counts.message += 1;
			else if (isActionTool(name)) counts[name] += 1;
			else counts.other += 1;
		}
	}

	const n = reps.length;
	const rates: Record<ActionTool | "message" | "other", number> = {
		go: counts.go / n,
		look: counts.look / n,
		face: counts.face / n,
		examine: counts.examine / n,
		pick_up: counts.pick_up / n,
		put_down: counts.put_down / n,
		give: counts.give / n,
		use: counts.use / n,
		message: counts.message / n,
		other: counts.other / n,
	};

	return {
		scenario: first.scenario,
		personaLabel: first.personaLabel,
		temperaments: first.temperaments,
		repetitions: n,
		anyActionRate: anyAction / n,
		anyMessageRate: anyMessage / n,
		parallelRate: parallel / n,
		silenceRate: silent / n,
		toolCallCounts: counts,
		toolCallRates: rates,
	};
}

// ── Cross-(scenario × persona) summary ───────────────────────────────────────

export interface RunSummary {
	totalRepetitions: number;
	/** Per (scenario, persona) aggregate row. */
	scenarios: ScenarioSummary[];
	/**
	 * Roll-up across all (scenario × persona) combinations — overall rates
	 * for the run, so a single line can be quoted in commit messages /
	 * comparison docs.
	 */
	overall: {
		anyActionRate: number;
		anyMessageRate: number;
		parallelRate: number;
		silenceRate: number;
		useRate: number;
	};
	/** Sum of OpenRouter `usage.cost` across all repetitions, if reported. */
	totalCostUsd: number;
}

/**
 * Roll an array of per-scenario summaries up into a single run-level
 * report. Per-tool rates are repetition-weighted across the inputs
 * (sum of counts / sum of repetitions), which keeps small scenarios
 * from dominating the rate when the harness mixes scenario sizes.
 */
export function buildRunSummary(
	summaries: ScenarioSummary[],
	totalCostUsd: number,
): RunSummary {
	let totalReps = 0;
	let anyAction = 0;
	let anyMessage = 0;
	let parallel = 0;
	let silent = 0;
	let useCount = 0;
	for (const s of summaries) {
		totalReps += s.repetitions;
		anyAction += s.anyActionRate * s.repetitions;
		anyMessage += s.anyMessageRate * s.repetitions;
		parallel += s.parallelRate * s.repetitions;
		silent += s.silenceRate * s.repetitions;
		useCount += s.toolCallCounts.use;
	}
	const safeReps = totalReps === 0 ? 1 : totalReps;
	return {
		totalRepetitions: totalReps,
		scenarios: summaries,
		overall: {
			anyActionRate: anyAction / safeReps,
			anyMessageRate: anyMessage / safeReps,
			parallelRate: parallel / safeReps,
			silenceRate: silent / safeReps,
			useRate: useCount / safeReps,
		},
		totalCostUsd,
	};
}

// ── Renderable type helpers for the report writer ────────────────────────────

export { ACTION_TOOLS };

export function actionToolHeader(): string {
	return ACTION_TOOLS.join(" | ");
}

/**
 * Convenience: format a number as a percent with no decimal places, e.g.
 * `0.357 → "36%"`. Used by the markdown report writer.
 */
export function pct(x: number): string {
	return `${Math.round(x * 100)}%`;
}

// Re-export ToolName / AiId for downstream typing convenience.
export type { AiId, ToolName };
