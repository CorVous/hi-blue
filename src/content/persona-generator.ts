import type { LlmSynthesisProvider } from "../spa/game/llm-synthesis-provider.js";
import { actionProfileFor } from "./action-preference-bias.js";
import { COLOR_PALETTE } from "./color-palette.js";
import {
	biasSum,
	bucketFor,
	engagementClauseFor,
} from "./engagement-clauses.js";
import {
	PERSONA_GOAL_POOL,
	TEMPERAMENT_POOL,
	TYPING_QUIRK_POOL,
} from "./pools.js";

const NAME_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const NAME_LENGTH = 4;
const PERSONA_COUNT = 3;
const RANDOM_NAME_ATTEMPTS_BEFORE_ENUMERATING = 64;
const EXTRA_TYPING_QUIRK_DIE_SIDES = 6;

function generatePersonaName(
	rng: () => number,
	taken: ReadonlySet<string>,
): string {
	for (
		let attempt = 0;
		attempt < RANDOM_NAME_ATTEMPTS_BEFORE_ENUMERATING;
		attempt++
	) {
		let name = "";
		for (let i = 0; i < NAME_LENGTH; i++) {
			name += NAME_CHARS[Math.floor(rng() * NAME_CHARS.length)];
		}
		if (!taken.has(name)) return name;
	}
	return firstUnusedNameInOrder(taken);
}

function firstUnusedNameInOrder(taken: ReadonlySet<string>): string {
	for (let a = 0; a < NAME_CHARS.length; a++) {
		for (let b = 0; b < NAME_CHARS.length; b++) {
			for (let c = 0; c < NAME_CHARS.length; c++) {
				for (let d = 0; d < NAME_CHARS.length; d++) {
					const candidate =
						(NAME_CHARS[a] as string) +
						(NAME_CHARS[b] as string) +
						(NAME_CHARS[c] as string) +
						(NAME_CHARS[d] as string);
					if (!taken.has(candidate)) return candidate;
				}
			}
		}
	}
	throw new Error("Exhausted persona-name space");
}

function buildBlurb(
	name: string,
	temperaments: [string, string],
	personaGoal: string,
): string {
	const [t1, t2] = temperaments;
	const temperamentSentence =
		t1 === t2 ? `${name} is intensely ${t1}.` : `${name} is ${t1} and ${t2}.`;
	return `${temperamentSentence} ${personaGoal}`;
}

function buildFallbackVoiceExamples(tuple: {
	temperaments: [string, string];
	personaGoal: string;
}): string[] {
	const [t1, t2] = tuple.temperaments;
	return [
		`Something ${t1} just to set a tone.`,
		`A ${t2} remark in the same breath.`,
		`One more line that sounds the same.`,
	];
}

function rollsTopFace(rng: () => number, sides: number): boolean {
	return Math.floor(rng() * sides) + 1 === sides;
}

function drawWithReplacement<T>(pool: T[], rng: () => number): T {
	// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
	return pool[Math.floor(rng() * pool.length)]!;
}

export async function generatePersonas(
	rng: () => number = Math.random,
	llm?: LlmSynthesisProvider,
	opts?: { engagementClauses?: boolean; actionProfiles?: boolean },
): Promise<Record<string, import("../spa/game/types.js").AiPersona>> {
	const takenNames = new Set<string>();
	const names: string[] = [];
	for (let i = 0; i < PERSONA_COUNT; i++) {
		const name = generatePersonaName(rng, takenNames);
		takenNames.add(name);
		names.push(name);
	}

	const shuffled = [...COLOR_PALETTE];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = shuffled[i] as string;
		shuffled[i] = shuffled[j] as string;
		shuffled[j] = tmp;
	}
	const colors = shuffled.slice(0, PERSONA_COUNT) as [string, string, string];

	const tuples: Array<{
		id: string;
		temperaments: [string, string];
		personaGoal: string;
		typingQuirks: [string, string, ...string[]];
	}> = [];
	for (let i = 0; i < PERSONA_COUNT; i++) {
		const name = names[i] as string;
		const temperaments: [string, string] = [
			drawWithReplacement(TEMPERAMENT_POOL, rng),
			drawWithReplacement(TEMPERAMENT_POOL, rng),
		];
		const personaGoal = drawWithReplacement(PERSONA_GOAL_POOL, rng);
		const typingQuirks: [string, string, ...string[]] = [
			drawWithReplacement(TYPING_QUIRK_POOL, rng),
			drawWithReplacement(TYPING_QUIRK_POOL, rng),
		];
		while (rollsTopFace(rng, EXTRA_TYPING_QUIRK_DIE_SIDES)) {
			typingQuirks.push(drawWithReplacement(TYPING_QUIRK_POOL, rng));
		}
		tuples.push({ id: name, temperaments, personaGoal, typingQuirks });
	}

	let synthesisMap: Map<string, { blurb: string; voiceExamples: string[] }>;
	if (llm) {
		const result = await llm.synthesizePersonas(tuples);
		synthesisMap = new Map(
			result.personas.map((p) => [
				p.id,
				{ blurb: p.blurb, voiceExamples: p.voiceExamples },
			]),
		);
	} else {
		synthesisMap = new Map(
			tuples.map((t) => [
				t.id,
				{
					blurb: buildBlurb(t.id, t.temperaments, t.personaGoal),
					voiceExamples: buildFallbackVoiceExamples(t),
				},
			]),
		);
	}

	const personas: Record<string, import("../spa/game/types.js").AiPersona> = {};
	for (let i = 0; i < PERSONA_COUNT; i++) {
		const tuple = tuples[i] as (typeof tuples)[number];
		const name = tuple.id;
		const color = colors[i] as string;
		const synthesized = synthesisMap.get(name);
		let blurb =
			synthesized?.blurb ??
			buildBlurb(tuple.id, tuple.temperaments, tuple.personaGoal);
		if (opts?.engagementClauses) {
			const [t1, t2] = tuple.temperaments;
			const clause = engagementClauseFor(name, t1, t2);
			blurb = `${blurb} ${clause}`;
			if (typeof console !== "undefined" && console.log) {
				console.log(
					`[engagement] *${name} temperaments=[${t1},${t2}] sum=${biasSum(t1, t2)} bucket=${bucketFor(t1, t2)}`,
				);
			}
		}
		const voiceExamples =
			synthesized?.voiceExamples ?? buildFallbackVoiceExamples(tuple);
		const persona: import("../spa/game/types.js").AiPersona = {
			id: name,
			name,
			color,
			temperaments: tuple.temperaments,
			personaGoal: tuple.personaGoal,
			typingQuirks: tuple.typingQuirks,
			blurb,
			voiceExamples,
		};
		if (opts?.actionProfiles) {
			const [t1, t2] = tuple.temperaments;
			persona.actionProfile = actionProfileFor(name, t1, t2);
		}
		personas[name] = persona;
	}
	return personas;
}
