/**
 * bootstrap.ts
 *
 * Generation glue for new-game asset creation, extracted from routes/game.ts.
 *
 * Owns the async bootstrap path: generatePersonas + generateContentPacks.
 * Does NOT write to localStorage (that remains the start-screen's responsibility
 * — triggered only on BEGIN click).
 *
 * Issue #173 (parent #155).
 */

import {
	generateDualContentPacks,
	type PhaseConfig,
} from "../../content/content-pack-generator.js";
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
import type { AiId, AiPersona, ContentPack } from "./types.js";

export interface NewGameAssets {
	personas: Record<AiId, AiPersona>;
	contentPacksA: ContentPack[];
	contentPacksB: ContentPack[];
}

export interface SplitNewGameAssets {
	personasPromise: Promise<Record<AiId, AiPersona>>;
	contentPacksPromise: Promise<{
		packsA: ContentPack[];
		packsB: ContentPack[];
	}>;
}

export interface BootstrapOpts {
	synthesis?: LlmSynthesisProvider;
	packProvider?: ContentPackProvider;
	rng?: () => number;
	/**
	 * Spike #239: separate Mulberry32 streams for persona vs. content-pack
	 * generation. When set, takes precedence over `rng`. Independent streams
	 * make rng consumption deterministic across runs even though the two
	 * generators run as concurrent sibling promises.
	 */
	personasRng?: () => number;
	contentPackRng?: () => number;
	/**
	 * Spike #239 step 8: opt-in per-persona engagement clauses appended to
	 * each daemon's synthesized blurb based on its temperament pair. Set by
	 * the start screen when `?engagementClauses=1` is in the URL. Default
	 * (undefined / false) leaves persona blurbs unchanged.
	 */
	engagementClauses?: boolean;
}

// Re-export provider types for use in start.ts without creating circular deps
export type { ContentPackProvider, LlmSynthesisProvider as SynthesisProvider };

function buildLegacyPhaseConfigs(): [PhaseConfig, PhaseConfig, PhaseConfig] {
	const base = {
		kRange: SINGLE_GAME_CONFIG.kRange,
		nRange: SINGLE_GAME_CONFIG.nRange,
		mRange: SINGLE_GAME_CONFIG.mRange,
		budgetPerAi: SINGLE_GAME_CONFIG.budgetPerAi,
		aiGoalPool: [] as string[],
	};
	return [
		{ phaseNumber: 1 as const, ...base },
		{ phaseNumber: 2 as const, ...base },
		{ phaseNumber: 3 as const, ...base },
	];
}

/**
 * Kick off persona + content-pack generation and expose them as separate
 * promises. Personas resolve seconds before content packs, which lets the
 * UI react to each stage independently (drive a multi-phase loading screen).
 */
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
	}) as Promise<Record<AiId, AiPersona>>;
	// Silence unhandled-rejection on derived promises if a downstream consumer
	// chooses not to await one of them.
	personasPromise.catch(() => {});
	const aiIdsPromise = personasPromise.then((p) => Object.keys(p));
	aiIdsPromise.catch(() => {});

	const contentPacksPromise = generateDualContentPacks(
		contentPackRng,
		SETTING_POOL,
		buildLegacyPhaseConfigs(),
		packLLM,
		aiIdsPromise,
	);
	contentPacksPromise.catch(() => {});

	return { personasPromise, contentPacksPromise };
}

/**
 * Run the full async generation pipeline and return the resulting personas
 * and content packs as a single resolved bundle.
 *
 * Thin wrapper around `generateNewGameAssetsSplit` for callers (mostly tests)
 * that don't care about the per-stage timing. Does NOT create a GameSession
 * or touch localStorage.
 */
export async function generateNewGameAssets(
	opts?: BootstrapOpts,
): Promise<NewGameAssets> {
	const { personasPromise, contentPacksPromise } =
		generateNewGameAssetsSplit(opts);
	const [personas, { packsA, packsB }] = await Promise.all([
		personasPromise,
		contentPacksPromise,
	]);
	return { personas, contentPacksA: packsA, contentPacksB: packsB };
}

/**
 * Build a new GameSession reusing existing personas but generating fresh
 * content packs. Used by the end-game "Same Daemons, New Room" and
 * "Continue" choices (issue #307).
 */
export async function buildSameDaemonsSession(
	personas: Record<AiId, AiPersona>,
	opts?: { rng?: () => number },
): Promise<GameSession> {
	const rng = opts?.rng ?? Math.random;
	const packLLM = new BrowserContentPackProvider();
	const { packsA, packsB } = await generateDualContentPacks(
		rng,
		SETTING_POOL,
		buildLegacyPhaseConfigs(),
		packLLM,
		Object.keys(personas),
	);
	return buildSessionFromAssets(
		{ personas, contentPacksA: packsA, contentPacksB: packsB },
		opts,
	);
}

/**
 * Construct a GameSession from pre-generated assets.
 *
 * `opts.rng`, when provided, is forwarded to the GameSession constructor
 * and ultimately drives initial spatial placement via `startGame`. When
 * undefined the constructor falls back to `Math.random` as before.
 * Spike #239 passes a Mulberry32 stream here so a `?seed=N` run pins
 * spatial layout across A/B sessions.
 */
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
				objectivePairs: [],
				interestingObjects: [],
				obstacles: [],
				landmarks: {
					north: { shortName: "", horizonPhrase: "" },
					south: { shortName: "", horizonPhrase: "" },
					east: { shortName: "", horizonPhrase: "" },
					west: { shortName: "", horizonPhrase: "" },
				},
				aiStarts: {},
			},
		assets.personas,
		assets.contentPacksA,
		assets.contentPacksB,
		opts?.rng,
	);
}
