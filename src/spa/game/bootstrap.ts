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

import { generateContentPacks } from "../../content/content-pack-generator.js";
import {
	generatePersonas,
	PHASE_1_CONFIG,
	PHASE_2_CONFIG,
	PHASE_3_CONFIG,
	SETTING_POOL,
} from "../../content/index.js";
import type { ContentPackProvider } from "./content-pack-provider.js";
import { BrowserContentPackProvider } from "./content-pack-provider.js";
import { GameSession } from "./game-session.js";
import type { LlmSynthesisProvider } from "./llm-synthesis-provider.js";
import { BrowserSynthesisProvider } from "./llm-synthesis-provider.js";
import type { AiId, AiPersona, ContentPack } from "./types.js";

export interface NewGameAssets {
	personas: Record<AiId, AiPersona>;
	contentPacks: ContentPack[];
}

export interface SplitNewGameAssets {
	personasPromise: Promise<Record<AiId, AiPersona>>;
	contentPacksPromise: Promise<ContentPack[]>;
}

export interface BootstrapOpts {
	synthesis?: LlmSynthesisProvider;
	packProvider?: ContentPackProvider;
	rng?: () => number;
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
	const rng = opts?.rng ?? Math.random;
	const synth = opts?.synthesis ?? new BrowserSynthesisProvider();
	const packLLM = opts?.packProvider ?? new BrowserContentPackProvider();

	const personasPromise = generatePersonas(rng, synth) as Promise<
		Record<AiId, AiPersona>
	>;
	// Silence unhandled-rejection on derived promises if a downstream consumer
	// chooses not to await one of them.
	personasPromise.catch(() => {});
	const aiIdsPromise = personasPromise.then((p) => Object.keys(p));
	aiIdsPromise.catch(() => {});

	const contentPacksPromise = generateContentPacks(
		rng,
		SETTING_POOL,
		[PHASE_1_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG],
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
	const [personas, contentPacks] = await Promise.all([
		personasPromise,
		contentPacksPromise,
	]);
	return { personas, contentPacks };
}

/**
 * Construct a GameSession from pre-generated assets.
 *
 * opts.rng is unused at construction time (GameSession uses Math.random
 * internally), but is provided for API symmetry and future use.
 */
export function buildSessionFromAssets(
	assets: NewGameAssets,
	_opts?: { rng?: () => number },
): GameSession {
	return new GameSession(PHASE_1_CONFIG, assets.personas, assets.contentPacks);
}
