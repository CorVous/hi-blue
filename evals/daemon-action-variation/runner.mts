import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	AVOIDED_BIAS_THRESHOLD,
	actionProfileFor,
	CRITICAL_PATH_TOOLS,
	PREFERRED_BIAS_THRESHOLD,
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
	summarizeScenario,
	wholePercent,
} from "./scoring.js";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:8787";
const MODEL = process.env.EVAL_MODEL ?? "z-ai/glm-4.7";
const REPETITIONS = Number(process.env.EVAL_REPETITIONS ?? 20);
const ACTION_PROFILES_ON = process.env.EVAL_ACTION_PROFILES === "1";
const DIRECT_OPENROUTER = process.env.EVAL_DIRECT_OPENROUTER === "1";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SCENARIO_FILTER = (process.env.EVAL_SCENARIOS ?? "")
	.split(",")
	.map((s) => s.trim())
	.filter((s) => s.length > 0);

const PURE_AVOIDANCE_PROFILE_POLICY: "avoid" | "omit" =
	process.env.EVAL_NO_PREFERRED_POLICY === "omit" ? "omit" : "avoid";

const RUN_LABEL = process.env.EVAL_RUN_LABEL ?? "";
const BUDGET_LARGE_ENOUGH_TO_NEVER_LOCK_OUT = 100;

interface PersonaVariant {
	label: AiId;
	displayName: string;
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

function getSelectedScenarios(): Scenario[] {
	const all = getScenarios();
	if (SCENARIO_FILTER.length === 0) return all;
	const known = new Set(all.map((s) => s.name));
	const unknown = SCENARIO_FILTER.filter((s) => !known.has(s as never));
	if (unknown.length > 0) {
		throw new Error(
			`EVAL_SCENARIOS has unknown scenario(s): ${unknown.join(", ")}. ` +
				`Known: ${[...known].join(", ")}`,
		);
	}
	return all.filter((s) => SCENARIO_FILTER.includes(s.name));
}

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

function rendersPureAvoidanceClause([first, second]: [
	string,
	string,
]): boolean {
	const biases = toolBiasSum(first, second);
	const hasPreferred = ACTION_TOOLS.some(
		(tool) => biases[tool] >= PREFERRED_BIAS_THRESHOLD,
	);
	const hasAvoided = ACTION_TOOLS.some(
		(tool) =>
			biases[tool] <= AVOIDED_BIAS_THRESHOLD && !CRITICAL_PATH_TOOLS.has(tool),
	);
	return !hasPreferred && hasAvoided;
}

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
		const clause = actionProfileFor(
			variant.label,
			variant.temperaments[0],
			variant.temperaments[1],
		);
		const omitProfile =
			PURE_AVOIDANCE_PROFILE_POLICY === "omit" &&
			rendersPureAvoidanceClause(variant.temperaments);
		if (!omitProfile) actor.actionProfile = clause;
	}

	const personas: Record<AiId, AiPersona> = { [variant.label]: actor };
	for (const peerId of peers) personas[peerId] = PEER_PERSONA(peerId);
	return personas;
}

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
		budgetPerAi: BUDGET_LARGE_ENOUGH_TO_NEVER_LOCK_OUT,
	});
	game = advanceRound(game);
	for (const m of scenario.seedMessages) {
		game = appendMessage(game, m.from, m.to, m.content);
	}
	return game;
}

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

function dispatchForParityWithLivePath(
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

async function runOneRepetition(
	scenario: Scenario,
	variant: PersonaVariant,
	repetition: number,
	withActionProfile: boolean,
): Promise<RepetitionRecord> {
	const game = initialiseScenarioState(scenario, variant, withActionProfile);
	const ctx = buildAiContext(game, scenario.actor);
	const messages = buildOpenAiMessages(ctx);
	const tools = availableTools(game, scenario.actor, game.activeComplications);

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

	dispatchForParityWithLivePath(
		game,
		scenario.actor,
		result.toolCalls,
		result.costUsd,
	);

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
	const scenarios = getSelectedScenarios();
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

function renderReport(
	run: RunResult,
	date: string,
	mode: "baseline" | "with-profiles",
): string {
	const variants = getVariants();
	const scenarios = getSelectedScenarios();
	const totalCost = run.repetitions.reduce(
		(acc, r) => acc + (r.costUsd ?? 0),
		0,
	);
	const runSummary = buildRunSummary(run.summaries, totalCost);

	const reportedTools = ACTION_TOOLS;

	const lines: string[] = [
		`# Daemon action variation — ${mode} — ${date}`,
		"",
		`Model: \`${MODEL}\`, repetitions per cell: ${REPETITIONS}.`,
		"",
		`Mode: **${mode}** — \`actionProfiles\` is ${mode === "with-profiles" ? "**ON**" : "**OFF**"}.`,
		"",
		`Scoped run: scenarios=[${(SCENARIO_FILTER.length > 0 ? SCENARIO_FILTER : scenarios.map((s) => s.name)).join(", ")}], ` +
			`no-preferred-\`<action_profile>\` policy=\`${PURE_AVOIDANCE_PROFILE_POLICY}\`` +
			`${RUN_LABEL ? `, run label=\`${RUN_LABEL}\`` : ""}.`,
		"",
		"Tool surface: `go` / `pick_up` / `put_down` / `use` (+ `message`) —",
		"the daemon action set after the ADR 0015 Vista cutover (`examine` and",
		"`give` removed by #466–#472, `face` retired with facing itself).",
		"",
		"Each (scenario × persona variant) cell repeats the *same* first turn with",
		"identical context, so the per-cell distribution measures the model's tool",
		"choice probability — not drift across rounds. See `scenarios.ts` for what",
		"each scenario probes (exploration / objective / social).",
		"",
		"## Overall",
		"",
		"| Metric | Value |",
		"|---|---|",
		`| Total repetitions | ${runSummary.totalRepetitions} |`,
		`| Any action emission | ${wholePercent(runSummary.overall.anyActionRate)} |`,
		`| Any \`message\` emission | ${wholePercent(runSummary.overall.anyMessageRate)} |`,
		`| Parallel (message + action) | ${wholePercent(runSummary.overall.parallelRate)} |`,
		`| Silent | ${wholePercent(runSummary.overall.silenceRate)} |`,
		`| \`use\` emission rate | ${wholePercent(runSummary.overall.useRate)} |`,
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
			wholePercent(s.anyActionRate),
			wholePercent(s.anyMessageRate),
			wholePercent(s.parallelRate),
			wholePercent(s.silenceRate),
		];
		for (const tool of reportedTools)
			row.push(wholePercent(s.toolCallRates[tool]));
		lines.push(`| ${row.join(" | ")} |`);
	}

	lines.push("", "## Per-persona action-bias debug", "");
	lines.push(
		"Summed `toolBiasSum` per variant for cross-reference with the rates above.",
	);
	lines.push("");
	lines.push(`| Persona | Temperaments | ${ACTION_TOOLS.join(" | ")} |`);
	lines.push(`|${"---|".repeat(2 + ACTION_TOOLS.length)}`);
	for (const v of variants) {
		const sums = toolBiasSum(v.temperaments[0], v.temperaments[1]);
		const cells = ACTION_TOOLS.map((k) => String(sums[k]));
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

async function main(): Promise<void> {
	const mode: "baseline" | "with-profiles" = ACTION_PROFILES_ON
		? "with-profiles"
		: "baseline";
	console.log("Running daemon-action-variation eval harness…");
	console.log(`  target:        ${BASE_URL}`);
	console.log(`  model:         ${MODEL}`);
	console.log(`  reps per cell: ${REPETITIONS}`);
	console.log(`  mode:          ${mode}`);
	console.log(`  scenarios:     ${SCENARIO_FILTER.join(",") || "all"}`);
	console.log(`  no-preferred:  ${PURE_AVOIDANCE_PROFILE_POLICY}`);
	console.log(`  run label:     ${RUN_LABEL || "(none)"}`);
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
		"../../docs/evals/daemon-action-variation",
	);
	fs.mkdirSync(outDir, { recursive: true });
	const outputFileStem =
		`${mode}${RUN_LABEL ? `-${RUN_LABEL}` : ""}` +
		`${PURE_AVOIDANCE_PROFILE_POLICY === "omit" ? "-noavoid" : ""}`;
	const mdPath = path.join(outDir, `${outputFileStem}-${date}.md`);
	const jsonPath = path.join(outDir, `${outputFileStem}-${date}.json`);
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
					scenarios: SCENARIO_FILTER.length > 0 ? SCENARIO_FILTER : "all",
					noPreferredPolicy: PURE_AVOIDANCE_PROFILE_POLICY,
					runLabel: RUN_LABEL || null,
					pairs: getVariants().map((v) => v.temperaments.join("+")),
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
