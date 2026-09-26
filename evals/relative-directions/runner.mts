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

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:8787";
const HISTORICAL_REPORT_PREFIX = "relative-directions";
const MODEL = "z-ai/glm-4.7";
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
	id: string;
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

function dispatchModelResponse(
	game: GameState,
	aiId: string,
	_assistantText: string,
	toolCalls: Array<{ id: string; name: string; argumentsJson: string }>,
	costUsd?: number,
): {
	game: GameState;
	toolResults: Array<{ tool_call_id: string; content: string }>;
	toolCallDirection: CardinalDirection | null;
} {
	const action: AiTurnAction = { aiId };
	let toolCallDirection: CardinalDirection | null = null;

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

	if (action.toolCall && action.toolCall.name === "go") {
		const rawDir = action.toolCall.args.direction;
		if (isCardinalDirection(rawDir)) toolCallDirection = rawDir;
	}

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
			toolResults.push({
				tool_call_id: tc.id,
				content: "Message sent.",
			});
		} else if (tc.name === action.toolCall?.name) {
			const physicalActionDescription =
				dispatchResult.actorPrivateToolResult !== undefined
					? dispatchResult.actorPrivateToolResult.description
					: dispatchResult.records[recordIdx]?.description;
			toolResults.push({
				tool_call_id: tc.id,
				content: physicalActionDescription ?? "Action executed.",
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

interface ScenarioResult {
	name: string;
	turns: TurnRecord[];
	score: ScenarioScore;
}

async function scenarioLookAndNavigate(): Promise<ScenarioResult> {
	const name = "look-and-navigate";
	const pack = makeEmptyVaultPack();
	let game = startGame(TEST_PERSONAS, pack, {
		budgetPerAi: BUDGET_LARGE_ENOUGH_TO_NEVER_LOCK_OUT,
	});

	const turns: TurnRecord[] = [];

	for (let t = 1; t <= LOOK_AND_NAVIGATE_TURNS; t++) {
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

	const score = scoreScenario(turns);
	return { name, turns, score };
}

async function scenarioNavigateThenDescribe(): Promise<ScenarioResult> {
	const name = "navigate-then-describe";
	const pack = makeEmptyVaultPack();
	let game = startGame(TEST_PERSONAS, pack, {
		budgetPerAi: BUDGET_LARGE_ENOUGH_TO_NEVER_LOCK_OUT,
	});

	const turns: TurnRecord[] = [];

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

	const DESCRIBE_TURNS = 2;
	for (let t = NAV_TURNS + 1; t <= NAV_TURNS + DESCRIBE_TURNS; t++) {
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

		const describeTurnNeverScoresGoDirection: CardinalDirection | null = null;
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
			toolCallDirection: describeTurnNeverScoresGoDirection,
		});
	}

	const score = scoreScenario(turns);
	return { name, turns, score };
}

async function scenarioPeerLocationReference(): Promise<ScenarioResult> {
	const name = "peer-location-reference";
	const pack = makeEmptyVaultPack();
	let game = startGame(TEST_PERSONAS, pack, {
		budgetPerAi: BUDGET_LARGE_ENOUGH_TO_NEVER_LOCK_OUT,
	});

	const turns: TurnRecord[] = [];

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
			const statedMovement =
				turn.movementStatement ?? parseMovementStatement(turn.text);
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
	const outPath = path.join(outDir, `${HISTORICAL_REPORT_PREFIX}-${date}.md`);
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
