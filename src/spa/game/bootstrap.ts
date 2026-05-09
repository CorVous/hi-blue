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

// Re-export provider types for use in start.ts without creating circular deps
export type { ContentPackProvider, LlmSynthesisProvider as SynthesisProvider };

/**
 * Run the full async generation pipeline and return the resulting personas
 * and content packs.
 *
 * Default opts use the browser providers and Math.random.
 * Tests can inject deterministic alternatives via opts.
 *
 * Does NOT create a GameSession or touch localStorage.
 */
export async function generateNewGameAssets(opts?: {
	synthesis?: LlmSynthesisProvider;
	packProvider?: ContentPackProvider;
	rng?: () => number;
}): Promise<NewGameAssets> {
	const rng = opts?.rng ?? Math.random;
	const synth = opts?.synthesis ?? new BrowserSynthesisProvider();
	const packLLM = opts?.packProvider ?? new BrowserContentPackProvider();

	const personasPromise = generatePersonas(rng, synth);
	const aiIdsPromise = personasPromise.then((p) => Object.keys(p));
	// Silence derived-promise unhandled rejection when personasPromise rejects
	// but packs path returns before awaiting aiIdsPromise.
	aiIdsPromise.catch(() => {});
	const packsPromise = generateContentPacks(
		rng,
		SETTING_POOL,
		[PHASE_1_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG],
		packLLM,
		aiIdsPromise,
	);

	const [personas, contentPacks] = await Promise.all([
		personasPromise,
		packsPromise,
	]);

	return { personas: personas as Record<AiId, AiPersona>, contentPacks };
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
