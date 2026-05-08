/**
 * llm-synthesis-provider.ts
 *
 * LlmSynthesisProvider interface + BrowserSynthesisProvider (real) +
 * MockSynthesisProvider (tests).
 *
 * The browser provider makes one non-streaming JSON-mode chat-completions call
 * to synthesize three persona blurbs from (temperaments, personaGoal) tuples.
 * On transient failure it retries once. CapHitError surfaces immediately.
 */

import { CapHitError, chatCompletionJson } from "../llm-client.js";

// ── Synthesis prompt ──────────────────────────────────────────────────────────

export const SYNTHESIS_SYSTEM_PROMPT = `You MUST always respond in English. You MUST reason in English.
You write AI personality blurbs for a text-based game. Given a list of personas, each with two temperaments and a persona goal, produce one blurb per persona.

Each blurb MUST:
- Be 80–120 words long.
- Be written in second person ("You are…").
- Weave in the persona goal as a held value, not stated as an explicit goal.

Each blurb MUST NEVER mention: the character's name, their color, a room, the words "AI", "assistant", or any in-game meta concept.

When the two temperaments are different, you MUST frame their contradiction as productive tension — not a paradox to resolve.
When the two temperaments are identical, you MUST intensify rather than repeat — treat it as an extreme, defining trait.

You MUST return ONLY valid JSON with this exact shape (no markdown, no preamble):
{"personas": [{"id": "<input id>", "blurb": "<text>"}, ...]}\n\nYou MUST echo the input id field verbatim. The array MUST contain exactly one entry per input persona, in any order.`;

export function buildSynthesisUserMessage(
	input: Array<{
		id: string;
		temperaments: [string, string];
		personaGoal: string;
	}>,
): string {
	const items = input.map(
		(p) =>
			`id: ${JSON.stringify(p.id)}, temperaments: [${JSON.stringify(p.temperaments[0])}, ${JSON.stringify(p.temperaments[1])}], personaGoal: ${JSON.stringify(p.personaGoal)}`,
	);
	return `Synthesize blurbs for these personas:\n${items.join("\n")}`;
}

// ── Error type ────────────────────────────────────────────────────────────────

export class SynthesisError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SynthesisError";
	}
}

// ── Interface ─────────────────────────────────────────────────────────────────

export interface SynthesisInput {
	id: string;
	temperaments: [string, string];
	personaGoal: string;
}

export interface SynthesisResult {
	personas: Array<{ id: string; blurb: string }>;
}

export interface LlmSynthesisProvider {
	synthesizePersonas(input: SynthesisInput[]): Promise<SynthesisResult>;
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateResult(raw: unknown, inputIds: string[]): SynthesisResult {
	if (raw == null || typeof raw !== "object") {
		throw new SynthesisError("synthesis response is not an object");
	}
	const obj = raw as Record<string, unknown>;
	if (!Array.isArray(obj.personas)) {
		throw new SynthesisError("synthesis response missing personas array");
	}
	const personas = obj.personas as unknown[];
	if (personas.length !== inputIds.length) {
		throw new SynthesisError(
			`synthesis response has ${personas.length} personas but expected ${inputIds.length}`,
		);
	}
	const seen = new Set<string>();
	const result: Array<{ id: string; blurb: string }> = [];
	for (const p of personas) {
		if (p == null || typeof p !== "object") {
			throw new SynthesisError("synthesis persona entry is not an object");
		}
		const entry = p as Record<string, unknown>;
		if (typeof entry.id !== "string" || typeof entry.blurb !== "string") {
			throw new SynthesisError(
				"synthesis persona entry missing string id or blurb",
			);
		}
		if (!inputIds.includes(entry.id)) {
			throw new SynthesisError(
				`synthesis response contains unexpected id: ${entry.id}`,
			);
		}
		seen.add(entry.id);
		result.push({ id: entry.id, blurb: entry.blurb });
	}
	for (const id of inputIds) {
		if (!seen.has(id)) {
			throw new SynthesisError(`synthesis response missing id: ${id}`);
		}
	}
	return { personas: result };
}

// ── BrowserSynthesisProvider ──────────────────────────────────────────────────

export class BrowserSynthesisProvider implements LlmSynthesisProvider {
	private readonly disableReasoning: boolean;

	constructor(opts: { disableReasoning?: boolean } = {}) {
		this.disableReasoning = opts.disableReasoning ?? false;
	}

	async synthesizePersonas(input: SynthesisInput[]): Promise<SynthesisResult> {
		const inputIds = input.map((p) => p.id);
		const messages = [
			{ role: "system" as const, content: SYNTHESIS_SYSTEM_PROMPT },
			{ role: "user" as const, content: buildSynthesisUserMessage(input) },
		];

		const attempt = async (): Promise<SynthesisResult> => {
			const { content, reasoning } = await chatCompletionJson({
				messages,
				disableReasoning: this.disableReasoning,
			});

			const raw = content !== null && content !== "" ? content : reasoning;
			if (raw === null || raw === "") {
				throw new SynthesisError(
					"synthesis response has neither content nor reasoning",
				);
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				throw new SynthesisError(`synthesis JSON parse failed: ${raw}`);
			}

			return validateResult(parsed, inputIds);
		};

		try {
			return await attempt();
		} catch (err) {
			// CapHitError is not retried — surface immediately
			if (err instanceof CapHitError) throw err;
			// Retry once on any other failure
			return await attempt();
		}
	}
}

// ── MockSynthesisProvider ─────────────────────────────────────────────────────

export class MockSynthesisProvider implements LlmSynthesisProvider {
	readonly calls: SynthesisInput[][] = [];
	private readonly fn: (input: SynthesisInput[]) => SynthesisResult;

	constructor(fn: (input: SynthesisInput[]) => SynthesisResult) {
		this.fn = fn;
	}

	async synthesizePersonas(input: SynthesisInput[]): Promise<SynthesisResult> {
		this.calls.push(input);
		return this.fn(input);
	}
}
