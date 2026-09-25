import { generateDualContentPacks } from "../../content/content-pack-generator.js";
import {
	generatePersonas,
	SETTING_POOL,
	SINGLE_GAME_CONFIG,
} from "../../content/index.js";
import type { ContentPackProvider } from "./content-pack-provider.js";
import { BrowserContentPackProvider } from "./content-pack-provider.js";
import { GameSession } from "./game-session.js";
import type { LlmSynthesisProvider } from "./llm-synthesis-provider.js";
import { BrowserSynthesisProvider } from "./llm-synthesis-provider.js";
import type { AiId, AiPersona, ContentPack, ObjectiveType } from "./types.js";

export interface NewGameAssets {
	personas: Record<AiId, AiPersona>;
	contentPacksA: ContentPack[];
	contentPacksB: ContentPack[];
	objectiveTypes?: ObjectiveType[];
}

export interface SplitNewGameAssets {
	personasPromise: Promise<Record<AiId, AiPersona>>;
	contentPacksPromise: Promise<{
		packsA: ContentPack[];
		packsB: ContentPack[];
		objectiveTypes: ObjectiveType[];
	}>;
}

export interface BootstrapOpts {
	synthesis?: LlmSynthesisProvider;
	packProvider?: ContentPackProvider;
	rng?: () => number;
	personasRng?: () => number;
	contentPackRng?: () => number;
	engagementClauses?: boolean;
	actionProfiles?: boolean;
}

export type { ContentPackProvider, LlmSynthesisProvider as SynthesisProvider };

function suppressUnhandledRejection(promise: Promise<unknown>): void {
	promise.catch(() => {});
}

export function generateNewGameAssetsSplit(
	opts?: BootstrapOpts,
): SplitNewGameAssets {
	const fallbackRng = opts?.rng ?? Math.random;
	const personasRng = opts?.personasRng ?? fallbackRng;
	const contentPackRng = opts?.contentPackRng ?? fallbackRng;
	const synth = opts?.synthesis ?? new BrowserSynthesisProvider();
	const packLLM = opts?.packProvider ?? new BrowserContentPackProvider();

	const personasPromise = generatePersonas(personasRng, synth, {
		engagementClauses: opts?.engagementClauses ?? false,
		actionProfiles: opts?.actionProfiles ?? true,
	}) as Promise<Record<AiId, AiPersona>>;
	suppressUnhandledRejection(personasPromise);
	const aiIdsPromise = personasPromise.then((p) => Object.keys(p));
	suppressUnhandledRejection(aiIdsPromise);

	const contentPacksPromise = (async () => {
		const { packA, packB, objectiveTypes } = await generateDualContentPacks(
			contentPackRng,
			SETTING_POOL,
			{
				kRange: SINGLE_GAME_CONFIG.kRange,
				nRange: SINGLE_GAME_CONFIG.nRange,
				mRange: SINGLE_GAME_CONFIG.mRange,
				budgetPerAi: SINGLE_GAME_CONFIG.budgetPerAi,
				aiGoalPool: [] as string[],
			},
			packLLM,
			aiIdsPromise,
		);
		return { packsA: [packA], packsB: [packB], objectiveTypes };
	})();
	suppressUnhandledRejection(contentPacksPromise);

	return { personasPromise, contentPacksPromise };
}

export function generateContentPacksOnlySplit(
	personas: Record<AiId, AiPersona>,
	opts?: BootstrapOpts,
): SplitNewGameAssets {
	const contentPackRng = opts?.contentPackRng ?? opts?.rng ?? Math.random;
	const packLLM = opts?.packProvider ?? new BrowserContentPackProvider();
	const aiIds = Object.keys(personas);

	const personasPromise = Promise.resolve(personas);
	suppressUnhandledRejection(personasPromise);

	const contentPacksPromise = (async () => {
		const { packA, packB, objectiveTypes } = await generateDualContentPacks(
			contentPackRng,
			SETTING_POOL,
			{
				kRange: SINGLE_GAME_CONFIG.kRange,
				nRange: SINGLE_GAME_CONFIG.nRange,
				mRange: SINGLE_GAME_CONFIG.mRange,
				budgetPerAi: SINGLE_GAME_CONFIG.budgetPerAi,
				aiGoalPool: [] as string[],
			},
			packLLM,
			Promise.resolve(aiIds),
		);
		return { packsA: [packA], packsB: [packB], objectiveTypes };
	})();
	suppressUnhandledRejection(contentPacksPromise);

	return { personasPromise, contentPacksPromise };
}

export async function buildSameDaemonsSession(
	personas: Record<AiId, AiPersona>,
	opts?: { rng?: () => number },
): Promise<GameSession> {
	const rng = opts?.rng ?? Math.random;
	const packLLM = new BrowserContentPackProvider();
	const { packA, packB, objectiveTypes } = await generateDualContentPacks(
		rng,
		SETTING_POOL,
		{
			kRange: SINGLE_GAME_CONFIG.kRange,
			nRange: SINGLE_GAME_CONFIG.nRange,
			mRange: SINGLE_GAME_CONFIG.mRange,
			budgetPerAi: SINGLE_GAME_CONFIG.budgetPerAi,
			aiGoalPool: [] as string[],
		},
		packLLM,
		Object.keys(personas),
	);
	return buildSessionFromAssets(
		{
			personas,
			contentPacksA: [packA],
			contentPacksB: [packB],
			objectiveTypes,
		},
		opts,
	);
}

export function buildSessionFromAssets(
	assets: NewGameAssets,
	opts?: { rng?: () => number },
): GameSession {
	return new GameSession(
		assets.contentPacksA[0] ??
			assets.contentPacksB[0] ?? {
				setting: "",
				weather: "",
				timeOfDay: "",
				entities: [],
				wallName: "",
				aiStarts: {},
			},
		assets.personas,
		assets.contentPacksA,
		assets.contentPacksB,
		opts?.rng,
		assets.objectiveTypes,
	);
}
