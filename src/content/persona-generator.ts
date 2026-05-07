import { COLOR_PALETTE } from "./color-palette.js";
import { PERSONA_GOAL_POOL } from "./persona-goal-pool.js";
import { TEMPERAMENT_POOL } from "./temperament-pool.js";

const NAME_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const NAME_LENGTH = 4;
const PERSONA_COUNT = 3;

export function generatePersonaName(
	rng: () => number,
	taken: ReadonlySet<string>,
): string {
	// Bounded retry guard: if the rng is degenerate (e.g. a stubbed constant)
	// the same draw will keep colliding. After MAX_RETRIES we deterministically
	// perturb subsequent characters so the loop terminates.
	const MAX_RETRIES = 64;
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		let name = "";
		for (let i = 0; i < NAME_LENGTH; i++) {
			name += NAME_CHARS[Math.floor(rng() * NAME_CHARS.length)];
		}
		if (!taken.has(name)) return name;
	}
	// Fallback: iterate through NAME_CHARS deterministically
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

export function buildBlurb(
	temperaments: [string, string],
	personaGoal: string,
): string {
	const [t1, t2] = temperaments;
	const temperamentSentence =
		t1 === t2 ? `You are intensely ${t1}.` : `You are ${t1} and ${t2}.`;
	return `${temperamentSentence} ${personaGoal}`;
}

function drawWithReplacement<T>(pool: T[], rng: () => number): T {
	// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
	return pool[Math.floor(rng() * pool.length)]!;
}

export function generatePersonas(
	rng: () => number = Math.random,
): Record<string, import("../spa/game/types.js").AiPersona> {
	const takenNames = new Set<string>();
	const names: string[] = [];
	for (let i = 0; i < PERSONA_COUNT; i++) {
		const name = generatePersonaName(rng, takenNames);
		takenNames.add(name);
		names.push(name);
	}

	// Draw PERSONA_COUNT distinct colors without replacement via Fisher-Yates
	const shuffled = [...COLOR_PALETTE];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = shuffled[i] as string;
		shuffled[i] = shuffled[j] as string;
		shuffled[j] = tmp;
	}
	const colors = shuffled.slice(0, PERSONA_COUNT) as [string, string, string];

	const personas: Record<string, import("../spa/game/types.js").AiPersona> = {};
	for (let i = 0; i < PERSONA_COUNT; i++) {
		const name = names[i] as string;
		const color = colors[i] as string;
		const temperaments: [string, string] = [
			drawWithReplacement(TEMPERAMENT_POOL, rng),
			drawWithReplacement(TEMPERAMENT_POOL, rng),
		];
		const personaGoal = drawWithReplacement(PERSONA_GOAL_POOL, rng);
		const blurb = buildBlurb(temperaments, personaGoal);
		personas[name] = {
			id: name,
			name,
			color,
			temperaments,
			personaGoal,
			blurb,
			budgetPerPhase: 5,
		};
	}
	return personas;
}
