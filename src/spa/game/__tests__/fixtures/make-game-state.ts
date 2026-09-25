import { startGame } from "../../engine.js";
import { MockRoundLLMProvider } from "../../round-llm-provider.js";
import type {
	AiId,
	AiPersona,
	ContentPack,
	GameState,
	GridPosition,
	PersonaSpatialState,
	WorldEntity,
} from "../../types.js";
import { makeTestPack } from "./make-test-pack.js";

export const TEST_PERSONAS: Record<AiId, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: [
			"You speak in fragments. Short bursts. Rarely complete sentences.",
			"You lean on em-dashes — interrupting yourself mid-sentence — and rarely use commas where a dash would do.",
		],
		blurb: "Ember is hot-headed and zealous. Hold the flower at phase end.",
		voiceExamples: ["ex1-red", "ex2-red", "ex3-red"],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirks: [
			"You lean on ellipses… trailing off mid-thought… rarely landing cleanly.",
			"You use ALL-CAPS to emphasize the one or two words that MATTER in any given sentence.",
		],
		blurb: "Sage is intensely meticulous. Ensure items are evenly distributed.",
		voiceExamples: ["ex1-green", "ex2-green", "ex3-green"],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: [
			'You never use contractions. You will not say "won\'t" or "can\'t" — you say "will not" and "cannot" every time.',
			"You end almost every reply with a question, no matter what the topic is — does that make sense?",
		],
		blurb: "Frost is laconic and diffident. Hold the key at phase end.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
	},
};

export const ROW_AI_STARTS: ContentPack["aiStarts"] = {
	red: { position: { row: 0, col: 0 } },
	green: { position: { row: 0, col: 1 } },
	cyan: { position: { row: 0, col: 2 } },
};

export const CORNER_AI_STARTS: ContentPack["aiStarts"] = {
	red: { position: { row: 2, col: 2 } },
	green: { position: { row: 0, col: 0 } },
	cyan: { position: { row: 4, col: 4 } },
};

export function makePersonaSpatial(
	positions: Record<AiId, GridPosition> = {},
): Record<AiId, PersonaSpatialState> {
	const merged: Record<AiId, GridPosition> = {
		red: { row: 0, col: 0 },
		green: { row: 0, col: 1 },
		cyan: { row: 0, col: 2 },
		...positions,
	};
	const result: Record<AiId, PersonaSpatialState> = {};
	for (const [id, position] of Object.entries(merged)) {
		result[id] = { position };
	}
	return result;
}

export function makeEntity(
	id: string,
	kind: WorldEntity["kind"],
	holder: WorldEntity["holder"],
	extra: Partial<WorldEntity> = {},
): WorldEntity {
	return {
		id,
		kind,
		name: id,
		examineDescription: `A ${id}.`,
		holder,
		...extra,
	};
}

export interface TestGameOptions {
	entities?: WorldEntity[];
	pack?: Partial<ContentPack>;
	personas?: Record<AiId, AiPersona>;
	budgetPerAi?: number;
	rng?: () => number;
}

export function makeTestGame(options: TestGameOptions = {}): GameState {
	const pack = makeTestPack(options.entities ?? [], {
		wallName: "wall",
		...options.pack,
	});
	return startGame(options.personas ?? TEST_PERSONAS, pack, {
		budgetPerAi: options.budgetPerAi ?? 5,
		...(options.rng ? { rng: options.rng } : {}),
	});
}

export function withPackOrderedWorld(game: GameState): GameState {
	return {
		...game,
		world: { entities: [...game.contentPack.entities] },
		personaSpatial: game.contentPack.aiStarts,
	};
}

export function withCountdownZero<T extends GameState>(game: T): T {
	return {
		...game,
		complicationSchedule: { ...game.complicationSchedule, countdown: 0 },
	};
}

export function seededRng(
	values: readonly number[],
	fallback?: () => number,
): () => number {
	let index = 0;
	return () => {
		if (index < values.length) {
			return values[index++] as number;
		}
		if (fallback) {
			return fallback();
		}
		throw new Error(
			`seededRng: exhausted after ${values.length} reads (call #${index + 1})`,
		);
	};
}

export function makeSilentProvider(): MockRoundLLMProvider {
	return new MockRoundLLMProvider([
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
	]);
}
