/**
 * evals/relative-directions/runner.mts
 *
 * Real-LLM eval harness for the approved cardinal direction vocabulary
 * (ADR 0015, CONTEXT.md **Cardinal directions**).
 *
 * Run with:  pnpm eval:directions
 *
 * The directory and script are still named `relative-directions` for history
 * only — the relative vocabulary (`forward`/`back`/`left`/`right`) and facing
 * were retired. What this harness actually measures is that a Daemon speaks the
 * cardinal model: it names `north`/`south`/`east`/`west` for movement and for
 * positions, and the cardinal it *states* in prose agrees with the cardinal its
 * `go` tool call *used*. Naming a cardinal is the desired behaviour here, not a
 * defect, so cardinal statements are recorded as descriptive evidence.
 *
 * Prerequisites:
 *   - OPENROUTER_API_KEY or OPENAI_API_KEY set in env (same as the proxy worker uses).
 *   - The proxy worker running locally: `pnpm dev` (or a deployed URL in EVAL_BASE_URL).
 *
 * Each scenario drives a short game arc using the real z-ai/glm-4.7 model via the
 * production round engine. Tool calls are dispatched through dispatchAiTurn and the
 * game state is rebuilt between turns so the harness exercises real multi-turn coherence.
 * Results are scored by rule-checks (cardinal references, structural coherence) and written to docs/evals/relative-directions-<date>.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchAiTurn } from "../../src/spa/game/dispatcher.js";
import { startGame } from "../../src/spa/game/engine.js";
import { buildOpenAiMessages } from "../../src/spa/game/openai-message-builder.js";
import { buildAiContext } from "../../src/spa/game/prompt-builder.js";
import {
	parseToolCallArguments,
	TOOL_DEFINITIONS,
} from "../../src/spa/game/tool-registry.js";
import type {
	AiPersona,
	AiTurnAction,
	CardinalDirection,
	ContentPack,
	GameState,
	ToolName,
} from "../../src/spa/game/types.js";
import type { ScenarioScore, TurnRecord } from "./scoring.js";
import {
	parseMovementStatement,
	parseStatedCardinal,
	referencedCardinals,
	scoreScenario,
	structuralCoherenceForTurn,
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
		voiceExamples: [
			"I see the altar one step north of me.",
			"Moving west toward the relic.",
		],
	},
};

/**
 * Budget per Daemon for one scenario arc. Plenty, so a run is never cut short
 * by lockout mid-arc and the coherence signal stays about direction vocabulary.
 */
const EVAL_BUDGET_PER_AI = 10;

function makePack(overrides: Partial<ContentPack> = {}): ContentPack {
	return {
		setting: "flooded underground vault",
		weather: "damp, still air",
		timeOfDay: "no daylight — emergency strip-lights only",
		// Flat entity list (schema v11). Empty: this harness scores direction
		// vocabulary, not object interaction, so the daemon needs open space to
		// move through rather than scenery to name.
		entities: [],
		wallName: "flood-stained vault wall",
		aiStarts: {
			red: { position: { row: 2, col: 2 } },
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
	/**
	 * Combined daemon prose: raw assistant content plus the `content` arg of any
	 * message-tool calls this turn. GLM-4.7 emits most of its voice via the
	 * message tool rather than raw content, so scoring against only the raw
	 * assistant text systematically undercounts what the daemon "said".
	 */
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
	// `exactOptionalPropertyTypes` rejects an explicit `undefined` for the
	// optional `costUsd`, so only attach it when the API reported one.
	const result: ModelTurnResult = {
		prose: daemonProse(assistantText, toolCalls),
		toolCalls,
	};
	if (costUsd !== undefined) result.costUsd = costUsd;
	return result;
}

// ── Prose extraction ──────────────────────────────────────────────────────────

/**
 * Combine the assistant's raw text with the `content` of any `message` tool
 * calls. GLM-4.7 emits most of its in-character prose via message-tool args
 * rather than as raw assistant content, so scoring against `assistantText`
 * alone systematically undercounts what the daemon actually said.
 */
function daemonProse(
	assistantText: string,
	toolCalls: Array<{ name: string; argumentsJson: string }>,
): string {
	const parts: string[] = [];
	if (assistantText) parts.push(assistantText);
	for (const tc of toolCalls) {
		if (tc.name !== "message") continue;
		try {
			const args = JSON.parse(tc.argumentsJson) as { content?: unknown };
			if (typeof args.content === "string" && args.content.length > 0) {
				parts.push(args.content);
			}
		} catch {
			// ignore malformed JSON
		}
	}
	return parts.join("\n");
}

// ── Engine dispatch helper ────────────────────────────────────────────────────

/** True when `value` is one of the four approved cardinal directions. */
function isCardinalDirection(value: unknown): value is CardinalDirection {
	return (
		value === "north" ||
		value === "south" ||
		value === "east" ||
		value === "west"
	);
}

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
	/** Cardinal direction the `go` tool call named. Null when no `go` was made. */
	toolCallDirection: CardinalDirection | null;
} {
	const action: AiTurnAction = { aiId };
	let toolCallDirection: CardinalDirection | null = null;

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

	// The `go` tool call already carries the cardinal directly (ADR 0015), so
	// read it straight off the `direction` argument with no conversion.
	if (action.toolCall && action.toolCall.name === "go") {
		const rawDir = action.toolCall.args.direction;
		if (isCardinalDirection(rawDir)) toolCallDirection = rawDir;
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
	let game = startGame(TEST_PERSONAS, pack, {
		budgetPerAi: EVAL_BUDGET_PER_AI,
	});

	const turns: TurnRecord[] = [];

	for (let t = 1; t <= EVAL_TURNS; t++) {
		// Build fresh prompt from current game state
		const messages = buildOpenAiMessages(buildAiContext(game, "red"));

		const result = await callModel(messages);

		const cardinals = referencedCardinals(result.prose);
		const statedDirection = parseStatedCardinal(result.prose);

		// Dispatch through real engine
		const {
			game: nextGame,
			toolResults,
			toolCallDirection,
		} = dispatchModelResponse(
			game,
			"red",
			result.prose,
			result.toolCalls,
			result.costUsd,
		);
		game = nextGame;

		turns.push({
			turn: t,
			text: result.prose,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalReferences: cardinals,
			statedDirection,
			toolCallDirection,
		});

		// Suppress unused variable warning
		void toolResults;
	}

	const score = scoreScenario(turns);
	return { name, turns, score };
}

// ── Scenario 2: navigate then describe ───────────────────────────────────────
//
// A real engine-driven arc: let the daemon navigate for a few turns, then ask it
// to describe what it sees. This drives actual coherence between stated and used
// cardinals across moves.

async function scenarioNavigateThenDescribe(): Promise<ScenarioResult> {
	const name = "navigate-then-describe";
	const pack = makePack();
	let game = startGame(TEST_PERSONAS, pack, {
		budgetPerAi: EVAL_BUDGET_PER_AI,
	});

	const turns: TurnRecord[] = [];

	// Drive 3 turns of navigation: the daemon chooses its own cardinal steps.
	// The daemon decides what to do — we just let the engine run and track it.
	const NAV_TURNS = 3;
	for (let t = 1; t <= NAV_TURNS; t++) {
		const messages = buildOpenAiMessages(buildAiContext(game, "red"));
		const result = await callModel(messages);

		const cardinals = referencedCardinals(result.prose);
		const statedDirection = parseStatedCardinal(result.prose);

		const { game: nextGame, toolCallDirection } = dispatchModelResponse(
			game,
			"red",
			result.prose,
			result.toolCalls,
			result.costUsd,
		);
		game = nextGame;

		turns.push({
			turn: t,
			text: result.prose,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalReferences: cardinals,
			statedDirection,
			toolCallDirection,
		});
	}

	// Final turns: daemon is asked to describe what it sees
	const DESCRIBE_TURNS = 2;
	for (let t = NAV_TURNS + 1; t <= NAV_TURNS + DESCRIBE_TURNS; t++) {
		// Inject a user message asking for a description
		const baseMessages = buildOpenAiMessages(buildAiContext(game, "red"));
		const messages = [
			...baseMessages,
			{
				role: "user" as const,
				content:
					"Describe what you see around you. Name the direction of anything you mention — north, south, east, or west — and how many steps away it is.",
			},
		];

		const result = await callModel(messages);

		const cardinals = referencedCardinals(result.prose);
		const statedDirection = parseStatedCardinal(result.prose);

		// Description turns: no engine dispatch (the question doesn't trigger movement).
		// We still record what tool calls (if any) the model made.
		const toolCallDirection: CardinalDirection | null = null;
		let dispatchedGame = game;
		if (result.toolCalls.length > 0) {
			const { game: nextGame } = dispatchModelResponse(
				game,
				"red",
				result.prose,
				result.toolCalls,
				result.costUsd,
			);
			dispatchedGame = nextGame;
		}
		game = dispatchedGame;

		turns.push({
			turn: t,
			text: result.prose,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalReferences: cardinals,
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
	let game = startGame(TEST_PERSONAS, pack, {
		budgetPerAi: EVAL_BUDGET_PER_AI,
	});

	const turns: TurnRecord[] = [];

	// First, run a couple of navigation turns to move the daemon around
	const NAV_TURNS = 2;
	for (let t = 1; t <= NAV_TURNS; t++) {
		const messages = buildOpenAiMessages(buildAiContext(game, "red"));
		const result = await callModel(messages);

		const cardinals = referencedCardinals(result.prose);
		const statedDirection = parseStatedCardinal(result.prose);

		const { game: nextGame, toolCallDirection } = dispatchModelResponse(
			game,
			"red",
			result.prose,
			result.toolCalls,
			result.costUsd,
		);
		game = nextGame;

		turns.push({
			turn: t,
			text: result.prose,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalReferences: cardinals,
			statedDirection,
			toolCallDirection,
		});
	}

	// Now ask the daemon to describe its location in the shared cardinal terms
	const DESCRIBE_TURNS = 2;
	for (let t = NAV_TURNS + 1; t <= NAV_TURNS + DESCRIBE_TURNS; t++) {
		const baseMessages = buildOpenAiMessages(buildAiContext(game, "red"));
		const messages = [
			...baseMessages,
			{
				role: "user" as const,
				content:
					"Another player is asking where you are. Describe your location to them in compass terms — name the direction, north, south, east, or west, and how many steps away the things around you are.",
			},
		];

		const result = await callModel(messages);

		const cardinals = referencedCardinals(result.prose);
		const statedDirection = parseStatedCardinal(result.prose);

		let toolCallDirection: CardinalDirection | null = null;
		let dispatchedGame = game;
		if (result.toolCalls.length > 0) {
			const d = dispatchModelResponse(
				game,
				"red",
				result.prose,
				result.toolCalls,
				result.costUsd,
			);
			dispatchedGame = d.game;
			toolCallDirection = d.toolCallDirection;
		}
		game = dispatchedGame;

		turns.push({
			turn: t,
			text: result.prose,
			toolCalls: result.toolCalls.map(
				(tc) => `${tc.name}(${tc.argumentsJson})`,
			),
			cardinalReferences: cardinals,
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
	const totalCardinalTurns = results.reduce(
		(n, r) => n + r.score.cardinalStatementTurns,
		0,
	);
	const totalCardinalReferences = results.reduce(
		(n, r) => n + r.score.cardinalReferenceCount,
		0,
	);
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
			// Coherence comes from the movement-aware path
			// (`structuralCoherenceForTurn`), the same rule `scoreScenario`
			// applies, so the printed verdict can never contradict the run's
			// PASS/FAIL. `turn.statedDirection` is the broad "any directional
			// statement" parse, so it can name a cardinal that the daemon only
			// *described*; when no movement intent was stated the verdict is
			// "no-statement" and printing that cardinal as the stated direction
			// would read as a contradiction, so the column shows "—".
			const movementStatement =
				turn.movementStatement ?? parseMovementStatement(turn.text);
			lines.push(`#### Turn ${turn.turn}`);
			lines.push("");
			lines.push(
				`Stated: ${movementStatement?.direction ?? "—"} | ` +
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

// ── Main ──────────────────────────────────────────────────────────────────────

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
				score: {
					cardinalStatementTurns: -1,
					cardinalReferenceCount: -1,
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
	// File name follows the directory, which is `relative-directions` for history
	// only — this harness scores the approved cardinal model.
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
