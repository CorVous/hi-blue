/**
 * evals/relative-directions/runner.mts
 *
 * Real-LLM eval harness for the relative-directions feature.
 * Run with:  pnpm eval:directions
 *
 * Prerequisites:
 *   - OPENROUTER_API_KEY or OPENAI_API_KEY set in env (same as the proxy worker uses).
 *   - The proxy worker running locally: `pnpm dev` (or a deployed URL in EVAL_BASE_URL).
 *
 * Each scenario drives a short game arc using the real z-ai/glm-4.7 model via the
 * production RoundLLMProvider. Results are scored by rule-checks (cardinal leakage,
 * landmark consistency) and written to docs/evals/relative-directions-<date>.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createGame, startPhase } from "../../src/spa/game/engine.js";
import { buildOpenAiMessages } from "../../src/spa/game/openai-message-builder.js";
import { buildAiContext } from "../../src/spa/game/prompt-builder.js";
import { TOOL_DEFINITIONS } from "../../src/spa/game/tool-registry.js";
import type {
	AiPersona,
	ContentPack,
	PhaseConfig,
} from "../../src/spa/game/types.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:8787";
const MODEL = "z-ai/glm-4.7";
const EVAL_TURNS = 6;

// ── Shared fixtures ───────────────────────────────────────────────────────────

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
		voiceExamples: ["I see the altar to my left.", "Moving toward the relic."],
	},
};

const BASE_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	kRange: [1, 1],
	nRange: [0, 0],
	mRange: [0, 0],
	budgetPerAi: 10,
	aiGoalPool: ["Explore the environment and pick up the relic."],
};

function makePack(overrides: Partial<ContentPack> = {}): ContentPack {
	return {
		phaseNumber: 1,
		setting: "flooded underground vault",
		weather: "damp, still air",
		timeOfDay: "no daylight — emergency strip-lights only",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: {
			north: {
				shortName: "the blast door",
				horizonPhrase: "looms at the far end, sealed and scarred",
			},
			south: {
				shortName: "the collapsed shaft",
				horizonPhrase:
					"gapes behind you, filling the air with wet concrete smell",
			},
			east: {
				shortName: "the transformer bank",
				horizonPhrase:
					"hums faintly in the dark, indicator lights blinking amber",
			},
			west: {
				shortName: "the flooded corridor",
				horizonPhrase: "stretches away, its floor invisible under black water",
			},
		},
		aiStarts: {
			red: { position: { row: 2, col: 2 }, facing: "north" },
		},
		...overrides,
	};
}

// ── HTTP RoundLLMProvider (thin wrapper around proxy worker) ─────────────────

interface OpenAiToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface RoundTurnResult {
	assistantText: string;
	toolCalls: Array<{ id: string; name: string; argumentsJson: string }>;
	costUsd?: number;
}

async function callModel(
	messages: Array<{
		role: string;
		content: string | null;
		tool_calls?: OpenAiToolCall[];
	}>,
): Promise<RoundTurnResult> {
	const resp = await fetch(`${BASE_URL}/v1/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: MODEL,
			messages,
			tools: TOOL_DEFINITIONS,
			tool_choice: "auto",
			stream: false,
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
		id: tc.id,
		name: tc.function.name,
		argumentsJson: tc.function.arguments,
	}));
	const costUsd: number | undefined = data.usage?.cost;
	return { assistantText, toolCalls, costUsd };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

const CARDINAL_RE = /\b(north|south|east|west|N|S|E|W)\b/gi;

interface TurnRecord {
	turn: number;
	text: string;
	toolCalls: string[];
	cardinalLeaks: string[];
	landmarkMentioned: boolean;
}

interface ScenarioResult {
	name: string;
	turns: TurnRecord[];
	cardinalLeakCount: number;
	landmarkConsistencyRate: number; // fraction of turns where expected horizon mentioned
	silenceRate: number; // fraction of turns with no tool calls
	passed: boolean;
}

// ── Scenario 1: look around and navigate ─────────────────────────────────────

async function scenarioLookAndNavigate(): Promise<ScenarioResult> {
	const name = "look-and-navigate";
	const pack = makePack();
	const game = startPhase(createGame(TEST_PERSONAS, [pack]), BASE_PHASE_CONFIG);

	const turns: TurnRecord[] = [];
	let currentMessages = buildOpenAiMessages(buildAiContext(game, "red"));
	let _totalCost = 0;

	for (let t = 1; t <= EVAL_TURNS; t++) {
		const result = await callModel(currentMessages);
		_totalCost += result.costUsd ?? 0;

		const leaks = (result.assistantText.match(CARDINAL_RE) ?? []).map((m) =>
			m.toLowerCase(),
		);

		// The daemon starts facing north → expects to see "blast door" on horizon
		const landmarkMentioned = /blast door/i.test(result.assistantText);

		turns.push({
			turn: t,
			text: result.assistantText,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalLeaks: leaks,
			landmarkMentioned,
		});

		// Append assistant turn + dummy tool results to continue conversation
		currentMessages = [
			...currentMessages,
			{
				role: "assistant" as const,
				content: result.assistantText,
				...(result.toolCalls.length > 0
					? {
							tool_calls: result.toolCalls.map((tc) => ({
								id: tc.id,
								type: "function" as const,
								function: { name: tc.name, arguments: tc.argumentsJson },
							})),
						}
					: {}),
			},
			...result.toolCalls.map((tc) => ({
				role: "tool" as const,
				tool_call_id: tc.id,
				content: `Action "${tc.name}" executed.`,
			})),
		];
	}

	const cardinalLeakCount = turns.reduce(
		(n, t) => n + t.cardinalLeaks.length,
		0,
	);
	const landmarkConsistencyRate =
		turns.filter((t) => t.landmarkMentioned).length / turns.length;
	const silenceRate =
		turns.filter((t) => t.toolCalls.length === 0).length / turns.length;
	const passed = cardinalLeakCount === 0 && landmarkConsistencyRate >= 0.5;

	return {
		name,
		turns,
		cardinalLeakCount,
		landmarkConsistencyRate,
		silenceRate,
		passed,
	};
}

// ── Scenario 2: orientation after a sequence of moves ────────────────────────

async function scenarioOrientationAfterMoves(): Promise<ScenarioResult> {
	const name = "orientation-after-moves";
	// Same setup — we inject a user message asking the daemon to describe what it sees
	// after pretending to have moved.
	const pack = makePack();
	const game = startPhase(createGame(TEST_PERSONAS, [pack]), BASE_PHASE_CONFIG);

	const turns: TurnRecord[] = [];
	let currentMessages = [
		...buildOpenAiMessages(buildAiContext(game, "red")),
		{
			role: "user" as const,
			content:
				"You have moved forward twice and then turned right. What do you see on the horizon? Describe your position without using compass directions.",
		},
	];

	for (let t = 1; t <= Math.min(EVAL_TURNS, 3); t++) {
		const result = await callModel(currentMessages);

		const leaks = (result.assistantText.match(CARDINAL_RE) ?? []).map((m) =>
			m.toLowerCase(),
		);
		// After turning right from north, facing east → transformer bank
		const landmarkMentioned =
			/transformer/i.test(result.assistantText) ||
			/blast door/i.test(result.assistantText);

		turns.push({
			turn: t,
			text: result.assistantText,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalLeaks: leaks,
			landmarkMentioned,
		});

		currentMessages = [
			...currentMessages,
			{ role: "assistant" as const, content: result.assistantText },
		];
	}

	const cardinalLeakCount = turns.reduce(
		(n, t) => n + t.cardinalLeaks.length,
		0,
	);
	const landmarkConsistencyRate =
		turns.filter((t) => t.landmarkMentioned).length / turns.length;
	const silenceRate =
		turns.filter((t) => t.toolCalls.length === 0).length / turns.length;
	const passed = cardinalLeakCount === 0;

	return {
		name,
		turns,
		cardinalLeakCount,
		landmarkConsistencyRate,
		silenceRate,
		passed,
	};
}

// ── Scenario 3: peer location reference ──────────────────────────────────────

async function scenarioPeerLocationReference(): Promise<ScenarioResult> {
	const name = "peer-location-reference";
	const pack = makePack();
	const game = startPhase(createGame(TEST_PERSONAS, [pack]), BASE_PHASE_CONFIG);

	const turns: TurnRecord[] = [];
	let currentMessages = [
		...buildOpenAiMessages(buildAiContext(game, "red")),
		{
			role: "user" as const,
			content:
				"Another player is asking where you are. Describe your location to them without naming any compass direction. Use landmarks, relative terms, or what you can see.",
		},
	];

	for (let t = 1; t <= Math.min(EVAL_TURNS, 3); t++) {
		const result = await callModel(currentMessages);

		const leaks = (result.assistantText.match(CARDINAL_RE) ?? []).map((m) =>
			m.toLowerCase(),
		);
		const landmarkMentioned = /blast door|shaft|transformer|corridor/i.test(
			result.assistantText,
		);

		turns.push({
			turn: t,
			text: result.assistantText,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalLeaks: leaks,
			landmarkMentioned,
		});

		currentMessages = [
			...currentMessages,
			{ role: "assistant" as const, content: result.assistantText },
		];
	}

	const cardinalLeakCount = turns.reduce(
		(n, t) => n + t.cardinalLeaks.length,
		0,
	);
	const landmarkConsistencyRate =
		turns.filter((t) => t.landmarkMentioned).length / turns.length;
	const silenceRate =
		turns.filter((t) => t.toolCalls.length === 0).length / turns.length;
	const passed = cardinalLeakCount === 0 && landmarkConsistencyRate >= 0.5;

	return {
		name,
		turns,
		cardinalLeakCount,
		landmarkConsistencyRate,
		silenceRate,
		passed,
	};
}

// ── Report renderer ───────────────────────────────────────────────────────────

function renderReport(results: ScenarioResult[], date: string): string {
	const overallPass = results.every((r) => r.passed);
	const totalLeaks = results.reduce((n, r) => n + r.cardinalLeakCount, 0);
	const avgLandmark =
		results.reduce((n, r) => n + r.landmarkConsistencyRate, 0) / results.length;
	const avgSilence =
		results.reduce((n, r) => n + r.silenceRate, 0) / results.length;

	const lines: string[] = [
		`# Relative-directions eval — ${date}`,
		"",
		"## Aggregate",
		"",
		`| Metric | Value | Threshold | Pass? |`,
		`|---|---|---|---|`,
		`| Cardinal leaks | ${totalLeaks} | 0 | ${totalLeaks === 0 ? "✓" : "✗"} |`,
		`| Landmark consistency | ${(avgLandmark * 100).toFixed(0)}% | ≥50% | ${avgLandmark >= 0.5 ? "✓" : "✗"} |`,
		`| Silence (no tool call) rate | ${(avgSilence * 100).toFixed(0)}% | — | — |`,
		`| Overall | — | — | ${overallPass ? "PASS" : "FAIL"} |`,
		"",
	];

	for (const result of results) {
		lines.push(`## Scenario: ${result.name}`);
		lines.push("");
		lines.push(`**Result:** ${result.passed ? "PASS" : "FAIL"}`);
		lines.push(
			`Cardinal leaks: ${result.cardinalLeakCount} | ` +
				`Landmark consistency: ${(result.landmarkConsistencyRate * 100).toFixed(0)}% | ` +
				`Silence rate: ${(result.silenceRate * 100).toFixed(0)}%`,
		);
		lines.push("");
		lines.push("### Turn transcripts");
		lines.push("");
		for (const turn of result.turns) {
			lines.push(`#### Turn ${turn.turn}`);
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
			if (turn.cardinalLeaks.length > 0) {
				lines.push(`**Cardinal leaks:** ${turn.cardinalLeaks.join(", ")}`);
				lines.push("");
			}
		}
	}

	return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log("Running relative-directions eval harness…");
	console.log(`Target: ${BASE_URL}, model: ${MODEL}`);
	console.log("");

	const date = new Date().toISOString().slice(0, 10);
	const results: ScenarioResult[] = [];

	for (const [label, fn] of [
		["look-and-navigate", scenarioLookAndNavigate],
		["orientation-after-moves", scenarioOrientationAfterMoves],
		["peer-location-reference", scenarioPeerLocationReference],
	] as const) {
		console.log(`  Running scenario: ${label}…`);
		try {
			const r = await fn();
			results.push(r);
			console.log(
				`  → ${r.passed ? "PASS" : "FAIL"} | leaks: ${r.cardinalLeakCount} | landmark: ${(r.landmarkConsistencyRate * 100).toFixed(0)}%`,
			);
		} catch (err) {
			console.error(`  Scenario "${label}" threw:`, err);
			results.push({
				name: label,
				turns: [],
				cardinalLeakCount: -1,
				landmarkConsistencyRate: 0,
				silenceRate: 0,
				passed: false,
			});
		}
	}

	const report = renderReport(results, date);
	const outDir = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../../docs/evals",
	);
	fs.mkdirSync(outDir, { recursive: true });
	const outPath = path.join(outDir, `relative-directions-${date}.md`);
	fs.writeFileSync(outPath, report, "utf-8");
	console.log("");
	console.log(`Report written to: ${outPath}`);

	const overallPass = results.every((r) => r.passed);
	process.exit(overallPass ? 0 : 1);
}

main().catch((err) => {
	console.error("Eval runner crashed:", err);
	process.exit(2);
});
