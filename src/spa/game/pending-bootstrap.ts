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
	generateContentPacksOnlySplit,
	generateNewGameAssetsSplit,
	type SplitNewGameAssets,
} from "./bootstrap.js";
import type { AiId, AiPersona, ContentPack, ObjectiveType } from "./types.js";

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
		objectiveTypes: ObjectiveType[];
	}>;
	status: PendingBootstrapStatus;
	error?: unknown;
	personas?: Record<AiId, AiPersona>;
}

export interface PendingCallMeta {
	callName?: string;
	startedAtMs?: number;
	retryCount?: number;
	retryMax?: number;
	lastError?: string;
}

let _current: PendingBootstrap | undefined;
let _meta: PendingCallMeta = {};

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

	recordPendingCall("persona-synthesis");

	split.personasPromise.then(
		(personas) => {
			entry.personas = personas;
			if (entry.status === "pending") entry.status = "personas-ready";
			recordPendingCall("content-pack");
		},
		(err: unknown) => {
			entry.status = "failed";
			entry.error = err;
			recordPendingRetry(err);
		},
	);
	split.contentPacksPromise.then(
		() => {
			entry.status = "ready";
		},
		(err: unknown) => {
			entry.status = "failed";
			entry.error = err;
			recordPendingRetry(err);
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
 * Return the cached personas from the current pending bootstrap, if available.
 * Personas may exist even when status is "failed" (after personas resolved but
 * content packs failed), allowing recovery without re-generating personas.
 */
export function getCachedPersonas(): Record<AiId, AiPersona> | undefined {
	return _current?.personas;
}

/**
 * Restart content-pack generation with cached personas (if available), reusing
 * the resolved persona pool without re-generating personas.
 *
 * If no cached personas exist, falls back to startBootstrap (full restart).
 */
export function restartContentPacks(opts?: BootstrapOpts): PendingBootstrap {
	const cached = getCachedPersonas();
	if (!cached) {
		return startBootstrap(opts);
	}

	recordPendingCall("content-pack");

	const split = generateContentPacksOnlySplit(cached, opts);
	const entry: PendingBootstrap = {
		personasPromise: split.personasPromise,
		contentPacksPromise: split.contentPacksPromise,
		status: "pending",
		personas: cached,
	};

	split.contentPacksPromise.then(
		() => {
			entry.status = "ready";
		},
		(err: unknown) => {
			entry.status = "failed";
			entry.error = err;
			recordPendingRetry(err);
		},
	);

	_current = entry;
	return entry;
}

/**
 * Clear the pending bootstrap. Called once the game route has built the
 * session from the resolved assets and persisted it to localStorage —
 * subsequent route entries will use the normal restore path.
 */
export function clearPendingBootstrap(): void {
	_current = undefined;
	recordPendingDone();
}

/**
 * Record the start of a pending call (e.g., "persona-synthesis" or "content-pack").
 * Sets the call name, start timestamp, and initializes retry count.
 */
export function recordPendingCall(callName: string): void {
	_meta = {
		callName,
		startedAtMs: Date.now(),
		retryCount: 0,
		retryMax: 3,
	};
}

/**
 * Record a retry attempt on the pending call, with an optional error.
 * Increments retry count and stores the error message if provided.
 */
export function recordPendingRetry(error?: unknown): void {
	const text = error instanceof Error ? error.message : String(error);
	_meta = {
		..._meta,
		retryCount: (_meta.retryCount ?? 0) + 1,
		lastError: text,
	};
}

/**
 * Record successful completion of a pending call. Clears the metadata.
 */
export function recordPendingDone(): void {
	_meta = {};
}

/**
 * Get the current pending call metadata. Returns a shallow copy to prevent
 * external mutations.
 */
export function getPendingCallMeta(): PendingCallMeta {
	return { ..._meta };
}
