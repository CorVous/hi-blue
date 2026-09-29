import { chatCompletionJson, isRetryPointless } from "../llm-client.js";
import {
	parseJsonCompletion,
	retryDelayMs,
	sleepUnlessAborted,
} from "./json-completion.js";

export const SYNTHESIS_SYSTEM_PROMPT = `You MUST always respond in English. You MUST reason in English.
You write AI personality blurbs and voice examples for a text-based game. Given a list of personas, each with two temperaments and a persona goal, produce one blurb and exactly 3 voiceExamples per persona.

Each blurb MUST:
- Be 80–120 words long.
- Be written in third person about the persona, using their name (the input \`id\` field) as the subject — e.g. "<id> is …".
- Weave in the persona goal as a held value, not stated as an explicit goal.

Each blurb MUST NEVER mention: their color, a room, the words "AI", "assistant", or any in-game meta concept.

When the two temperaments are different, you MUST frame their contradiction as productive tension — not a paradox to resolve.
When the two temperaments are identical, you MUST intensify rather than repeat — treat it as an extreme, defining trait.

Each persona MUST have exactly 3 voiceExamples entries.
Each voice example MUST be exactly one sentence.
Each voice example MUST NEVER mention: the character's name, their color, a room, the words "AI", "assistant", or any in-game meta concept.
Each voice example MUST NEVER use a first-person pronoun to describe the persona's goal directly (don't say "I want to keep order" — say something the character would actually say in conversation).
Voice examples MUST sound like in-character dialogue lines, not descriptions of the character.
When typing quirks are supplied for a persona, each voice example MUST follow those quirks.

You MUST return ONLY valid JSON with this exact shape (no markdown, no preamble):
{"personas": [{"id": "<input id>", "blurb": "<text>", "voiceExamples": ["<line>", "<line>", "<line>"]}, ...]}\n\nYou MUST echo the input id field verbatim. The array MUST contain exactly one entry per input persona, in any order.`;

export function buildSynthesisUserMessage(
	input: Array<{
		id: string;
		temperaments: [string, string];
		personaGoal: string;
		typingQuirks?: [string, string, ...string[]];
	}>,
): string {
	const items = input.map((p) => {
		let line = `id: ${JSON.stringify(p.id)}, temperaments: [${JSON.stringify(p.temperaments[0])}, ${JSON.stringify(p.temperaments[1])}], personaGoal: ${JSON.stringify(p.personaGoal)}`;
		if (p.typingQuirks) {
			line += `, typingQuirks: [${p.typingQuirks.map((q) => JSON.stringify(q)).join(", ")}]`;
		}
		return line;
	});
	return `Synthesize blurbs for these personas:\n${items.join("\n")}`;
}

export class SynthesisError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SynthesisError";
	}
}

export interface SynthesisInput {
	id: string;
	temperaments: [string, string];
	personaGoal: string;
	typingQuirks?: [string, string, ...string[]];
}

export interface SynthesisResult {
	personas: Array<{ id: string; blurb: string; voiceExamples: string[] }>;
}

export interface LlmSynthesisProvider {
	synthesizePersonas(input: SynthesisInput[]): Promise<SynthesisResult>;
}

const VOICE_EXAMPLES_PER_PERSONA = 3;
const SYNTHESIS_RETRY_BACKOFF_MS = 1_000;

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
	const result: Array<{ id: string; blurb: string; voiceExamples: string[] }> =
		[];
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
		if (entry.blurb.trim().length === 0) {
			throw new SynthesisError(
				`synthesis persona entry ${entry.id} has an empty blurb`,
			);
		}
		if (!inputIds.includes(entry.id)) {
			throw new SynthesisError(
				`synthesis response contains unexpected id: ${entry.id}`,
			);
		}
		if (!Array.isArray(entry.voiceExamples)) {
			throw new SynthesisError(
				"synthesis persona entry missing voiceExamples array",
			);
		}
		if (entry.voiceExamples.length !== VOICE_EXAMPLES_PER_PERSONA) {
			throw new SynthesisError(
				"synthesis persona entry voiceExamples must have length 3",
			);
		}
		for (const ex of entry.voiceExamples as unknown[]) {
			if (typeof ex !== "string" || ex.length === 0) {
				throw new SynthesisError(
					"synthesis persona entry voiceExamples contains non-string or empty entry",
				);
			}
		}
		seen.add(entry.id);
		result.push({
			id: entry.id,
			blurb: entry.blurb,
			voiceExamples: entry.voiceExamples as string[],
		});
	}
	for (const id of inputIds) {
		if (!seen.has(id)) {
			throw new SynthesisError(`synthesis response missing id: ${id}`);
		}
	}
	return { personas: result };
}

export class BrowserSynthesisProvider implements LlmSynthesisProvider {
	private readonly disableReasoning: boolean;
	private readonly chatFn: typeof chatCompletionJson;
	private readonly signal: AbortSignal | undefined;

	constructor(
		opts: {
			disableReasoning?: boolean;
			chatFn?: typeof chatCompletionJson;
			signal?: AbortSignal;
		} = {},
	) {
		this.disableReasoning = opts.disableReasoning ?? false;
		this.chatFn = opts.chatFn ?? chatCompletionJson;
		this.signal = opts.signal;
	}

	async synthesizePersonas(input: SynthesisInput[]): Promise<SynthesisResult> {
		const inputIds = input.map((p) => p.id);
		const messages = [
			{ role: "system" as const, content: SYNTHESIS_SYSTEM_PROMPT },
			{ role: "user" as const, content: buildSynthesisUserMessage(input) },
		];

		const attemptSynthesis = async (): Promise<SynthesisResult> => {
			const result = await this.chatFn({
				messages,
				disableReasoning: this.disableReasoning,
				...(this.signal !== undefined ? { signal: this.signal } : {}),
			});
			const { parsed } = parseJsonCompletion(
				result,
				"synthesis",
				(message) => new SynthesisError(message),
			);
			return validateResult(parsed, inputIds);
		};

		try {
			return await attemptSynthesis();
		} catch (err) {
			if (isRetryPointless(err) || this.signal?.aborted) throw err;
			await sleepUnlessAborted(
				retryDelayMs(err, SYNTHESIS_RETRY_BACKOFF_MS),
				this.signal,
			);
			return await attemptSynthesis();
		}
	}
}

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
