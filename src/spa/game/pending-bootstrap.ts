import {
	type BootstrapOpts,
	generateContentPacksOnlySplit,
	generateNewGameAssetsSplit,
	type SplitNewGameAssets,
} from "./bootstrap.js";
import type { AiId, AiPersona } from "./types.js";

type PendingBootstrapStatus = "pending" | "personas-ready" | "ready" | "failed";

export interface PendingBootstrap extends SplitNewGameAssets {
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
const abortControllers = new WeakMap<PendingBootstrap, AbortController>();

function isCurrent(entry: PendingBootstrap): boolean {
	return currentBootstrap === entry;
}

function markFailed(entry: PendingBootstrap, err: unknown): void {
	if (entry.status === "failed") return;
	entry.status = "failed";
	entry.error = err;
	if (isCurrent(entry)) recordPendingRetry(err);
}

function watchContentPacks(entry: PendingBootstrap): void {
	entry.contentPacksPromise.then(
		() => {
			if (entry.status !== "failed") entry.status = "ready";
		},
		(err: unknown) => markFailed(entry, err),
	);
}

function install(
	entry: PendingBootstrap,
	controller: AbortController,
): PendingBootstrap {
	const previous = currentBootstrap;
	currentBootstrap = entry;
	abortControllers.set(entry, controller);
	if (previous && previous !== entry) {
		abortControllers.get(previous)?.abort();
	}
	return entry;
}

export function startBootstrap(opts?: BootstrapOpts): PendingBootstrap {
	if (currentBootstrap && currentBootstrap.status !== "failed")
		return currentBootstrap;

	const controller = new AbortController();
	const split = generateNewGameAssetsSplit({
		...opts,
		signal: controller.signal,
	});
	const entry: PendingBootstrap = { ...split, status: "pending" };

	install(entry, controller);
	recordPendingCall("persona-synthesis");

	split.personasPromise.then(
		(personas) => {
			entry.personas = personas;
			if (entry.status === "pending") entry.status = "personas-ready";
			if (isCurrent(entry) && entry.status !== "failed") {
				recordPendingCall("content-pack");
			}
		},
		(err: unknown) => markFailed(entry, err),
	);
	watchContentPacks(entry);

	return entry;
}

export function getPendingBootstrap(): PendingBootstrap | undefined {
	return currentBootstrap;
}

export function getCachedPersonas(): Record<AiId, AiPersona> | undefined {
	return currentBootstrap?.personas;
}

export function restartContentPacks(): PendingBootstrap {
	const cached = getCachedPersonas();
	if (!cached) {
		return startBootstrap();
	}

	const controller = new AbortController();
	const split = generateContentPacksOnlySplit(cached, {
		signal: controller.signal,
	});
	const entry: PendingBootstrap = {
		...split,
		status: "pending",
		personas: cached,
	};

	install(entry, controller);
	recordPendingCall("content-pack");
	watchContentPacks(entry);

	return entry;
}

export function failPendingBootstrap(
	entry: PendingBootstrap,
	reason: unknown,
): void {
	markFailed(entry, reason);
	abortControllers.get(entry)?.abort(reason);
}

export function clearPendingBootstrap(): void {
	const cleared = currentBootstrap;
	currentBootstrap = undefined;
	clearPendingCallMeta();
	if (cleared) abortControllers.get(cleared)?.abort();
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
