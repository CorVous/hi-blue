/**
 * pending-bootstrap.ts
 *
 * In-memory holder for an in-flight asset generation bootstrap that needs to
 * outlive the start → game route transition. Personas resolve quickly,
 * content packs slowly; the game route observes both stages to drive its
 * loading UI.
 *
 * NEVER persisted to localStorage — a session can't be built (or saved) until
 * content packs land. Cleared once the session is built and saved, or on
 * failure.
 */

import {
	type BootstrapOpts,
	generateNewGameAssetsSplit,
	type SplitNewGameAssets,
} from "./bootstrap.js";
import type { AiId, AiPersona, ContentPack } from "./types.js";

export type PendingBootstrapStatus =
	| "pending"
	| "personas-ready"
	| "ready"
	| "failed";

export interface PendingBootstrap {
	personasPromise: Promise<Record<AiId, AiPersona>>;
	contentPacksPromise: Promise<{
		packsA: ContentPack[];
		packsB: ContentPack[];
	}>;
	status: PendingBootstrapStatus;
	error?: unknown;
}

let _current: PendingBootstrap | undefined;

/**
 * Kick off (or reuse) a bootstrap and stash it in module scope so the game
 * route can observe its progress. Idempotent: subsequent calls return the
 * existing in-flight bootstrap unless the previous one failed.
 */
export function startBootstrap(opts?: BootstrapOpts): PendingBootstrap {
	if (_current && _current.status !== "failed") return _current;

	const split: SplitNewGameAssets = generateNewGameAssetsSplit(opts);
	const entry: PendingBootstrap = {
		personasPromise: split.personasPromise,
		contentPacksPromise: split.contentPacksPromise,
		status: "pending",
	};

	split.personasPromise.then(
		() => {
			if (entry.status === "pending") entry.status = "personas-ready";
		},
		(err: unknown) => {
			entry.status = "failed";
			entry.error = err;
		},
	);
	split.contentPacksPromise.then(
		() => {
			entry.status = "ready";
		},
		(err: unknown) => {
			entry.status = "failed";
			entry.error = err;
		},
	);

	_current = entry;
	return entry;
}

/**
 * Return the current in-flight bootstrap, or undefined if none is pending.
 *
 * The game route uses this on entry to decide whether to render the
 * progressive-loading UI vs. the normal restore path.
 */
export function getPendingBootstrap(): PendingBootstrap | undefined {
	return _current;
}

/**
 * Clear the pending bootstrap. Called once the game route has built the
 * session from the resolved assets and persisted it to localStorage —
 * subsequent route entries will use the normal restore path.
 */
export function clearPendingBootstrap(): void {
	_current = undefined;
}
