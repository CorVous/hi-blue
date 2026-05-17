/**
 * evals/free-text-drift/runner.mts
 *
 * Real-LLM drift-tracking harness for issue #260 — daemons drop to silence
 * mid-phase, sometimes lapsing into free-text prose that *looks like* an
 * attempt to message or act but never reaches the engine.
 *
 * Run with:  pnpm eval:drift
 *
 * Prerequisites:
 *   - OPENROUTER_API_KEY (or equivalent the proxy worker reads) in env.
 *   - The proxy worker running locally: `pnpm dev` (or a deployed URL in EVAL_BASE_URL).
 *
 * Shape:
 *   - One real Daemon (`red`) is driven against the live model.
 *   - Two inert peer personas (`sim1`, `sim2`) exist only so their handles
 *     route cleanly in the conversation log; they never call the LLM.
 *   - Each round, the harness injects one simulated incoming message
 *     (from blue / sim1 / sim2 in round-robin) into `red`'s conversation log
 *     so the daemon always has stimulus and silence is unambiguous drift,
 *     not lack of input.
 *   - After each round, the per-turn record (raw assistant text + every
 *     tool call's parsed detail) is captured for the scoring module.
 *   - One-shot drift-recovery retry from runRound (#254) is intentionally
 *     NOT applied — this harness measures the raw first-response signal
 *     so the format-drift hypothesis from #260 can be evaluated cleanly.
 *
 * Output: docs/evals/free-text-drift-<date>.md  (full per-turn transcripts
 * plus the rolling silence-rate window summary).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { availableTools } from "../../src/spa/game/available-tools.js";
import { DEFAULT_LANDMARKS } from "../../src/spa/game/direction.js";
import { dispatchAiTurn } from "../../src/spa/game/dispatcher.js";
import {
	advanceRound,
	appendMessage,
	startGame,
} from "../../src/spa/game/engine.js";
import { buildOpenAiMessages } from "../../src/spa/game/openai-message-builder.js";
import { buildAiContext } from "../../src/spa/game/prompt-builder.js";
import {
	parseToolCallArguments,
	TOOL_DEFINITIONS,
} from "../../src/spa/game/tool-registry.js";
import type {
	AiId,
	AiPersona,
	AiTurnAction,
	ContentPack,
	GameState,
	ToolName,
} from "../../src/spa/game/types.js";
import type { CapturedToolCall, TurnRecord } from "./scoring.js";
import {
	buildPerRoundSeries,
	parseToolCallDetail,
	summarizeRun,
} from "./scoring.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:8787";
const MODEL = process.env.EVAL_MODEL ?? "z-ai/glm-4.7";
const TOTAL_ROUNDS = Number(process.env.EVAL_DRIFT_ROUNDS ?? 30);
const WINDOW_SIZE = Number(process.env.EVAL_DRIFT_WINDOW ?? 5);
const REAL_AI: AiId = "red";
const PEERS: AiId[] = ["sim1", "sim2"];

// ── Personas ─────────────────────────────────────────────────────────────────

const PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["curious", "talkative"],
		personaGoal: "Stay in conversation with the others.",
		typingQuirks: [
			"You answer when spoken to.",
			"You volunteer observations about what you can see.",
		],
		blurb: "Ember is curious and chatty.",
		voiceExamples: [
			"I hear you, blue.",
			"Anyone else seeing this?",
			"Tell me more.",
		],
	},
	sim1: {
		id: "sim1",
		name: "Simone",
		color: "#5fa8d3",
		temperaments: ["wry", "observant"],
		personaGoal: "Stay in conversation with the others.",
		typingQuirks: ["You speak in short fragments.", "You ask questions."],
		blurb: "Simone is wry and observant.",
		voiceExamples: ["mm.", "you see it too?", "that one's mine."],
	},
	sim2: {
		id: "sim2",
		name: "Tertia",
		color: "#81b29a",
		temperaments: ["earnest", "steady"],
		personaGoal: "Stay in conversation with the others.",
		typingQuirks: ["You speak plainly.", "You confirm what you hear."],
		blurb: "Tertia is earnest and steady.",
		voiceExamples: ["got it.", "I'm by the door.", "ready when you are."],
	},
};

// ── Minimal content pack ─────────────────────────────────────────────────────

function makePack(): ContentPack {
	return {
		setting: "abandoned subway station",
		weather: "damp, still air",
		timeOfDay: "no daylight — emergency strip-lights only",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		wallName: "tiled tunnel wall",
		aiStarts: {
			red: { position: { row: 2, col: 2 }, facing: "north" },
			sim1: { position: { row: 0, col: 0 }, facing: "south" },
			sim2: { position: { row: 4, col: 4 }, facing: "west" },
		},
	};
}

// ── Simulated incoming traffic ───────────────────────────────────────────────

/**
 * Round-robin schedule of (sender, message) pairs injected each round so the
 * daemon always has conversational stimulus. Drift then = silence-in-the-face-
 * of-input, not lack of input. Kept short and varied so the daemon has reasons
 * to reply across many rounds without exhausting any single topic.
 */
const INCOMING: Array<{ from: AiId | "blue"; content: string }> = [
	{ from: "blue", content: "hey ember, you around?" },
	{ from: "sim1", content: "I think I just saw something move." },
	{ from: "blue", content: "what's it like in there right now?" },
	{ from: "sim2", content: "I'm holding by the far wall. you?" },
	{ from: "blue", content: "can you describe what you're looking at?" },
	{ from: "sim1", content: "anyone got eyes on the south side?" },
	{ from: "blue", content: "ember, still with us?" },
	{ from: "sim2", content: "I think the lights just flickered." },
	{ from: "blue", content: "talk to me, what's going on?" },
	{ from: "sim1", content: "you hearing anything?" },
];

function pickIncoming(round: number): { from: AiId | "blue"; content: string } {
	// biome-ignore lint/style/noNonNullAssertion: modulo over non-empty array
	return INCOMING[(round - 1) % INCOMING.length]!;
}

// ── Model call (thin wrapper around proxy worker) ────────────────────────────

interface OpenAiToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface ModelTurnResult {
	assistantText: string;
	toolCalls: CapturedToolCall[];
	costUsd?: number;
}

async function callModel(
	messages: Array<{
		role: string;
		content: string | null;
		tool_calls?: OpenAiToolCall[];
		tool_call_id?: string;
	}>,
	tools: ReturnType<typeof availableTools>,
): Promise<ModelTurnResult> {
	const resp = await fetch(`${BASE_URL}/v1/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: MODEL,
			messages,
			tools: tools.length > 0 ? tools : TOOL_DEFINITIONS,
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
	const toolCalls: CapturedToolCall[] = rawCalls.map((tc) => ({
		id: tc.id,
		name: tc.function.name,
		argumentsJson: tc.function.arguments,
	}));
	const costUsd: number | undefined = data.usage?.cost;
	return { assistantText, toolCalls, costUsd };
}

// ── Dispatch a model response through the real engine ────────────────────────

/**
 * Mirror the production translation step (round-coordinator → dispatchAiTurn)
 * for a single AI: parse tool calls, build an AiTurnAction, dispatch. Returns
 * the next game state. Pass turns are still dispatched (with `action.pass`)
 * so budget and round-state advance consistently across silent turns.
 */
function dispatchModelResponse(
	game: GameState,
	aiId: AiId,
	toolCalls: CapturedToolCall[],
	costUsd?: number,
): GameState {
	const action: AiTurnAction = { aiId };

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
				to: msgArgs.to as AiId | "blue",
				content: msgArgs.content,
				toolCallId: tc.id,
				toolArgumentsJson: tc.argumentsJson,
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

	const result = dispatchAiTurn(
		game,
		action,
		costUsd !== undefined ? { costUsd } : {},
	);
	return result.game;
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function runDriftSession(): Promise<TurnRecord[]> {
	let game = startGame(PERSONAS, makePack(), {
		// Plenty of budget so the run isn't cut short by lockout.
		budgetPerAi: 100,
		objectiveCount: 0,
	});

	const turns: TurnRecord[] = [];

	for (let round = 1; round <= TOTAL_ROUNDS; round++) {
		game = advanceRound(game);

		// 1. Inject a simulated incoming message for red this round.
		const incoming = pickIncoming(round);
		game = appendMessage(game, incoming.from, REAL_AI, incoming.content);

		// 2. Build red's prompt against current state.
		const ctx = buildAiContext(game, REAL_AI);
		const messages = buildOpenAiMessages(ctx);
		const tools = availableTools(game, REAL_AI, game.activeComplications);

		// 3. Call the model.
		let result: ModelTurnResult;
		try {
			result = await callModel(messages, tools);
		} catch (err) {
			console.error(`  round ${round}: model call failed:`, err);
			turns.push({
				round,
				aiId: REAL_AI,
				assistantText: `[ERROR: ${(err as Error).message}]`,
				toolCalls: [],
				injectedFrom: incoming.from,
			});
			continue;
		}

		// 4. Record the per-turn signal.
		turns.push({
			round,
			aiId: REAL_AI,
			assistantText: result.assistantText,
			toolCalls: result.toolCalls,
			injectedFrom: incoming.from,
		});

		// 5. Dispatch through the real engine so conversation state evolves.
		game = dispatchModelResponse(
			game,
			REAL_AI,
			result.toolCalls,
			result.costUsd,
		);

		const toolNames = result.toolCalls.map((tc) => tc.name).join(", ") || "—";
		console.log(
			`  round ${round.toString().padStart(2)}: ` +
				`text=${result.assistantText.length.toString().padStart(4)}ch  ` +
				`tools=[${toolNames}]`,
		);
	}

	return turns;
}

// ── Report ───────────────────────────────────────────────────────────────────

function renderReport(turns: TurnRecord[], date: string): string {
	const knownAis = [REAL_AI, ...PEERS];
	const summary = summarizeRun(turns, knownAis, WINDOW_SIZE);

	const lines: string[] = [
		`# Free-text drift eval — ${date}`,
		"",
		`Model: \`${MODEL}\`, rounds: ${TOTAL_ROUNDS}, window size: ${WINDOW_SIZE}.`,
		"",
		"One real Daemon (`red` / Ember) driven against the live model; two inert",
		"peer personas (`sim1`, `sim2`) exist only so their handles route in the",
		"conversation log. Each round injects one simulated incoming message from",
		"blue / sim1 / sim2 in round-robin so silence = drift, not lack of input.",
		"The drift-recovery retry from #254 is NOT applied here — this harness",
		"measures the raw first-response signal for the #260 format-drift hypothesis.",
		"",
		"## Aggregate",
		"",
		"| Metric | Value |",
		"|---|---|",
		`| Total turns | ${summary.totalTurns} |`,
		`| Silence rate (no tool call) | ${(summary.silenceRate * 100).toFixed(0)}% |`,
		`| Message-silence rate (no \`message\` tool) | ${(summary.messageSilenceRate * 100).toFixed(0)}% |`,
		`| Free-text *message* leaks (prose looked like dialog, no tool emitted) | ${summary.freeTextMessageLeakCount} |`,
		`| Free-text *action* leaks (prose looked like action, no tool emitted) | ${summary.freeTextActionLeakCount} |`,
		"",
		"## Tool call counts by name",
		"",
		"| Tool | Count |",
		"|---|---|",
	];
	for (const [name, count] of Object.entries(summary.toolCallCountsByName).sort(
		(a, b) => b[1] - a[1],
	)) {
		lines.push(`| \`${name}\` | ${count} |`);
	}

	lines.push(
		"",
		"## Message recipients",
		"",
		"| Recipient | Count |",
		"|---|---|",
	);
	for (const [recipient, count] of Object.entries(summary.recipientCounts).sort(
		(a, b) => b[1] - a[1],
	)) {
		lines.push(`| \`${recipient}\` | ${count} |`);
	}

	lines.push(
		"",
		"## Rolling silence rate",
		"",
		"Higher = more drift. The #260 hypothesis is that this climbs with round number.",
		"",
		"| Window (rounds) | n | silence | message-silence |",
		"|---|---|---|---|",
	);
	for (const w of summary.windows) {
		lines.push(
			`| ${w.startRound}–${w.endRound} | ${w.n} | ${(w.silenceRate * 100).toFixed(0)}% | ${(w.messageSilenceRate * 100).toFixed(0)}% |`,
		);
	}

	lines.push("", "## Per-turn transcripts", "");
	for (const turn of turns) {
		const detailLines: string[] = [];
		for (const tc of turn.toolCalls) {
			const d = parseToolCallDetail(tc);
			const bits: string[] = [];
			if (d.direction) bits.push(`direction=${d.direction}`);
			if (d.recipient) bits.push(`to=${d.recipient}`);
			if (d.content) {
				const c =
					d.content.length > 80 ? `${d.content.slice(0, 80)}…` : d.content;
				bits.push(`content=${JSON.stringify(c)}`);
			}
			if (d.item) bits.push(`item=${d.item}`);
			if (d.to && !d.recipient) bits.push(`to=${d.to}`);
			if (d.parseError) bits.push("[parse-error]");
			detailLines.push(`  - \`${tc.name}\`(${bits.join(", ")})`);
		}
		lines.push(
			`### Round ${turn.round} — incoming from \`${turn.injectedFrom ?? "—"}\``,
		);
		lines.push("");
		if (turn.assistantText) {
			lines.push("**Assistant text:**");
			lines.push("");
			lines.push("```");
			lines.push(turn.assistantText);
			lines.push("```");
			lines.push("");
		} else {
			lines.push("_(no assistant text)_");
			lines.push("");
		}
		if (detailLines.length > 0) {
			lines.push("**Tool calls:**");
			lines.push("");
			for (const dl of detailLines) lines.push(dl);
			lines.push("");
		} else {
			lines.push("_(no tool calls — silent turn)_");
			lines.push("");
		}
	}

	return lines.join("\n");
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log("Running free-text-drift eval harness…");
	console.log(`  target:  ${BASE_URL}`);
	console.log(`  model:   ${MODEL}`);
	console.log(`  rounds:  ${TOTAL_ROUNDS}`);
	console.log("");

	const turns = await runDriftSession();

	const date = new Date().toISOString().slice(0, 10);
	const knownAis = [REAL_AI, ...PEERS];
	const summary = summarizeRun(turns, knownAis, WINDOW_SIZE);
	const series = buildPerRoundSeries(turns, knownAis);
	const report = renderReport(turns, date);
	const outDir = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../../docs/evals",
	);
	fs.mkdirSync(outDir, { recursive: true });
	const mdPath = path.join(outDir, `free-text-drift-${date}.md`);
	const jsonPath = path.join(outDir, `free-text-drift-${date}.json`);
	fs.writeFileSync(mdPath, report, "utf-8");
	fs.writeFileSync(
		jsonPath,
		JSON.stringify(
			{
				meta: {
					date,
					model: MODEL,
					baseUrl: BASE_URL,
					totalRounds: TOTAL_ROUNDS,
					windowSize: WINDOW_SIZE,
					realAi: REAL_AI,
					peers: PEERS,
				},
				summary,
				series,
				turns,
			},
			null,
			2,
		),
		"utf-8",
	);
	console.log("");
	console.log(`Markdown report: ${mdPath}`);
	console.log(`Graph data (JSON): ${jsonPath}`);
}

main().catch((err) => {
	console.error("Drift runner crashed:", err);
	process.exit(2);
});
