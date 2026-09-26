import {
	type BootstrapOpts,
	generateContentPacksOnlySplit,
	generateNewGameAssetsSplit,
	type SplitNewGameAssets,
} from "./bootstrap.js";
import type { AiId, AiPersona, ContentPack, ObjectiveType } from "./types.js";

type PendingBootstrapStatus = "pending" | "personas-ready" | "ready" | "failed";

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

const PENDING_CALL_RETRY_MAX = 3;

let currentBootstrap: PendingBootstrap | undefined;
let currentCallMeta: PendingCallMeta = {};

export function startBootstrap(opts?: BootstrapOpts): PendingBootstrap {
	if (currentBootstrap && currentBootstrap.status !== "failed")
		return currentBootstrap;

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

	currentBootstrap = entry;
	return entry;
}

export function getPendingBootstrap(): PendingBootstrap | undefined {
	return currentBootstrap;
}

export function getCachedPersonas(): Record<AiId, AiPersona> | undefined {
	return currentBootstrap?.personas;
}

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

	currentBootstrap = entry;
	return entry;
}

export function clearPendingBootstrap(): void {
	currentBootstrap = undefined;
	clearPendingCallMeta();
}

export function recordPendingCall(callName: string): void {
	currentCallMeta = {
		callName,
		startedAtMs: Date.now(),
		retryCount: 0,
		retryMax: PENDING_CALL_RETRY_MAX,
	};
}

export function recordPendingRetry(error?: unknown): void {
	const text = error instanceof Error ? error.message : String(error);
	currentCallMeta = {
		...currentCallMeta,
		retryCount: (currentCallMeta.retryCount ?? 0) + 1,
		lastError: text,
	};
}

function clearPendingCallMeta(): void {
	currentCallMeta = {};
}

export function getPendingCallMeta(): PendingCallMeta {
	return { ...currentCallMeta };
}
