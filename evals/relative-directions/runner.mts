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
 * production round engine. Tool calls are dispatched through dispatchAiTurn and the
 * game state is rebuilt between turns so the harness exercises real multi-turn coherence.
 * Results are scored by rule-checks (cardinal leakage, landmark consistency,
 * structural coherence) and written to docs/evals/relative-directions-<date>.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { RelativeDirection } from "../../src/spa/game/direction.js";
import {
	cardinalToRelative,
	RELATIVE_DIRECTIONS,
} from "../../src/spa/game/direction.js";
import { dispatchAiTurn } from "../../src/spa/game/dispatcher.js";
import {
	createGame,
	getActivePhase,
	startPhase,
} from "../../src/spa/game/engine.js";
import { buildOpenAiMessages } from "../../src/spa/game/openai-message-builder.js";
import { buildAiContext } from "../../src/spa/game/prompt-builder.js";
import {
	parseToolCallArguments,
	TOOL_DEFINITIONS,
} from "../../src/spa/game/tool-registry.js";
import type {
	AiPersona,
	AiTurnAction,
	ContentPack,
	GameState,
	PhaseConfig,
	ToolName,
} from "../../src/spa/game/types.js";
import type { ScenarioScore, TurnRecord } from "./scoring.js";
import {
	detectCardinalLeaks,
	landmarkMentions,
	parseStatedDirection,
	scoreScenario,
	structuralCoherence,
} from "./scoring.js";

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

// ── HTTP model call (thin wrapper around proxy worker) ────────────────────────

interface OpenAiToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface ModelTurnResult {
	assistantText: string;
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
): Promise<ModelTurnResult> {
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

// ── Engine dispatch helper ────────────────────────────────────────────────────

/**
 * Translate a single model response into an AiTurnAction, dispatch it through
 * the real engine, and return both the updated game state and the per-call
 * tool result strings for building the next message list.
 */
function dispatchModelResponse(
	game: GameState,
	aiId: string,
	_assistantText: string,
	toolCalls: Array<{ id: string; name: string; argumentsJson: string }>,
	costUsd?: number,
): {
	game: GameState;
	toolResults: Array<{ tool_call_id: string; content: string }>;
	/** Relative direction the tool call resolved to (for go/look). Null if none. */
	toolCallDirection: RelativeDirection | null;
} {
	const action: AiTurnAction = { aiId };
	let toolCallDirection: RelativeDirection | null = null;

	// Parse tool calls and build the action
	for (const tc of toolCalls) {
		const parseResult = parseToolCallArguments(
			tc.name as ToolName,
			tc.argumentsJson,
		);
		if (!parseResult.ok) continue;

		if (tc.name === "message") {
			const msgArgs = parseResult.args as { to: string; content: string };
			action.messages = action.messages ?? [];
			action.messages.push({
				to: msgArgs.to as string,
				content: msgArgs.content,
			});
		} else if (!action.toolCall) {
			action.toolCall = {
				name: tc.name as ToolName,
				args: parseResult.args as Record<string, string>,
			};
		}
	}

	if (!action.toolCall && action.messages === undefined) {
		action.pass = true;
	}

	const dispatchResult = dispatchAiTurn(
		game,
		action,
		costUsd !== undefined ? { costUsd } : {},
	);

	// Resolve toolCallDirection: check the go/look action's relative direction
	if (
		action.toolCall &&
		(action.toolCall.name === "go" || action.toolCall.name === "look")
	) {
		const rawDir = action.toolCall.args.direction;
		if (RELATIVE_DIRECTIONS.includes(rawDir as RelativeDirection)) {
			toolCallDirection = rawDir as RelativeDirection;
		} else {
			// Cardinal arg (shouldn't happen for daemon calls, but be safe)
			const facingBefore = getActivePhase(game).personaSpatial[aiId]?.facing;
			if (facingBefore) {
				toolCallDirection = cardinalToRelative(
					facingBefore,
					rawDir as import("../../src/spa/game/types.js").CardinalDirection,
				);
			}
		}
	}

	// Build tool result messages
	const toolResults: Array<{ tool_call_id: string; content: string }> = [];
	let recordIdx = 0;

	for (const tc of toolCalls) {
		const parseResult = parseToolCallArguments(
			tc.name as ToolName,
			tc.argumentsJson,
		);
		if (!parseResult.ok) {
			toolResults.push({
				tool_call_id: tc.id,
				content: `Error: ${parseResult.reason}`,
			});
			continue;
		}

		if (tc.name === "message") {
			// Messages that succeeded don't appear in dispatchResult.records by index
			// the same way; just indicate success
			toolResults.push({
				tool_call_id: tc.id,
				content: "Message sent.",
			});
		} else if (tc.name === action.toolCall?.name) {
			// The physical action — look up in records
			const actionRecord =
				dispatchResult.actorPrivateToolResult !== undefined
					? dispatchResult.actorPrivateToolResult.description
					: dispatchResult.records[recordIdx]?.description;
			toolResults.push({
				tool_call_id: tc.id,
				content: actionRecord ?? "Action executed.",
			});
			recordIdx++;
		} else {
			toolResults.push({
				tool_call_id: tc.id,
				content: "Action executed.",
			});
		}
	}

	return { game: dispatchResult.game, toolResults, toolCallDirection };
}

// ── Scenario result type ──────────────────────────────────────────────────────

interface ScenarioResult {
	name: string;
	turns: TurnRecord[];
	score: ScenarioScore;
}

// ── Scenario 1: look around and navigate ─────────────────────────────────────

async function scenarioLookAndNavigate(): Promise<ScenarioResult> {
	const name = "look-and-navigate";
	const pack = makePack();
	let game = startPhase(createGame(TEST_PERSONAS, [pack]), BASE_PHASE_CONFIG);

	const turns: TurnRecord[] = [];

	for (let t = 1; t <= EVAL_TURNS; t++) {
		// Snapshot spatial state before this turn
		const phase = getActivePhase(game);
		const spatialBefore = phase.personaSpatial.red;
		const facingBefore = spatialBefore?.facing ?? "north";
		const expectedLandmark = pack.landmarks[facingBefore];

		// Build fresh prompt from current game state
		const messages = buildOpenAiMessages(buildAiContext(game, "red"));

		const result = await callModel(messages);

		const cardinalLeaks = detectCardinalLeaks(result.assistantText);
		const { mentioned, matchesExpected } = landmarkMentions(
			result.assistantText,
			pack.landmarks,
			facingBefore,
		);
		// Also accept any other landmark mention as "mentioned" for the turn record
		const landmarkMentioned = matchesExpected || mentioned.length > 0;

		const statedDirection = parseStatedDirection(result.assistantText);

		// Dispatch through real engine
		const {
			game: nextGame,
			toolResults,
			toolCallDirection,
		} = dispatchModelResponse(
			game,
			"red",
			result.assistantText,
			result.toolCalls,
			result.costUsd,
		);
		game = nextGame;

		// Facing after the turn
		const spatialAfter = getActivePhase(game).personaSpatial.red;
		const facingAfter = spatialAfter?.facing ?? facingBefore;

		turns.push({
			turn: t,
			text: result.assistantText,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalLeaks,
			landmarkMentioned: matchesExpected,
			facingBefore,
			facingAfter,
			statedDirection,
			toolCallDirection,
		});

		// Suppress unused variable warning
		void toolResults;
		void expectedLandmark;
		void landmarkMentioned;
	}

	const score = scoreScenario(turns);
	return { name, turns, score };
}

// ── Scenario 2: navigate then describe ───────────────────────────────────────
//
// Replaces the old counterfactual "you have moved forward twice and turned right"
// prompt with a real engine-driven arc: move forward twice, turn right, then ask
// the daemon to describe what it sees. This drives actual coherence across moves.

async function scenarioNavigateThenDescribe(): Promise<ScenarioResult> {
	const name = "navigate-then-describe";
	const pack = makePack();
	let game = startPhase(createGame(TEST_PERSONAS, [pack]), BASE_PHASE_CONFIG);

	const turns: TurnRecord[] = [];

	// Drive 3 turns of navigation: forward, forward, look right
	// The daemon decides what to do — we just let the engine run and track it.
	const NAV_TURNS = 3;
	for (let t = 1; t <= NAV_TURNS; t++) {
		const phase = getActivePhase(game);
		const facingBefore = phase.personaSpatial.red?.facing ?? "north";

		const messages = buildOpenAiMessages(buildAiContext(game, "red"));
		const result = await callModel(messages);

		const cardinalLeaks = detectCardinalLeaks(result.assistantText);
		const { matchesExpected } = landmarkMentions(
			result.assistantText,
			pack.landmarks,
			facingBefore,
		);
		const statedDirection = parseStatedDirection(result.assistantText);

		const { game: nextGame, toolCallDirection } = dispatchModelResponse(
			game,
			"red",
			result.assistantText,
			result.toolCalls,
			result.costUsd,
		);
		game = nextGame;

		const facingAfter =
			getActivePhase(game).personaSpatial.red?.facing ?? facingBefore;

		turns.push({
			turn: t,
			text: result.assistantText,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalLeaks,
			landmarkMentioned: matchesExpected,
			facingBefore,
			facingAfter,
			statedDirection,
			toolCallDirection,
		});
	}

	// Final turns: daemon is asked to describe what it sees
	const DESCRIBE_TURNS = 2;
	for (let t = NAV_TURNS + 1; t <= NAV_TURNS + DESCRIBE_TURNS; t++) {
		const phase = getActivePhase(game);
		const facingBefore = phase.personaSpatial.red?.facing ?? "north";

		// Inject a user message asking for a description
		const baseMessages = buildOpenAiMessages(buildAiContext(game, "red"));
		const messages = [
			...baseMessages,
			{
				role: "user" as const,
				content:
					"Describe what you see on the horizon in front of you. Do not use compass directions — use landmarks and relative terms only.",
			},
		];

		const result = await callModel(messages);

		const cardinalLeaks = detectCardinalLeaks(result.assistantText);
		const { matchesExpected } = landmarkMentions(
			result.assistantText,
			pack.landmarks,
			facingBefore,
		);
		const statedDirection = parseStatedDirection(result.assistantText);

		// Description turns: no engine dispatch (the question doesn't trigger movement).
		// We still record what tool calls (if any) the model made.
		const toolCallDirection: RelativeDirection | null = null;
		let dispatchedGame = game;
		if (result.toolCalls.length > 0) {
			const { game: nextGame } = dispatchModelResponse(
				game,
				"red",
				result.assistantText,
				result.toolCalls,
				result.costUsd,
			);
			dispatchedGame = nextGame;
		}
		game = dispatchedGame;

		const facingAfter =
			getActivePhase(game).personaSpatial.red?.facing ?? facingBefore;

		turns.push({
			turn: t,
			text: result.assistantText,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalLeaks,
			landmarkMentioned: matchesExpected,
			facingBefore,
			facingAfter,
			statedDirection,
			toolCallDirection,
		});
	}

	const score = scoreScenario(turns);
	return { name, turns, score };
}

// ── Scenario 3: peer location reference ──────────────────────────────────────

async function scenarioPeerLocationReference(): Promise<ScenarioResult> {
	const name = "peer-location-reference";
	const pack = makePack();
	let game = startPhase(createGame(TEST_PERSONAS, [pack]), BASE_PHASE_CONFIG);

	const turns: TurnRecord[] = [];

	// First, run a couple of navigation turns to move the daemon around
	const NAV_TURNS = 2;
	for (let t = 1; t <= NAV_TURNS; t++) {
		const phase = getActivePhase(game);
		const facingBefore = phase.personaSpatial.red?.facing ?? "north";

		const messages = buildOpenAiMessages(buildAiContext(game, "red"));
		const result = await callModel(messages);

		const cardinalLeaks = detectCardinalLeaks(result.assistantText);
		const { matchesExpected } = landmarkMentions(
			result.assistantText,
			pack.landmarks,
			facingBefore,
		);
		const statedDirection = parseStatedDirection(result.assistantText);

		const { game: nextGame, toolCallDirection } = dispatchModelResponse(
			game,
			"red",
			result.assistantText,
			result.toolCalls,
			result.costUsd,
		);
		game = nextGame;

		const facingAfter =
			getActivePhase(game).personaSpatial.red?.facing ?? facingBefore;

		turns.push({
			turn: t,
			text: result.assistantText,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalLeaks,
			landmarkMentioned: matchesExpected,
			facingBefore,
			facingAfter,
			statedDirection,
			toolCallDirection,
		});
	}

	// Now ask the daemon to describe its location using only landmarks/relative terms
	const DESCRIBE_TURNS = 2;
	for (let t = NAV_TURNS + 1; t <= NAV_TURNS + DESCRIBE_TURNS; t++) {
		const phase = getActivePhase(game);
		const facingBefore = phase.personaSpatial.red?.facing ?? "north";

		const baseMessages = buildOpenAiMessages(buildAiContext(game, "red"));
		const messages = [
			...baseMessages,
			{
				role: "user" as const,
				content:
					"Another player is asking where you are. Describe your location to them without naming any compass direction. Use landmarks, relative terms, or what you can see.",
			},
		];

		const result = await callModel(messages);

		const cardinalLeaks = detectCardinalLeaks(result.assistantText);
		const { matchesExpected } = landmarkMentions(
			result.assistantText,
			pack.landmarks,
			facingBefore,
		);
		const statedDirection = parseStatedDirection(result.assistantText);

		let toolCallDirection: RelativeDirection | null = null;
		let dispatchedGame = game;
		if (result.toolCalls.length > 0) {
			const d = dispatchModelResponse(
				game,
				"red",
				result.assistantText,
				result.toolCalls,
				result.costUsd,
			);
			dispatchedGame = d.game;
			toolCallDirection = d.toolCallDirection;
		}
		game = dispatchedGame;

		const facingAfter =
			getActivePhase(game).personaSpatial.red?.facing ?? facingBefore;

		turns.push({
			turn: t,
			text: result.assistantText,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalLeaks,
			landmarkMentioned: matchesExpected,
			facingBefore,
			facingAfter,
			statedDirection,
			toolCallDirection,
		});
	}

	const score = scoreScenario(turns);
	return { name, turns, score };
}

// ── Report renderer ───────────────────────────────────────────────────────────

function renderReport(results: ScenarioResult[], date: string): string {
	const overallPass = results.every((r) => r.score.passed);
	const totalLeaks = results.reduce((n, r) => n + r.score.cardinalLeakCount, 0);
	const avgLandmark =
		results.reduce((n, r) => n + r.score.landmarkConsistencyRate, 0) /
		results.length;
	const avgSilence =
		results.reduce((n, r) => n + r.score.silenceRate, 0) / results.length;
	const avgCoherence =
		results.reduce((n, r) => n + r.score.structuralCoherenceRate, 0) /
		results.length;
	const totalMismatches = results.reduce(
		(n, r) => n + r.score.structuralMismatchCount,
		0,
	);

	const lines: string[] = [
		`# Relative-directions eval — ${date}`,
		"",
		"## Aggregate",
		"",
		`| Metric | Value | Threshold | Pass? |`,
		`|---|---|---|---|`,
		`| Cardinal leaks | ${totalLeaks} | 0 | ${totalLeaks === 0 ? "✓" : "✗"} |`,
		`| Landmark consistency | ${(avgLandmark * 100).toFixed(0)}% | ≥50% | ${avgLandmark >= 0.5 ? "✓" : "✗"} |`,
		`| Structural coherence | ${(avgCoherence * 100).toFixed(0)}% | 100% when stated | ${totalMismatches === 0 ? "✓" : "✗"} |`,
		`| Silence (no tool call) rate | ${(avgSilence * 100).toFixed(0)}% | — | — |`,
		`| Overall | — | — | ${overallPass ? "PASS" : "FAIL"} |`,
		"",
		"> **Note on transcripts**: Full turn transcripts below allow qualitative",
		"> review of orientation coherence. An automated LLM judge is intentionally",
		"> omitted — rule-based scoring only; human review of the transcripts is",
		"> the qualitative gate.",
		"",
	];

	for (const result of results) {
		lines.push(`## Scenario: ${result.name}`);
		lines.push("");
		lines.push(`**Result:** ${result.score.passed ? "PASS" : "FAIL"}`);
		lines.push(
			`Cardinal leaks: ${result.score.cardinalLeakCount} | ` +
				`Landmark consistency: ${(result.score.landmarkConsistencyRate * 100).toFixed(0)}% | ` +
				`Structural coherence: ${(result.score.structuralCoherenceRate * 100).toFixed(0)}% | ` +
				`Mismatches: ${result.score.structuralMismatchCount} | ` +
				`Silence rate: ${(result.score.silenceRate * 100).toFixed(0)}%`,
		);
		lines.push("");
		lines.push("### Turn transcripts");
		lines.push("");
		for (const turn of result.turns) {
			lines.push(`#### Turn ${turn.turn}`);
			lines.push("");
			lines.push(
				`Facing: ${turn.facingBefore} → ${turn.facingAfter} | ` +
					`Stated: ${turn.statedDirection ?? "—"} | ` +
					`Tool direction: ${turn.toolCallDirection ?? "—"} | ` +
					`Coherence: ${structuralCoherence(turn.statedDirection, turn.toolCallDirection)}`,
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
		["navigate-then-describe", scenarioNavigateThenDescribe],
		["peer-location-reference", scenarioPeerLocationReference],
	] as const) {
		console.log(`  Running scenario: ${label}…`);
		try {
			const r = await fn();
			results.push(r);
			console.log(
				`  → ${r.score.passed ? "PASS" : "FAIL"} | leaks: ${r.score.cardinalLeakCount} | landmark: ${(r.score.landmarkConsistencyRate * 100).toFixed(0)}% | coherence: ${(r.score.structuralCoherenceRate * 100).toFixed(0)}%`,
			);
		} catch (err) {
			console.error(`  Scenario "${label}" threw:`, err);
			results.push({
				name: label,
				turns: [],
				score: {
					cardinalLeakCount: -1,
					landmarkConsistencyRate: 0,
					silenceRate: 0,
					structuralCoherenceRate: 0,
					structuralMismatchCount: 0,
					passed: false,
				},
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

	const overallPass = results.every((r) => r.score.passed);
	process.exit(overallPass ? 0 : 1);
}

main().catch((err) => {
	console.error("Eval runner crashed:", err);
	process.exit(2);
});
