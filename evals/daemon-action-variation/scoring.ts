import { ACTION_TOOLS } from "../../src/content/action-preference-bias.js";

export interface CapturedToolCall {
	id: string;
	name: string;
	argumentsJson: string;
}

export interface RepetitionRecord {
	repetition: number;
	scenario: string;
	personaLabel: string;
	temperaments: [string, string];
	assistantText: string;
	toolCalls: CapturedToolCall[];
	costUsd?: number;
}

type ActionTool = (typeof ACTION_TOOLS)[number];

function isActionTool(name: string): name is ActionTool {
	return (ACTION_TOOLS as readonly string[]).includes(name);
}

export interface ScenarioSummary {
	scenario: string;
	personaLabel: string;
	temperaments: [string, string];
	repetitions: number;
	anyActionRate: number;
	anyMessageRate: number;
	parallelRate: number;
	silenceRate: number;
	toolCallCounts: Record<ActionTool | "message" | "other", number>;
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
		pick_up: 0,
		put_down: 0,
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
		pick_up: counts.pick_up / n,
		put_down: counts.put_down / n,
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

export interface RunSummary {
	totalRepetitions: number;
	scenarios: ScenarioSummary[];
	overall: {
		anyActionRate: number;
		anyMessageRate: number;
		parallelRate: number;
		silenceRate: number;
		useRate: number;
	};
	totalCostUsd: number;
}

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

export { ACTION_TOOLS };

export function wholePercent(x: number): string {
	return `${Math.round(x * 100)}%`;
}
