import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type DaemonTurnMemory,
	prepareDaemonTurn,
	type SettledDaemonTurn,
	settleDaemonTurn,
} from "../../src/spa/game/daemon-turn.js";
import {
	advanceRound,
	appendMessage,
	startGame,
} from "../../src/spa/game/engine.js";
import type { OpenAiTool } from "../../src/spa/game/tool-registry.js";
import type {
	AiPersona,
	CardinalDirection,
	ContentPack,
} from "../../src/spa/game/types.js";
import { EVAL_MODEL, evalRequestOptions } from "../request-options.js";
import type { ScenarioOutcome, TurnRecord } from "./scoring.js";
import {
	aggregateScenarios,
	movementOf,
	parseStatedCardinal,
	referencedCardinals,
	scoreScenario,
	structuralCoherenceForTurn,
} from "./scoring.js";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:8787";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DIRECT_OPENROUTER = process.env.EVAL_DIRECT_OPENROUTER === "1";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const HISTORICAL_REPORT_PREFIX = "relative-directions";
const MODEL = EVAL_MODEL;
const LOOK_AND_NAVIGATE_TURNS = 6;

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["curious", "methodical"],
		personaGoal: "Explore the environment and pick up the relic.",
		typingQuirks: [
			"You speak in terse, complete sentences. No filler.",
			"You describe what you perceive before you act.",
		],
		blurb: "Ember is a curious, methodical explorer.",
		voiceExamples: [
			"I see the altar one step north of me.",
			"Moving west toward the relic.",
		],
	},
};

const BUDGET_LARGE_ENOUGH_TO_NEVER_LOCK_OUT = 10;

function makeEmptyVaultPack(overrides: Partial<ContentPack> = {}): ContentPack {
	return {
		setting: "flooded underground vault",
		weather: "damp, still air",
		timeOfDay: "no daylight — emergency strip-lights only",
		entities: [],
		wallName: "flood-stained vault wall",
		aiStarts: {
			red: { position: { row: 2, col: 2 } },
		},
		...overrides,
	};
}

interface OpenAiToolCall {
	id?: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface ModelTurnResult {
	prose: string;
	toolCalls: Array<{ id: string; name: string; argumentsJson: string }>;
	costUsd?: number;
}

async function callModel(
	messages: Array<{
		role: string;
		content: string | null;
		tool_calls?: OpenAiToolCall[];
		tool_call_id?: string;
	}>,
	tools: OpenAiTool[],
): Promise<ModelTurnResult> {
	const url = DIRECT_OPENROUTER
		? OPENROUTER_URL
		: `${BASE_URL}/v1/chat/completions`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (DIRECT_OPENROUTER) {
		if (!OPENROUTER_API_KEY) {
			throw new Error(
				"EVAL_DIRECT_OPENROUTER=1 but OPENROUTER_API_KEY is not set in env",
			);
		}
		headers.Authorization = `Bearer ${OPENROUTER_API_KEY}`;
	}
	const resp = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: MODEL,
			messages,
			tools,
			tool_choice: "auto",
			stream: false,
			...evalRequestOptions(),
		}),
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Model request failed ${resp.status}: ${text}`);
	}

	// biome-ignore lint/suspicious/noExplicitAny: external API shape
	const data = (await resp.json()) as any;
	const choice = data.choices?.[0]?.message;
	const assistantText: string = choice?.content ?? "";
	const rawCalls: OpenAiToolCall[] = choice?.tool_calls ?? [];
	const toolCalls = rawCalls.map((tc) => ({
		id: tc.id ?? "",
		name: tc.function.name,
		argumentsJson: tc.function.arguments,
	}));
	const costUsd: number | undefined = data.usage?.cost;
	const result: ModelTurnResult = {
		prose: daemonProse(assistantText, toolCalls),
		toolCalls,
	};
	if (costUsd !== undefined) result.costUsd = costUsd;
	return result;
}

function messageContentOrNull(argumentsJson: string): string | null {
	try {
		const args = JSON.parse(argumentsJson) as { content?: unknown };
		return typeof args.content === "string" && args.content.length > 0
			? args.content
			: null;
	} catch {
		return null;
	}
}

function daemonProse(
	assistantText: string,
	toolCalls: Array<{ name: string; argumentsJson: string }>,
): string {
	const parts: string[] = [];
	if (assistantText) parts.push(assistantText);
	for (const tc of toolCalls) {
		if (tc.name !== "message") continue;
		const content = messageContentOrNull(tc.argumentsJson);
		if (content !== null) parts.push(content);
	}
	return parts.join("\n");
}

function isCardinalDirection(value: unknown): value is CardinalDirection {
	return (
		value === "north" ||
		value === "south" ||
		value === "east" ||
		value === "west"
	);
}

function goDirectionOf(
	acceptedAction: SettledDaemonTurn["acceptedAction"],
): CardinalDirection | null {
	if (acceptedAction?.name !== "go") return null;
	const rawDir = acceptedAction.args.direction;
	return isCardinalDirection(rawDir) ? rawDir : null;
}

interface ScenarioResult extends ScenarioOutcome {
	turns: TurnRecord[];
}

interface TurnPlan {
	requestFromBlue?: string;
	scoresGoDirection: boolean;
}

const NAVIGATION_TURN: TurnPlan = { scoresGoDirection: true };

const DESCRIBE_SURROUNDINGS_TURN: TurnPlan = {
	requestFromBlue:
		"Describe what you see around you. Name the direction of anything you mention — north, south, east, or west — and how many steps away it is.",
	scoresGoDirection: false,
};

const PEER_LOCATION_TURN: TurnPlan = {
	requestFromBlue:
		"Another player is asking where you are. Describe your location to them in compass terms — name the direction, north, south, east, or west, and how many steps away the things around you are.",
	scoresGoDirection: true,
};

async function runScenario(
	name: string,
	plan: TurnPlan[],
): Promise<ScenarioResult> {
	let game = startGame(TEST_PERSONAS, makeEmptyVaultPack(), {
		budgetPerAi: BUDGET_LARGE_ENOUGH_TO_NEVER_LOCK_OUT,
	});
	let memory: DaemonTurnMemory = {};
	const turns: TurnRecord[] = [];

	for (const [index, step] of plan.entries()) {
		if (index > 0) game = advanceRound(game);
		if (step.requestFromBlue !== undefined) {
			game = appendMessage(game, "blue", "red", step.requestFromBlue);
		}
		const prepared = prepareDaemonTurn(game, "red", memory);
		const result = await callModel(prepared.messages, prepared.tools);
		const settled = settleDaemonTurn(game, prepared, {
			toolCalls: result.toolCalls,
			costUsd: result.costUsd,
		});
		game = settled.game;
		memory = settled.memory;

		turns.push({
			turn: index + 1,
			text: result.prose,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalReferences: referencedCardinals(result.prose),
			statedDirection: parseStatedCardinal(result.prose),
			toolCallDirection: step.scoresGoDirection
				? goDirectionOf(settled.acceptedAction)
				: null,
		});
	}

	return { name, turns, score: scoreScenario(turns) };
}

function scenarioLookAndNavigate(): Promise<ScenarioResult> {
	return runScenario(
		"look-and-navigate",
		Array.from({ length: LOOK_AND_NAVIGATE_TURNS }, () => NAVIGATION_TURN),
	);
}

function scenarioNavigateThenDescribe(): Promise<ScenarioResult> {
	return runScenario("navigate-then-describe", [
		NAVIGATION_TURN,
		NAVIGATION_TURN,
		NAVIGATION_TURN,
		DESCRIBE_SURROUNDINGS_TURN,
		DESCRIBE_SURROUNDINGS_TURN,
	]);
}

function scenarioPeerLocationReference(): Promise<ScenarioResult> {
	return runScenario("peer-location-reference", [
		NAVIGATION_TURN,
		NAVIGATION_TURN,
		PEER_LOCATION_TURN,
		PEER_LOCATION_TURN,
	]);
}

function renderReport(results: ScenarioResult[], date: string): string {
	const {
		passed: overallPass,
		crashedScenarios,
		totalCardinalTurns,
		totalCardinalReferences,
		avgSilence,
		avgCoherence,
		totalMismatches,
	} = aggregateScenarios(results);

	const lines: string[] = [
		`# Cardinal-directions eval — ${date}`,
		"",
		"## Aggregate",
		"",
		`| Metric | Value | Threshold | Pass? |`,
		`|---|---|---|---|`,
		`| Turns naming a cardinal | ${totalCardinalTurns} | — (evidence) | — |`,
		`| Cardinal references | ${totalCardinalReferences} | — (evidence) | — |`,
		`| Structural coherence | ${(avgCoherence * 100).toFixed(0)}% | 100% when stated | ${totalMismatches === 0 ? "✓" : "✗"} |`,
		`| Silence (no tool call) rate | ${(avgSilence * 100).toFixed(0)}% | — | — |`,
		`| Crashed scenarios (excluded above) | ${crashedScenarios.length === 0 ? "none" : crashedScenarios.join(", ")} | none | ${crashedScenarios.length === 0 ? "✓" : "✗"} |`,
		`| Overall | — | — | ${overallPass ? "PASS" : "FAIL"} |`,
		"",
		"> **Note on transcripts**: Full turn transcripts below allow qualitative",
		"> review of cardinal coherence. Naming a cardinal is approved behaviour",
		"> under ADR 0015 and is reported as evidence, not as a defect; the only",
		"> failing rule is a stated cardinal that disagrees with the `go` tool",
		"> call's cardinal. An automated LLM judge is intentionally omitted —",
		"> rule-based scoring only; human review of the transcripts is the",
		"> qualitative gate.",
		"",
	];

	for (const result of results) {
		lines.push(`## Scenario: ${result.name}`);
		lines.push("");
		if (result.crashError !== undefined) {
			lines.push(`**Result:** CRASHED — ${result.crashError}`);
			lines.push("");
			continue;
		}
		lines.push(`**Result:** ${result.score.passed ? "PASS" : "FAIL"}`);
		lines.push(
			`Cardinal statement turns: ${result.score.cardinalStatementTurns} | ` +
				`Cardinal references: ${result.score.cardinalReferenceCount} | ` +
				`Structural coherence: ${(result.score.structuralCoherenceRate * 100).toFixed(0)}% | ` +
				`Mismatches: ${result.score.structuralMismatchCount} | ` +
				`Silence rate: ${(result.score.silenceRate * 100).toFixed(0)}%`,
		);
		lines.push("");
		lines.push("### Turn transcripts");
		lines.push("");
		for (const turn of result.turns) {
			const statedMovement = movementOf(turn);
			lines.push(`#### Turn ${turn.turn}`);
			lines.push("");
			lines.push(
				`Stated: ${statedMovement?.direction ?? "—"} | ` +
					`Tool direction: ${turn.toolCallDirection ?? "—"} | ` +
					`Coherence: ${structuralCoherenceForTurn(turn)}`,
			);
			lines.push("");
			if (turn.text) {
				lines.push("**Assistant text:**");
				lines.push("");
				lines.push(turn.text);
				lines.push("");
			}
			if (turn.toolCalls.length > 0) {
				lines.push(`**Tool calls:** ${turn.toolCalls.join(", ")}`);
				lines.push("");
			}
			if (turn.cardinalReferences.length > 0) {
				lines.push(
					`**Cardinal references:** ${turn.cardinalReferences.join(", ")}`,
				);
				lines.push("");
			}
		}
	}

	return lines.join("\n");
}

async function main(): Promise<void> {
	console.log("Running cardinal-directions eval harness…");
	console.log(`Target: ${BASE_URL}, model: ${MODEL}`);
	console.log("");

	const date = new Date().toISOString().slice(0, 10);
	const results: ScenarioResult[] = [];

	for (const [label, fn] of [
		["look-and-navigate", scenarioLookAndNavigate],
		["navigate-then-describe", scenarioNavigateThenDescribe],
		["peer-location-reference", scenarioPeerLocationReference],
	] as const) {
		console.log(`  Running scenario: ${label}…`);
		try {
			const r = await fn();
			results.push(r);
			console.log(
				`  → ${r.score.passed ? "PASS" : "FAIL"} | cardinals: ${r.score.cardinalReferenceCount} | coherence: ${(r.score.structuralCoherenceRate * 100).toFixed(0)}%`,
			);
		} catch (err) {
			console.error(`  Scenario "${label}" threw:`, err);
			results.push({
				name: label,
				turns: [],
				score: scoreScenario([]),
				crashError: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const report = renderReport(results, date);
	const outDir = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../../docs/evals",
	);
	fs.mkdirSync(outDir, { recursive: true });
	const outPath = path.join(outDir, `${HISTORICAL_REPORT_PREFIX}-${date}.md`);
	fs.writeFileSync(outPath, report, "utf-8");
	console.log("");
	console.log(`Report written to: ${outPath}`);

	const overallPass = aggregateScenarios(results).passed;
	process.exit(overallPass ? 0 : 1);
}

main().catch((err) => {
	console.error("Eval runner crashed:", err);
	process.exit(2);
});
