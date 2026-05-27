/**
 * evals/content-pack-flakiness/runner.mts
 *
 * Real-LLM harness for content-pack dual generation. Replays the production
 * retry loop (BrowserContentPackProvider.generateDualContentPacks) against
 * OpenRouter directly, recording every outer attempt's outcome so we can
 * see which validation rules trip in practice.
 *
 * Run with:
 *   OPENROUTER_API_KEY=... npx tsx evals/content-pack-flakiness/runner.mts
 *
 * Knobs:
 *   - EVAL_ITERATIONS (default 10): independent end-to-end runs.
 *   - EVAL_MODEL (default z-ai/glm-4.7): OpenRouter model id.
 *
 * Each iteration draws a fresh setting/theme/weather/timeOfDay and a fresh
 * objective-type triple, then drives the OUTER_BUDGET=3 retry loop just
 * like production. Output is written to docs/evals/content-pack-flakiness/.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SETTING_POOL } from "../../src/content/setting-pool.js";
import { THEME_POOL } from "../../src/content/theme-pool.js";
import { TIME_OF_DAY_POOL } from "../../src/content/time-of-day-pool.js";
import { WEATHER_POOL } from "../../src/content/weather-pool.js";
import { PINNED_MODEL } from "../../src/model.js";
import { validateBoundDualContentPack } from "../../src/spa/game/binding-aware-validator.js";
import { buildDualBindingPrompt } from "../../src/spa/game/binding-prompt-builder.js";
import {
	buildCorrectiveFeedback,
	buildOuterMessages,
	DUAL_CONTENT_PACK_SYSTEM_PROMPT,
	type OuterChatMessage,
	type ValidationError,
} from "../../src/spa/game/content-pack-provider.js";
import { rollObjectiveTypes } from "../../src/spa/game/objective-type-roll.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const MODEL = process.env.EVAL_MODEL ?? PINNED_MODEL;
const ITERATIONS = Number(process.env.EVAL_ITERATIONS ?? 10);
const PARALLEL = Number(process.env.EVAL_PARALLEL ?? 1);
const OUTER_BUDGET = 3;

if (!OPENROUTER_API_KEY) {
	console.error("OPENROUTER_API_KEY is not set in env");
	process.exit(1);
}

// ── Per-attempt record ───────────────────────────────────────────────────────

type AttemptOutcome = "ok" | "validation-failed" | "hard-error";

interface AttemptRecord {
	iter: number;
	attempt: number;
	outcome: AttemptOutcome;
	rawLength?: number;
	errorMessage?: string;
	validationErrors?: Array<{
		retryUnitKind: string;
		rule: string;
		entityId: string;
		field: string;
	}>;
}

interface IterationResult {
	iter: number;
	settingA: string;
	settingB: string;
	theme: string;
	objectiveTypes: string[];
	finalOutcome: "ok" | "exhausted" | "thrown";
	finalError?: string;
	attempts: AttemptRecord[];
	totalCostUsd?: number;
}

// ── Draw helpers ─────────────────────────────────────────────────────────────

function rng(): () => number {
	return Math.random;
}

function drawDistinct<T>(
	pool: readonly T[],
	count: number,
	r: () => number,
): T[] {
	const copy = [...pool];
	const result: T[] = [];
	for (let i = 0; i < count && copy.length > 0; i++) {
		const j = Math.floor(r() * copy.length);
		result.push(copy.splice(j, 1)[0] as T);
	}
	return result;
}

function drawOne<T>(pool: readonly T[], r: () => number): T {
	return pool[Math.floor(r() * pool.length)] as T;
}

// ── Model call (mirrors chatCompletionJson but direct to OpenRouter) ─────────

interface ModelCallResult {
	content: string | null;
	reasoning: string | null;
	costUsd?: number;
}

async function callOpenRouter(
	messages: OuterChatMessage[],
): Promise<ModelCallResult> {
	const resp = await fetch(OPENROUTER_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${OPENROUTER_API_KEY}`,
		},
		body: JSON.stringify({
			model: MODEL,
			messages,
			stream: false,
			response_format: { type: "json_object" },
			usage: { include: true },
			reasoning: { enabled: false },
		}),
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
	}

	const body = (await resp.json()) as {
		choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
		usage?: { cost?: number };
		error?: { message?: string };
	};

	if (body.error) {
		throw new Error(`upstream error: ${body.error.message ?? "unknown"}`);
	}

	const msg = body.choices?.[0]?.message;
	return {
		content: msg?.content ?? null,
		reasoning: msg?.reasoning ?? null,
		...(body.usage?.cost !== undefined ? { costUsd: body.usage.cost } : {}),
	};
}

function summariseValidationError(err: ValidationError) {
	return {
		retryUnitKind: err.retryUnit.kind,
		rule: err.rule,
		entityId: err.entityId,
		field: err.field,
	};
}

// ── One end-to-end iteration ─────────────────────────────────────────────────

async function runIteration(iter: number): Promise<IterationResult> {
	const r = rng();
	const [settingA, settingB] = drawDistinct(SETTING_POOL, 2, r) as [
		string,
		string,
	];
	const weatherA = drawOne(WEATHER_POOL, r);
	const weatherB = drawOne(WEATHER_POOL, r);
	const timeOfDayA = drawOne(TIME_OF_DAY_POOL, r);
	const timeOfDayB = drawOne(TIME_OF_DAY_POOL, r);
	const theme = drawOne(THEME_POOL, r);
	const m = 1 + Math.floor(r() * 3);

	const objectiveTypes = rollObjectiveTypes(r, 3);

	const bindingPrompt = buildDualBindingPrompt(
		objectiveTypes,
		settingA,
		settingB,
		theme,
		weatherA,
		weatherB,
		timeOfDayA,
		timeOfDayB,
		m,
	);

	const schedule = {
		skeletons: bindingPrompt.skeletons,
		decoys: [{ id: "decoy-0" }, { id: "decoy-1" }] as const,
		obstacleCount: m,
	};
	const baseUserPrompt = bindingPrompt.userMessage;
	const systemPrompt = DUAL_CONTENT_PACK_SYSTEM_PROMPT;

	let correctiveFeedback: string | null = null;
	let prevAssistantRaw: string | null = null;
	const attempts: AttemptRecord[] = [];
	let totalCostUsd = 0;

	for (let outer = 0; outer < OUTER_BUDGET; outer++) {
		const messages = buildOuterMessages(
			systemPrompt,
			baseUserPrompt,
			prevAssistantRaw,
			correctiveFeedback,
		);

		let modelResult: ModelCallResult;
		try {
			modelResult = await callOpenRouter(messages);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			attempts.push({
				iter,
				attempt: outer,
				outcome: "hard-error",
				errorMessage: message,
			});
			if (outer === OUTER_BUDGET - 1) {
				return {
					iter,
					settingA,
					settingB,
					theme,
					objectiveTypes,
					finalOutcome: "thrown",
					finalError: message,
					attempts,
					totalCostUsd,
				};
			}
			correctiveFeedback = null;
			prevAssistantRaw = null;
			continue;
		}

		if (modelResult.costUsd !== undefined) totalCostUsd += modelResult.costUsd;
		const raw =
			modelResult.content !== null && modelResult.content !== ""
				? modelResult.content
				: (modelResult.reasoning ?? "");

		if (raw === "") {
			attempts.push({
				iter,
				attempt: outer,
				outcome: "hard-error",
				errorMessage: "empty content and reasoning",
			});
			correctiveFeedback = null;
			prevAssistantRaw = null;
			continue;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			attempts.push({
				iter,
				attempt: outer,
				outcome: "hard-error",
				errorMessage: "JSON parse failed",
				rawLength: raw.length,
			});
			correctiveFeedback = null;
			prevAssistantRaw = null;
			continue;
		}

		const validation = validateBoundDualContentPack(parsed, schedule);
		if (validation.ok) {
			attempts.push({
				iter,
				attempt: outer,
				outcome: "ok",
				rawLength: raw.length,
			});
			return {
				iter,
				settingA,
				settingB,
				theme,
				objectiveTypes,
				finalOutcome: "ok",
				attempts,
				totalCostUsd,
			};
		}

		attempts.push({
			iter,
			attempt: outer,
			outcome: "validation-failed",
			rawLength: raw.length,
			validationErrors: validation.errors.map(summariseValidationError),
		});
		correctiveFeedback = buildCorrectiveFeedback(validation.errors);
		prevAssistantRaw = raw;
	}

	return {
		iter,
		settingA,
		settingB,
		theme,
		objectiveTypes,
		finalOutcome: "exhausted",
		attempts,
		totalCostUsd,
	};
}

// ── Aggregation ──────────────────────────────────────────────────────────────

function tally(results: IterationResult[]): {
	successOnFirst: number;
	successAfterRetry: number;
	exhausted: number;
	thrown: number;
	ruleHistogram: Record<string, number>;
	retryUnitHistogram: Record<string, number>;
	avgAttemptsToSuccess: number;
	totalCostUsd: number;
} {
	const ruleHistogram: Record<string, number> = {};
	const retryUnitHistogram: Record<string, number> = {};
	let successOnFirst = 0;
	let successAfterRetry = 0;
	let exhausted = 0;
	let thrown = 0;
	let attemptsToSuccessSum = 0;
	let totalCostUsd = 0;

	for (const r of results) {
		totalCostUsd += r.totalCostUsd ?? 0;
		if (r.finalOutcome === "ok") {
			const winningAttempt =
				r.attempts.findIndex((a) => a.outcome === "ok") + 1;
			if (winningAttempt === 1) successOnFirst++;
			else successAfterRetry++;
			attemptsToSuccessSum += winningAttempt;
		} else if (r.finalOutcome === "exhausted") {
			exhausted++;
		} else {
			thrown++;
		}
		for (const a of r.attempts) {
			if (!a.validationErrors) continue;
			for (const v of a.validationErrors) {
				ruleHistogram[v.rule] = (ruleHistogram[v.rule] ?? 0) + 1;
				retryUnitHistogram[v.retryUnitKind] =
					(retryUnitHistogram[v.retryUnitKind] ?? 0) + 1;
			}
		}
	}

	const successes = successOnFirst + successAfterRetry;
	return {
		successOnFirst,
		successAfterRetry,
		exhausted,
		thrown,
		ruleHistogram,
		retryUnitHistogram,
		avgAttemptsToSuccess:
			successes > 0 ? attemptsToSuccessSum / successes : NaN,
		totalCostUsd,
	};
}

function formatHistogram(h: Record<string, number>): string {
	const entries = Object.entries(h).sort((a, b) => b[1] - a[1]);
	if (entries.length === 0) return "  (none)";
	return entries.map(([k, v]) => `  ${k}: ${v}`).join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

function summariseAttempt(a: AttemptRecord): string {
	if (a.outcome === "validation-failed" && a.validationErrors) {
		const ruleSummary = a.validationErrors
			.slice(0, 5)
			.map((v) => `${v.retryUnitKind}/${v.rule}/${v.entityId}/${v.field}`)
			.join(", ");
		return `attempt ${a.attempt}: validation-failed × ${a.validationErrors.length} (${ruleSummary}${a.validationErrors.length > 5 ? ", …" : ""})`;
	}
	if (a.outcome === "hard-error") {
		return `attempt ${a.attempt}: hard-error — ${a.errorMessage}`;
	}
	return `attempt ${a.attempt}: ok`;
}

function logIterationResult(result: IterationResult, elapsedSec: string): void {
	const summary =
		result.finalOutcome === "ok"
			? `ok in ${result.attempts.length} attempt(s)`
			: result.finalOutcome === "exhausted"
				? `EXHAUSTED — failed all ${result.attempts.length}`
				: `THROWN — ${result.finalError}`;
	console.log(
		`iter ${result.iter}: ${summary} (${elapsedSec}s, cost $${(result.totalCostUsd ?? 0).toFixed(4)})`,
	);
	if (result.finalOutcome !== "ok") {
		for (const a of result.attempts) console.log(`  ${summariseAttempt(a)}`);
	}
}

async function runIterationLogged(iter: number): Promise<IterationResult> {
	const startMs = Date.now();
	try {
		const result = await runIteration(iter);
		const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
		logIterationResult(result, elapsed);
		return result;
	} catch (err) {
		const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
		const message = err instanceof Error ? err.message : String(err);
		console.log(`iter ${iter}: UNCAUGHT ${message} (${elapsed}s)`);
		return {
			iter,
			settingA: "",
			settingB: "",
			theme: "",
			objectiveTypes: [],
			finalOutcome: "thrown",
			finalError: message,
			attempts: [],
		};
	}
}

async function main(): Promise<void> {
	console.log(
		`Running ${ITERATIONS} iteration(s) against ${MODEL} (OUTER_BUDGET=${OUTER_BUDGET}, PARALLEL=${PARALLEL})`,
	);
	const results: IterationResult[] = [];

	// Pool: at most PARALLEL iterations in flight at once.
	const queue = Array.from({ length: ITERATIONS }, (_, i) => i + 1);
	const workers = Array.from(
		{ length: Math.min(PARALLEL, ITERATIONS) },
		async () => {
			while (true) {
				const next = queue.shift();
				if (next === undefined) return;
				const r = await runIterationLogged(next);
				results.push(r);
			}
		},
	);
	await Promise.all(workers);
	results.sort((a, b) => a.iter - b.iter);

	const t = tally(results);
	console.log("\n=== summary ===");
	console.log(`iterations: ${ITERATIONS}`);
	console.log(`success on first attempt:  ${t.successOnFirst}`);
	console.log(`success after retry:       ${t.successAfterRetry}`);
	console.log(`exhausted retry budget:    ${t.exhausted}`);
	console.log(`thrown (network/parse):    ${t.thrown}`);
	console.log(
		`avg attempts to success:   ${Number.isNaN(t.avgAttemptsToSuccess) ? "n/a" : t.avgAttemptsToSuccess.toFixed(2)}`,
	);
	console.log(`total cost (USD):          $${t.totalCostUsd.toFixed(4)}`);
	console.log("\nvalidation errors by rule:");
	console.log(formatHistogram(t.ruleHistogram));
	console.log("\nvalidation errors by retryUnit:");
	console.log(formatHistogram(t.retryUnitHistogram));

	// Write artifacts
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const outDir = path.resolve(
		__dirname,
		"../../docs/evals/content-pack-flakiness",
	);
	fs.mkdirSync(outDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const jsonPath = path.join(outDir, `${stamp}.json`);
	fs.writeFileSync(
		jsonPath,
		JSON.stringify({ summary: t, iterations: results }, null, 2),
	);
	console.log(`\nwrote: ${jsonPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
