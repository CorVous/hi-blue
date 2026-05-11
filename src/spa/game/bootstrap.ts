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

import { generateContentPack } from "../../content/content-pack-generator.js";
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
	contentPack: ContentPack;
	/** @deprecated use contentPack */
	contentPacks: ContentPack[];
}

export interface SplitNewGameAssets {
	personasPromise: Promise<Record<AiId, AiPersona>>;
	contentPackPromise: Promise<ContentPack>;
	/** @deprecated use contentPackPromise */
	contentPacksPromise: Promise<ContentPack[]>;
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

	const contentPackPromise = generateContentPack(
		contentPackRng,
		SETTING_POOL,
		SINGLE_GAME_CONFIG,
		packLLM,
		aiIdsPromise,
	);
	contentPackPromise.catch(() => {});

	// Backward-compat shim: wrap single pack in an array
	const contentPacksPromise = contentPackPromise.then((p) => [p]);
	contentPacksPromise.catch(() => {});

	return { personasPromise, contentPackPromise, contentPacksPromise };
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
	const { personasPromise, contentPackPromise } =
		generateNewGameAssetsSplit(opts);
	const [personas, contentPack] = await Promise.all([
		personasPromise,
		contentPackPromise,
	]);
	return { personas, contentPack, contentPacks: [contentPack] };
}

/**
 * Construct a GameSession from pre-generated assets.
 *
 * `opts.rng`, when provided, is forwarded to the GameSession constructor
 * and ultimately drives initial spatial placement via `startPhase`. When
 * undefined the constructor falls back to `Math.random` as before.
 * Spike #239 passes a Mulberry32 stream here so a `?seed=N` run pins
 * spatial layout across A/B sessions.
 */
export function buildSessionFromAssets(
	assets: NewGameAssets,
	opts?: { rng?: () => number },
): GameSession {
	return new GameSession(
		assets.contentPack,
		assets.personas,
		undefined,
		opts?.rng,
	);
}
