import { generateDualContentPacks } from "../../content/content-pack-generator.js";
import { generatePersonas } from "../../content/persona-generator.js";
import { SINGLE_GAME_CONFIG } from "../../content/phases.js";
import { SETTING_POOL } from "../../content/pools.js";
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

export interface GeneratedContentPacks {
	packsA: ContentPack[];
	packsB: ContentPack[];
	objectiveTypes: ObjectiveType[];
}

export interface SplitNewGameAssets {
	personasPromise: Promise<Record<AiId, AiPersona>>;
	contentPacksPromise: Promise<GeneratedContentPacks>;
}

export interface BootstrapOpts {
	synthesis?: LlmSynthesisProvider;
	packProvider?: ContentPackProvider;
	rng?: () => number;
	personasRng?: () => number;
	contentPackRng?: () => number;
	engagementClauses?: boolean;
	actionProfiles?: boolean;
	signal?: AbortSignal;
}

function signalOpt(signal: AbortSignal | undefined): { signal?: AbortSignal } {
	return signal !== undefined ? { signal } : {};
}

async function generateContentPacks(
	rng: () => number,
	packLLM: ContentPackProvider,
	aiIds: AiId[] | Promise<AiId[]>,
): Promise<GeneratedContentPacks> {
	const { packA, packB, objectiveTypes } = await generateDualContentPacks(
		rng,
		SETTING_POOL,
		SINGLE_GAME_CONFIG,
		packLLM,
		aiIds,
	);
	return { packsA: [packA], packsB: [packB], objectiveTypes };
}

function suppressUnhandledRejection(promise: Promise<unknown>): void {
	promise.catch(() => {});
}

export function generateNewGameAssetsSplit(
	opts?: BootstrapOpts,
): SplitNewGameAssets {
	const fallbackRng = opts?.rng ?? Math.random;
	const personasRng = opts?.personasRng ?? fallbackRng;
	const contentPackRng = opts?.contentPackRng ?? fallbackRng;
	const synth =
		opts?.synthesis ?? new BrowserSynthesisProvider(signalOpt(opts?.signal));
	const packLLM =
		opts?.packProvider ??
		new BrowserContentPackProvider(signalOpt(opts?.signal));

	const personasPromise = generatePersonas(personasRng, synth, {
		engagementClauses: opts?.engagementClauses ?? false,
		actionProfiles: opts?.actionProfiles ?? true,
	}) as Promise<Record<AiId, AiPersona>>;
	suppressUnhandledRejection(personasPromise);
	const aiIdsPromise = personasPromise.then((p) => Object.keys(p));
	suppressUnhandledRejection(aiIdsPromise);

	const contentPacksPromise = generateContentPacks(
		contentPackRng,
		packLLM,
		aiIdsPromise,
	);
	suppressUnhandledRejection(contentPacksPromise);

	return { personasPromise, contentPacksPromise };
}

export function generateContentPacksOnlySplit(
	personas: Record<AiId, AiPersona>,
	opts?: { signal?: AbortSignal },
): SplitNewGameAssets {
	const packLLM = new BrowserContentPackProvider(signalOpt(opts?.signal));
	const contentPacksPromise = generateContentPacks(
		Math.random,
		packLLM,
		Promise.resolve(Object.keys(personas)),
	);
	suppressUnhandledRejection(contentPacksPromise);

	return { personasPromise: Promise.resolve(personas), contentPacksPromise };
}

export async function buildSameDaemonsSession(
	personas: Record<AiId, AiPersona>,
	opts?: { rng?: () => number },
): Promise<GameSession> {
	const packs = await generateContentPacks(
		opts?.rng ?? Math.random,
		new BrowserContentPackProvider(),
		Object.keys(personas),
	);
	return buildSessionFromAssets(newGameAssets(personas, packs), opts);
}

export function newGameAssets(
	personas: Record<AiId, AiPersona>,
	{ packsA, packsB, objectiveTypes }: GeneratedContentPacks,
): NewGameAssets {
	return {
		personas,
		contentPacksA: packsA,
		contentPacksB: packsB,
		objectiveTypes,
	};
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
