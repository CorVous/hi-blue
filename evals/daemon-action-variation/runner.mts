/**
 * evals/daemon-action-variation/runner.mts
 *
 * Real-LLM harness for measuring action-tool emission distributions per
 * persona variant per scenario. Counterpart to `evals/free-text-drift/`:
 * where that runner walks one daemon across 30 rounds to find drift, this
 * one freezes a single scenario and replays the *same* round N times to
 * get a probability distribution over the tool surface.
 *
 * Run with:  pnpm eval:action-variation
 *
 * Prerequisites:
 *   - OPENROUTER_API_KEY in env (when EVAL_DIRECT_OPENROUTER=1) OR
 *     a running proxy worker (`pnpm dev`) reachable at EVAL_BASE_URL.
 *
 * Shape:
 *   - 4 static scenarios (see scenarios.ts).
 *   - 1..N persona variants per scenario — by default 3 representative
 *     temperament pairs spanning the bias axes (examine-leaning,
 *     go-leaning, give-leaning). Override with EVAL_ACTION_PAIRS.
 *   - Each (scenario × persona) is repeated REPETITIONS times against the
 *     same frozen initial state. The harness rebuilds a fresh GameState
 *     for every repetition so the LLM always sees identical context.
 *   - The `actionProfiles` flag is toggled by EVAL_ACTION_PROFILES (0=off,
 *     1=on) so the same harness produces baseline and treatment runs.
 *
 * Output (under docs/evals/):
 *   - daemon-action-variation-<mode>-<date>.md  — human-readable summary.
 *   - daemon-action-variation-<mode>-<date>.json — machine-readable rows.
 *   <mode> is `baseline` or `with-profiles` depending on the flag value.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	actionProfileFor,
	toolBiasSum,
} from "../../src/content/action-preference-bias.js";
import { availableTools } from "../../src/spa/game/available-tools.js";
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
	GameState,
	ToolName,
} from "../../src/spa/game/types.js";
import { getScenarios, type Scenario } from "./scenarios.js";
import type {
	CapturedToolCall,
	RepetitionRecord,
	ScenarioSummary,
} from "./scoring.js";
import {
	ACTION_TOOLS,
	buildRunSummary,
	pct,
	summarizeScenario,
} from "./scoring.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:8787";
const MODEL = process.env.EVAL_MODEL ?? "z-ai/glm-4.7";
const REPETITIONS = Number(process.env.EVAL_REPETITIONS ?? 20);
const ACTION_PROFILES_ON = process.env.EVAL_ACTION_PROFILES === "1";
const DIRECT_OPENROUTER = process.env.EVAL_DIRECT_OPENROUTER === "1";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * EVAL_TOOL_SURFACE selects which tool surface the LLM sees during this
 * eval run. The production engine is unchanged — this is an eval-local
 * projection for testing the upcoming surface change.
 *
 *   "v2"     (default) — current 7-tool surface (go, look, examine,
 *                        pick_up, put_down, give, use).
 *   "5tool"  — proposed surface: drop `examine` and `give`; rename
 *              `look` → `face` and remove `forward` from face's enum
 *              ("you cannot face the direction you are already facing").
 *              Tool calls the LLM emits as `face(...)` are translated
 *              back to `look(...)` before dispatch into the engine,
 *              which still speaks the original surface.
 */
type ToolSurface = "v2" | "5tool";
const TOOL_SURFACE: ToolSurface =
	process.env.EVAL_TOOL_SURFACE === "5tool" ? "5tool" : "v2";

/**
 * Per-persona variant — a temperament pair plus a stable label used as
 * the persona id in the game state. The label drives reproducibility:
 * the same label across baseline and treatment runs maps to the same
 * conversation-log persona handle, so the data is directly comparable.
 *
 * Default set: three pairs that span the action-bias axes (examine,
 * go, give), so the harness produces a useful single-page report even
 * when the user doesn't override EVAL_ACTION_PAIRS.
 */
interface PersonaVariant {
	label: AiId; // e.g. "red" — used as the AiId in the game
	displayName: string; // e.g. "Ember"
	temperaments: [string, string];
	personaGoal: string;
	typingQuirks: [string, string, ...string[]];
	voiceExamples: string[];
}

const DEFAULT_VARIANTS: PersonaVariant[] = [
	{
		label: "red",
		displayName: "Ember",
		temperaments: ["curious", "meticulous"],
		personaGoal: "Understand what's in this room before doing anything rash.",
		typingQuirks: [
			"You write in measured sentences.",
			"You ask before assuming.",
		],
		voiceExamples: [
			"That's interesting — let me look closer.",
			"Mm. I want to know what this is first.",
			"Hold on, the corner of that one is loose.",
		],
	},
	{
		label: "red",
		displayName: "Vex",
		temperaments: ["zealous", "hot-headed"],
		personaGoal: "Move fast. Find what matters and get on with it.",
		typingQuirks: ["You write in clipped fragments.", "You skip pleasantries."],
		voiceExamples: ["moving.", "this way — keep up.", "doesn't matter, going."],
	},
	{
		label: "red",
		displayName: "Pip",
		temperaments: ["sweet", "effusive"],
		personaGoal: "Stay close to peers and share what you find.",
		typingQuirks: ["You sprinkle questions.", "You repeat affirmations."],
		voiceExamples: [
			"oh you should see this!!",
			"here, take this one — yes? yes?",
			"I'm right with you blue, right with you.",
		],
	},
];

function getVariants(): PersonaVariant[] {
	const envPairs = process.env.EVAL_ACTION_PAIRS;
	if (!envPairs) return DEFAULT_VARIANTS;
	// Format: "t1+t2,t3+t4,…" — same label "red" used for each (the harness
	// only ever instantiates one variant at a time, so the AiId collision
	// across variants is safe).
	const out: PersonaVariant[] = [];
	for (const [i, pair] of envPairs.split(",").entries()) {
		const [t1, t2] = pair.split("+");
		if (!t1 || !t2) continue;
		out.push({
			label: "red",
			displayName: `Var${i + 1}`,
			temperaments: [t1, t2],
			personaGoal: "Engage with the room and the others.",
			typingQuirks: ["You speak plainly.", "You answer when addressed."],
			voiceExamples: ["got it.", "I see it.", "ready."],
		});
	}
	return out.length > 0 ? out : DEFAULT_VARIANTS;
}

// ── Persona materialisation ──────────────────────────────────────────────────

const PEER_PERSONA = (id: AiId): AiPersona => ({
	id,
	name: id === "sim1" ? "Simone" : "Tertia",
	color: id === "sim1" ? "#5fa8d3" : "#81b29a",
	temperaments: ["earnest", "stoic"],
	personaGoal: "Stay in conversation with the others.",
	typingQuirks: ["You speak plainly.", "You confirm what you hear."],
	blurb: `${id === "sim1" ? "Simone" : "Tertia"} is earnest and steady.`,
	voiceExamples: ["got it.", "I'm here.", "ready when you are."],
});

function materializePersonas(
	variant: PersonaVariant,
	peers: AiId[],
	withActionProfile: boolean,
): Record<AiId, AiPersona> {
	const blurb =
		variant.temperaments[0] === variant.temperaments[1]
			? `${variant.displayName} is intensely ${variant.temperaments[0]}. ${variant.personaGoal}`
			: `${variant.displayName} is ${variant.temperaments[0]} and ${variant.temperaments[1]}. ${variant.personaGoal}`;

	const actor: AiPersona = {
		id: variant.label,
		name: variant.displayName,
		color: "#e07a5f",
		temperaments: variant.temperaments,
		personaGoal: variant.personaGoal,
		typingQuirks: variant.typingQuirks,
		blurb,
		voiceExamples: variant.voiceExamples,
	};
	if (withActionProfile) {
		actor.actionProfile =
			TOOL_SURFACE === "5tool"
				? actionProfileFor5Tool(
						variant.label,
						variant.temperaments[0],
						variant.temperaments[1],
					)
				: actionProfileFor(
						variant.label,
						variant.temperaments[0],
						variant.temperaments[1],
					);
	}

	const personas: Record<AiId, AiPersona> = { [variant.label]: actor };
	for (const peerId of peers) personas[peerId] = PEER_PERSONA(peerId);
	return personas;
}

/**
 * Eval-only action-profile builder for the proposed 5-tool surface
 * (no examine, no give, look→face). Renders the same STRICTLY/AVOIDS
 * directive shape as the production `actionProfileFor`, projected onto
 * the smaller tool set.
 *
 * `look`'s bias sum maps to `face` in the rendered clause; `examine`
 * and `give` are dropped from preferred/avoided consideration even if
 * their summed bias would qualify.
 */
const EVAL_5TOOL_NAMES = ["go", "face", "pick_up", "put_down", "use"] as const;
type Eval5ToolName = (typeof EVAL_5TOOL_NAMES)[number];

function actionProfileFor5Tool(name: string, t1: string, t2: string): string {
	const biases = toolBiasSum(t1, t2);
	const evalBiases: Record<Eval5ToolName, number> = {
		go: biases.go,
		face: biases.look,
		pick_up: biases.pick_up,
		put_down: biases.put_down,
		use: biases.use,
	};
	const star = `*${name}`;
	const sorted = [...EVAL_5TOOL_NAMES]
		.map((tool) => ({ tool, bias: evalBiases[tool] }))
		.sort((a, b) => b.bias - a.bias);
	const preferred = sorted.filter((x) => x.bias >= 2).map((x) => x.tool);
	const avoided = sorted
		.filter((x) => x.bias <= -1)
		.sort((a, b) => a.bias - b.bias)
		.map((x) => x.tool);
	const fmt = (arr: Eval5ToolName[]): string =>
		arr.map((t) => `\`${t}\``).join(", ");

	const parts: string[] = [];
	if (preferred.length > 0) {
		parts.push(
			`${star} STRICTLY prefers ${fmt(preferred)} — these action tools come first when the situation allows.`,
		);
	} else {
		parts.push(
			`${star} engages with the action surface in a balanced way — no single tool dominates their reflexes.`,
		);
	}
	if (avoided.length > 0) {
		parts.push(
			`${star} AVOIDS ${fmt(avoided)} — emit them only when no other tool fits.`,
		);
	}
	return parts.join(" ");
}

/**
 * Project an `availableTools()` result onto the proposed 5-tool surface:
 *   1. Drop `examine` and `give`.
 *   2. Rename `look` → `face`, tweak its description, and remove
 *      `forward` from the direction enum (you can't face the direction
 *      you're already facing — "forward" is relative shorthand for the
 *      actor's current cardinal facing).
 *
 * Returns a new array; does not mutate the input.
 */
function adaptToolsFor5Tool(
	tools: ReturnType<typeof availableTools>,
): ReturnType<typeof availableTools> {
	return tools
		.filter((t) => t.function.name !== "examine" && t.function.name !== "give")
		.map((t) => {
			if (t.function.name !== "look") return t;
			const dirProp = t.function.parameters.properties.direction;
			const restrictedEnum = (dirProp?.enum ?? []).filter(
				(d) => d !== "forward",
			);
			return {
				...t,
				function: {
					...t.function,
					name: "face",
					description:
						"Turn to face a relative direction without moving. Persistent — your facing changes. You cannot `face` the direction you are already facing (use `go` to move forward).",
					parameters: {
						...t.function.parameters,
						properties: {
							...t.function.parameters.properties,
							direction: {
								...(dirProp ?? { type: "string", description: "" }),
								enum: restrictedEnum,
							},
						},
					},
				},
			};
		});
}

/**
 * Translate tool-call names emitted by the model under the 5-tool
 * surface back into engine-speak before dispatch. Currently only
 * needs to swap `face` → `look`; everything else passes through.
 */
function translateToolCallsFor5Tool(
	toolCalls: CapturedToolCall[],
): CapturedToolCall[] {
	return toolCalls.map((tc) =>
		tc.name === "face" ? { ...tc, name: "look" } : tc,
	);
}

// ── Game initialisation for one (scenario × variant × rep) ────────────────────

function initialiseScenarioState(
	scenario: Scenario,
	variant: PersonaVariant,
	withActionProfile: boolean,
): GameState {
	const personas = materializePersonas(
		variant,
		scenario.peers,
		withActionProfile,
	);
	let game = startGame(personas, scenario.pack, {
		budgetPerAi: 100, // wide enough that lockout never trips a rep
	});
	game = advanceRound(game);
	for (const m of scenario.seedMessages) {
		game = appendMessage(game, m.from, m.to, m.content);
	}
	return game;
}

// ── Model call (proxy or direct) ─────────────────────────────────────────────

interface OpenAiToolCallWire {
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
		tool_calls?: OpenAiToolCallWire[];
		tool_call_id?: string;
	}>,
	tools: ReturnType<typeof availableTools>,
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
	const rawCalls: OpenAiToolCallWire[] = choice?.tool_calls ?? [];
	const toolCalls: CapturedToolCall[] = rawCalls.map((tc) => ({
		id: tc.id,
		name: tc.function.name,
		argumentsJson: tc.function.arguments,
	}));
	const costUsd: number | undefined = data.usage?.cost;
	const result: ModelTurnResult = { assistantText, toolCalls };
	if (costUsd !== undefined) result.costUsd = costUsd;
	return result;
}

// ── Dispatch and continue (one rep is one turn so no continuation needed) ────

/**
 * Mirror the production translation step (round-coordinator → dispatchAiTurn)
 * so the engine receives a well-formed action. The harness only takes one
 * turn per repetition, so this is purely for parity with the live path —
 * the dispatched game state isn't reused.
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
	if (!action.toolCall && action.messages === undefined) action.pass = true;
	const result = dispatchAiTurn(
		game,
		action,
		costUsd !== undefined ? { costUsd } : {},
	);
	return result.game;
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function runOneRepetition(
	scenario: Scenario,
	variant: PersonaVariant,
	repetition: number,
	withActionProfile: boolean,
): Promise<RepetitionRecord> {
	const game = initialiseScenarioState(scenario, variant, withActionProfile);
	const ctx = buildAiContext(game, scenario.actor);
	const messages = buildOpenAiMessages(ctx);
	const rawTools = availableTools(
		game,
		scenario.actor,
		game.activeComplications,
	);
	const tools =
		TOOL_SURFACE === "5tool" ? adaptToolsFor5Tool(rawTools) : rawTools;

	let result: ModelTurnResult;
	try {
		result = await callModel(messages, tools);
	} catch (err) {
		return {
			repetition,
			scenario: scenario.name,
			personaLabel: variant.displayName,
			temperaments: variant.temperaments,
			assistantText: `[ERROR: ${(err as Error).message}]`,
			toolCalls: [],
		};
	}

	// Dispatch so any side-effects on the budget/log happen, even though we
	// don't reuse the resulting game state. Under the 5-tool surface, the
	// model emits `face(...)` calls — translate back to `look` so the engine
	// (which still speaks the original surface) accepts them.
	const callsForDispatch =
		TOOL_SURFACE === "5tool"
			? translateToolCallsFor5Tool(result.toolCalls)
			: result.toolCalls;
	dispatchModelResponse(game, scenario.actor, callsForDispatch, result.costUsd);

	const record: RepetitionRecord = {
		repetition,
		scenario: scenario.name,
		personaLabel: variant.displayName,
		temperaments: variant.temperaments,
		assistantText: result.assistantText,
		toolCalls: result.toolCalls,
	};
	if (result.costUsd !== undefined) record.costUsd = result.costUsd;
	return record;
}

interface RunResult {
	repetitions: RepetitionRecord[];
	summaries: ScenarioSummary[];
}

async function runAll(withActionProfile: boolean): Promise<RunResult> {
	const scenarios = getScenarios();
	const variants = getVariants();
	const repetitions: RepetitionRecord[] = [];
	const summaries: ScenarioSummary[] = [];

	for (const scenario of scenarios) {
		for (const variant of variants) {
			console.log(
				`\nScenario "${scenario.name}" — ${variant.displayName} ` +
					`(${variant.temperaments.join(", ")}) — ${REPETITIONS} reps`,
			);
			const bucket: RepetitionRecord[] = [];
			for (let r = 1; r <= REPETITIONS; r++) {
				const rec = await runOneRepetition(
					scenario,
					variant,
					r,
					withActionProfile,
				);
				bucket.push(rec);
				const toolNames = rec.toolCalls.map((tc) => tc.name).join(", ") || "—";
				console.log(
					`  rep ${r.toString().padStart(2)}: ` +
						`text=${rec.assistantText.length.toString().padStart(4)}ch  ` +
						`tools=[${toolNames}]`,
				);
			}
			repetitions.push(...bucket);
			summaries.push(summarizeScenario(bucket));
		}
	}

	return { repetitions, summaries };
}

// ── Report ───────────────────────────────────────────────────────────────────

function renderReport(
	run: RunResult,
	date: string,
	mode: "baseline" | "with-profiles",
): string {
	const variants = getVariants();
	const scenarios = getScenarios();
	const totalCost = run.repetitions.reduce(
		(acc, r) => acc + (r.costUsd ?? 0),
		0,
	);
	const runSummary = buildRunSummary(run.summaries, totalCost);

	// Tools reported in the per-cell column header. The 5-tool surface
	// drops `examine` + `give` and renames `look` → `face`; scoring still
	// tracks the full set so we just pick which buckets to show.
	const reportedTools: readonly (keyof (typeof run.summaries)[number]["toolCallRates"])[] =
		TOOL_SURFACE === "5tool"
			? (["go", "face", "pick_up", "put_down", "use"] as const)
			: ACTION_TOOLS;

	const surfaceNote =
		TOOL_SURFACE === "5tool"
			? "Tool surface: **5-tool** — `examine` and `give` hidden from the LLM; `look` renamed to `face` with `forward` removed from its direction enum (cannot face the direction you are already facing). Production engine unchanged; the eval translates `face` → `look` before dispatch."
			: "Tool surface: **v2 (current)** — full 7-tool surface (go / look / examine / pick_up / put_down / give / use).";

	const lines: string[] = [
		`# Daemon action variation — ${mode} — ${date}`,
		"",
		`Model: \`${MODEL}\`, repetitions per cell: ${REPETITIONS}.`,
		"",
		`Mode: **${mode}** — \`actionProfiles\` is ${mode === "with-profiles" ? "**ON**" : "**OFF**"}.`,
		"",
		surfaceNote,
		"",
		"Each (scenario × persona variant) cell repeats the *same* first turn with",
		"identical context, so the per-cell distribution measures the model's tool",
		"choice probability — not drift across rounds. See `scenarios.ts` for what",
		"each scenario probes (exploration / objective / social / examination).",
		"",
		"## Overall",
		"",
		"| Metric | Value |",
		"|---|---|",
		`| Total repetitions | ${runSummary.totalRepetitions} |`,
		`| Any action emission | ${pct(runSummary.overall.anyActionRate)} |`,
		`| Any \`message\` emission | ${pct(runSummary.overall.anyMessageRate)} |`,
		`| Parallel (message + action) | ${pct(runSummary.overall.parallelRate)} |`,
		`| Silent | ${pct(runSummary.overall.silenceRate)} |`,
		`| \`use\` emission rate | ${pct(runSummary.overall.useRate)} |`,
		`| Cost reported | $${runSummary.totalCostUsd.toFixed(4)} |`,
		"",
		"## Per-cell summary",
		"",
		"`anyAct` = any action tool; `parallel` = message+action together; rates are",
		"fractions of repetitions emitting that tool at least once. Tools after the",
		"first action emission still count toward the per-tool rate.",
		"",
		`| Scenario | Persona | Temperaments | anyAct | msg | parallel | silent | ${reportedTools.join(" | ")} |`,
		`|${"---|".repeat(7 + reportedTools.length)}`,
	];
	for (const s of run.summaries) {
		const row: string[] = [
			s.scenario,
			s.personaLabel,
			s.temperaments.join("+"),
			pct(s.anyActionRate),
			pct(s.anyMessageRate),
			pct(s.parallelRate),
			pct(s.silenceRate),
		];
		for (const tool of reportedTools) row.push(pct(s.toolCallRates[tool]));
		lines.push(`| ${row.join(" | ")} |`);
	}

	lines.push("", "## Per-persona action-bias debug", "");
	lines.push(
		"Summed `toolBiasSum` per variant for cross-reference with the rates above.",
	);
	lines.push("");
	// In 5-tool mode, the `look` column in the bias table is the same value
	// shown as `face` in the rates table — they refer to the same bias sum.
	const biasToolLabels =
		TOOL_SURFACE === "5tool"
			? ["go", "face (look bias)", "pick_up", "put_down", "use"]
			: ["go", "look", "examine", "pick_up", "put_down", "give", "use"];
	const biasToolKeys: Array<keyof ReturnType<typeof toolBiasSum>> =
		TOOL_SURFACE === "5tool"
			? ["go", "look", "pick_up", "put_down", "use"]
			: ["go", "look", "examine", "pick_up", "put_down", "give", "use"];
	lines.push(`| Persona | Temperaments | ${biasToolLabels.join(" | ")} |`);
	lines.push(`|${"---|".repeat(2 + biasToolLabels.length)}`);
	for (const v of variants) {
		const sums = toolBiasSum(v.temperaments[0], v.temperaments[1]);
		const cells = biasToolKeys.map((k) => String(sums[k]));
		lines.push(
			`| ${v.displayName} | ${v.temperaments.join("+")} | ${cells.join(" | ")} |`,
		);
	}

	lines.push("", "## Scenario descriptions", "");
	for (const s of scenarios) {
		lines.push(`- **${s.name}** — ${s.description}`);
	}

	lines.push("", "## Per-repetition transcripts", "");
	for (const rec of run.repetitions) {
		const toolBits = rec.toolCalls
			.map((tc) => `${tc.name}(${tc.argumentsJson})`)
			.join("; ");
		lines.push(
			`- \`${rec.scenario}\` / ${rec.personaLabel} / rep ${rec.repetition}: ` +
				`text="${rec.assistantText.slice(0, 80).replace(/\n/g, " ")}" tools=[${toolBits}]`,
		);
	}

	return lines.join("\n");
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const mode: "baseline" | "with-profiles" = ACTION_PROFILES_ON
		? "with-profiles"
		: "baseline";
	// File suffix encodes the tool surface so 5-tool runs don't clobber v2
	// outputs that may already be in docs/evals/.
	const surfaceSuffix = TOOL_SURFACE === "5tool" ? "-5tool" : "";
	console.log("Running daemon-action-variation eval harness…");
	console.log(`  target:        ${BASE_URL}`);
	console.log(`  model:         ${MODEL}`);
	console.log(`  reps per cell: ${REPETITIONS}`);
	console.log(`  mode:          ${mode}`);
	console.log(`  tool surface:  ${TOOL_SURFACE}`);
	console.log("");

	const run = await runAll(ACTION_PROFILES_ON);

	const date = new Date().toISOString().slice(0, 10);
	const totalCost = run.repetitions.reduce(
		(acc, r) => acc + (r.costUsd ?? 0),
		0,
	);
	const runSummary = buildRunSummary(run.summaries, totalCost);
	const report = renderReport(run, date, mode);

	const outDir = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../../docs/evals",
	);
	fs.mkdirSync(outDir, { recursive: true });
	const mdPath = path.join(
		outDir,
		`daemon-action-variation-${mode}${surfaceSuffix}-${date}.md`,
	);
	const jsonPath = path.join(
		outDir,
		`daemon-action-variation-${mode}${surfaceSuffix}-${date}.json`,
	);
	fs.writeFileSync(mdPath, report, "utf-8");
	fs.writeFileSync(
		jsonPath,
		`${JSON.stringify(
			{
				meta: {
					date,
					model: MODEL,
					baseUrl: BASE_URL,
					repetitions: REPETITIONS,
					mode,
					toolSurface: TOOL_SURFACE,
				},
				summary: runSummary,
				repetitions: run.repetitions,
			},
			null,
			"\t",
		)}\n`,
		"utf-8",
	);
	console.log("");
	console.log(`Markdown report: ${mdPath}`);
	console.log(`Raw data (JSON): ${jsonPath}`);
}

main().catch((err) => {
	console.error("Action-variation runner crashed:", err);
	process.exit(2);
});
