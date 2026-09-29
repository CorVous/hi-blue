import { appendBroadcast } from "../game/engine.js";
import type { AiId, GameState } from "../game/types.js";
import {
	type DeserializeResult,
	deserializeSession,
	type MetaFile,
	serializeSession,
} from "./session-codec.js";

export type SessionInfo =
	| {
			kind: "ok";
			lastSavedAt: string;
			epoch: number;
			round: number;
			daemonFiles: Array<{ name: string; size: number }>;
			engineSize: number;
	  }
	| { kind: "broken"; daemonFiles: Array<{ name: string; size: number }> }
	| {
			kind: "version-mismatch";
			schemaVersion: number;
			lastSavedAt?: string;
			epoch?: number;
			daemonFiles: Array<{ name: string; size: number }>;
	  }
	| {
			kind: "archived";
			lastSavedAt: string;
			lastPlayedAt: string;
			epoch: number;
			round: number;
			daemonFiles: Array<{ name: string; size: number }>;
			engineSize: number;
	  };

export const ACTIVE_KEY = "hi-blue:active-session";
export const SESSIONS_PREFIX = "hi-blue:sessions/";
export const ARCHIVE_PREFIX = "hi-blue:archive/";
export const LEGACY_KEY = "hi-blue-game-state";

export type SaveResult =
	| { ok: true; lastSavedAt: string }
	| { ok: false; reason: "unavailable" | "quota" | "unknown" | "stale" };

export type LoadResult =
	| { kind: "none" }
	| {
			kind: "ok";
			state: GameState;
			sessionId: string;
			createdAt: string;
			lastSavedAt: string;
			epoch: number;
	  }
	| { kind: "broken"; sessionId: string }
	| { kind: "version-mismatch"; sessionId: string; schemaVersion: number };

const SESSION_ID_HEX_DIGITS = 4;
const SESSION_ID_RANGE = 0x10000;

function randomSessionId(): string {
	const value = Math.floor(Math.random() * SESSION_ID_RANGE);
	const hexDigits = value
		.toString(16)
		.toUpperCase()
		.padStart(SESSION_ID_HEX_DIGITS, "0");
	return `0x${hexDigits}`;
}

function sessionIdsInUse(): Set<string> {
	return new Set([
		...listSessionIdsUnder(SESSIONS_PREFIX),
		...listSessionIdsUnder(ARCHIVE_PREFIX),
	]);
}

export function mintSessionId(): string {
	const inUse = sessionIdsInUse();
	let id = randomSessionId();
	for (
		let attempt = 1;
		inUse.has(id) && attempt < SESSION_ID_RANGE;
		attempt++
	) {
		id = randomSessionId();
	}
	return id;
}

function keysUnder(prefix: string): string[] {
	const keys: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key?.startsWith(prefix)) keys.push(key);
	}
	return keys;
}

function removeKeysUnder(prefix: string): void {
	for (const key of keysUnder(prefix)) {
		localStorage.removeItem(key);
	}
}

function readDaemonEntries(
	directory: string,
): Array<{ suffix: string; value: string }> {
	const entries: Array<{ suffix: string; value: string }> = [];
	for (const key of keysUnder(directory)) {
		const suffix = key.slice(directory.length);
		if (!suffix.endsWith(".txt")) continue;
		const value = localStorage.getItem(key);
		if (value !== null) entries.push({ suffix, value });
	}
	return entries;
}

function listSessionIdsUnder(storagePrefix: string): string[] {
	try {
		const ids = new Set<string>();
		for (const key of keysUnder(storagePrefix)) {
			const rest = key.slice(storagePrefix.length);
			const slashIdx = rest.indexOf("/");
			if (slashIdx === -1) continue;
			const id = rest.slice(0, slashIdx);
			if (id) ids.add(id);
		}
		return Array.from(ids);
	} catch {
		return [];
	}
}

function ignoringStorageErrors(storageAction: () => void): void {
	try {
		storageAction();
	} catch {}
}

export function getActiveSessionId(): string | null {
	try {
		return localStorage.getItem(ACTIVE_KEY);
	} catch {
		return null;
	}
}

export function setActiveSessionId(id: string): void {
	ignoringStorageErrors(() => localStorage.setItem(ACTIVE_KEY, id));
}

export function mintAndActivateNewSession(): string {
	const id = mintSessionId();
	setActiveSessionId(id);
	return id;
}

function metaKey(prefix: string, sessionId: string): string {
	return `${prefix}${sessionId}/meta.json`;
}

function daemonKey(prefix: string, sessionId: string, aiId: AiId): string {
	return `${prefix}${sessionId}/${aiId}.txt`;
}

function engineKey(prefix: string, sessionId: string): string {
	return `${prefix}${sessionId}/engine.dat`;
}

function savingMarkerKey(prefix: string, sessionId: string): string {
	return `${prefix}${sessionId}/saving`;
}

function sessionDir(prefix: string, sessionId: string): string {
	return `${prefix}${sessionId}/`;
}

function readMetaFile(prefix: string, sessionId: string): MetaFile | null {
	let meta: MetaFile | null = null;
	ignoringStorageErrors(() => {
		const metaRaw = localStorage.getItem(metaKey(prefix, sessionId));
		if (metaRaw) meta = JSON.parse(metaRaw) as MetaFile;
	});
	return meta;
}

interface StoredSessionFiles {
	meta: string | null;
	daemonEntries: Array<{ suffix: string; value: string }>;
	engine: string | null;
}

function readSessionFiles(
	prefix: string,
	sessionId: string,
): StoredSessionFiles {
	return {
		meta: localStorage.getItem(metaKey(prefix, sessionId)),
		daemonEntries: readDaemonEntries(sessionDir(prefix, sessionId)),
		engine: localStorage.getItem(engineKey(prefix, sessionId)),
	};
}

function writeSessionFiles(
	prefix: string,
	sessionId: string,
	files: StoredSessionFiles,
): void {
	if (files.meta !== null) {
		localStorage.setItem(metaKey(prefix, sessionId), files.meta);
	}
	for (const { suffix, value } of files.daemonEntries) {
		localStorage.setItem(`${sessionDir(prefix, sessionId)}${suffix}`, value);
	}
	if (files.engine !== null) {
		localStorage.setItem(engineKey(prefix, sessionId), files.engine);
	}
}

export function saveActiveSession(
	state: GameState,
	opts?: {
		createdAt?: string;
		sessionId?: string | null;
		expectedLastSavedAt?: string;
		advanceEpoch?: boolean;
	},
): SaveResult {
	const sessionId = opts?.sessionId ?? getActiveSessionId();
	if (!sessionId) return { ok: false, reason: "unknown" };

	const now = new Date().toISOString();

	const existingMeta = readMetaFile(SESSIONS_PREFIX, sessionId);
	const expected = opts?.expectedLastSavedAt;
	if (expected !== undefined && existingMeta?.lastSavedAt !== expected) {
		return { ok: false, reason: "stale" };
	}
	const storedEpoch =
		typeof existingMeta?.epoch === "number" ? existingMeta.epoch : 1;
	const epoch = opts?.advanceEpoch ? storedEpoch + 1 : storedEpoch;
	const existingCreatedAt =
		typeof existingMeta?.createdAt === "string"
			? existingMeta.createdAt
			: undefined;
	const createdAt = opts?.createdAt ?? existingCreatedAt ?? now;

	let files: ReturnType<typeof serializeSession>;
	try {
		files = serializeSession(state, now, createdAt, epoch);
	} catch {
		return { ok: false, reason: "unknown" };
	}

	const markerKey = savingMarkerKey(SESSIONS_PREFIX, sessionId);
	let markerWritten = false;
	let anyDataKeyWritten = false;
	try {
		localStorage.setItem(markerKey, now);
		markerWritten = true;
		localStorage.setItem(metaKey(SESSIONS_PREFIX, sessionId), files.meta);
		anyDataKeyWritten = true;

		for (const [aiId, daemonJson] of Object.entries(files.daemons)) {
			localStorage.setItem(
				daemonKey(SESSIONS_PREFIX, sessionId, aiId),
				daemonJson,
			);
		}

		localStorage.setItem(engineKey(SESSIONS_PREFIX, sessionId), files.engine);
		localStorage.removeItem(markerKey);

		return { ok: true, lastSavedAt: now };
	} catch (err) {
		if (markerWritten && !anyDataKeyWritten) {
			ignoringStorageErrors(() => localStorage.removeItem(markerKey));
		}
		if (err instanceof DOMException) {
			const name = err.name;
			if (
				name === "QuotaExceededError" ||
				name === "NS_ERROR_DOM_QUOTA_REACHED"
			) {
				return { ok: false, reason: "quota" };
			}
			if (name === "SecurityError") {
				return { ok: false, reason: "unavailable" };
			}
		}
		return { ok: false, reason: "unknown" };
	}
}

export function readSessionLastSavedAt(sessionId: string): string | null {
	const lastSavedAt = readMetaFile(SESSIONS_PREFIX, sessionId)?.lastSavedAt;
	return typeof lastSavedAt === "string" ? lastSavedAt : null;
}

export function isSessionStorageKey(key: string, sessionId: string): boolean {
	return key.startsWith(sessionDir(SESSIONS_PREFIX, sessionId));
}

export function isSessionSaveInProgress(sessionId: string): boolean {
	try {
		return (
			localStorage.getItem(savingMarkerKey(SESSIONS_PREFIX, sessionId)) !== null
		);
	} catch {
		return false;
	}
}

export function loadActiveSession(): LoadResult {
	const sessionId = getActiveSessionId();
	if (!sessionId) return { kind: "none" };
	return loadSession(sessionId);
}

export function clearActiveSession(): void {
	const sessionId = getActiveSessionId();
	ignoringStorageErrors(() => localStorage.removeItem(ACTIVE_KEY));
	if (!sessionId) return;

	ignoringStorageErrors(() =>
		removeKeysUnder(sessionDir(SESSIONS_PREFIX, sessionId)),
	);
}

export function deactivateActiveSession(): void {
	ignoringStorageErrors(() => localStorage.removeItem(ACTIVE_KEY));
}

export function hasLegacySave(): boolean {
	try {
		return localStorage.getItem(LEGACY_KEY) !== null;
	} catch {
		return false;
	}
}

export function deleteLegacySaveKey(): void {
	ignoringStorageErrors(() => localStorage.removeItem(LEGACY_KEY));
}

export function loadSession(
	sessionId: string,
	storagePrefix = SESSIONS_PREFIX,
): LoadResult {
	try {
		const metaJson = localStorage.getItem(metaKey(storagePrefix, sessionId));
		const engineBlob = localStorage.getItem(
			engineKey(storagePrefix, sessionId),
		);

		const saveWasInterrupted =
			localStorage.getItem(savingMarkerKey(storagePrefix, sessionId)) !== null;
		if (saveWasInterrupted) return { kind: "broken", sessionId };

		const mintedButNeverSaved = metaJson === null && engineBlob === null;
		if (mintedButNeverSaved) return { kind: "none" };

		if (engineBlob === null || metaJson === null) {
			return { kind: "broken", sessionId };
		}

		const daemonsRaw: Record<AiId, string> = {};
		for (const { suffix, value } of readDaemonEntries(
			sessionDir(storagePrefix, sessionId),
		)) {
			daemonsRaw[suffix.slice(0, -4)] = value;
		}

		const result: DeserializeResult = deserializeSession({
			meta: metaJson,
			daemons: daemonsRaw,
			engine: engineBlob,
		});

		if (result.kind === "ok") {
			return {
				kind: "ok",
				state: result.state,
				sessionId,
				createdAt: result.createdAt,
				lastSavedAt: result.lastSavedAt,
				epoch: result.epoch,
			};
		}
		if (result.kind === "version-mismatch") {
			return {
				kind: "version-mismatch",
				sessionId,
				schemaVersion: result.schemaVersion,
			};
		}
		return { kind: "broken", sessionId };
	} catch {
		return { kind: "broken", sessionId };
	}
}

export function listSessions(): string[] {
	return listSessionIdsUnder(SESSIONS_PREFIX);
}

export function dupSession(srcId: string): string {
	const loadResult = loadSession(srcId);
	if (loadResult.kind === "broken" || loadResult.kind === "version-mismatch") {
		throw new Error(
			`dupSession: cannot dup ${loadResult.kind} session "${srcId}"`,
		);
	}

	const files = readSessionFiles(SESSIONS_PREFIX, srcId);
	const newId = mintSessionId();
	writeSessionFiles(SESSIONS_PREFIX, newId, files);

	return newId;
}

export function listArchivedSessions(): string[] {
	return listSessionIdsUnder(ARCHIVE_PREFIX);
}

export function loadArchivedSession(sessionId: string): LoadResult {
	return loadSession(sessionId, ARCHIVE_PREFIX);
}

function listDaemonFiles(
	prefix: string,
): Array<{ name: string; size: number }> {
	const files: Array<{ name: string; size: number }> = [];
	ignoringStorageErrors(() => {
		for (const key of keysUnder(prefix)) {
			const suffix = key.slice(prefix.length);
			if (suffix.endsWith(".txt")) {
				const value = localStorage.getItem(key);
				files.push({ name: suffix, size: value?.length ?? 0 });
			}
		}
	});
	return files.sort((a, b) => a.name.localeCompare(b.name));
}

type UnloadableSessionInfo = Extract<
	SessionInfo,
	{ kind: "broken" | "version-mismatch" }
>;

type InspectedSession =
	| { loaded: Extract<LoadResult, { kind: "ok" }> }
	| { unloadable: UnloadableSessionInfo };

function inspectSession(id: string, storagePrefix: string): InspectedSession {
	const result = loadSession(id, storagePrefix);
	const dir = sessionDir(storagePrefix, id);
	switch (result.kind) {
		case "ok":
			return { loaded: result };
		case "broken":
			return {
				unloadable: { kind: "broken", daemonFiles: listDaemonFiles(dir) },
			};
		case "version-mismatch":
			return {
				unloadable: {
					kind: "version-mismatch",
					schemaVersion: result.schemaVersion,
					daemonFiles: listDaemonFiles(dir),
				},
			};
		case "none":
			return { unloadable: { kind: "broken", daemonFiles: [] } };
	}
}

function engineSize(storagePrefix: string, id: string): number {
	return (localStorage.getItem(engineKey(storagePrefix, id)) ?? "").length;
}

export function getArchivedSessionInfo(
	id: string,
): Extract<SessionInfo, { kind: "archived" | "broken" | "version-mismatch" }> {
	const inspected = inspectSession(id, ARCHIVE_PREFIX);
	if ("unloadable" in inspected) return inspected.unloadable;
	const { loaded } = inspected;

	const meta = readMetaFile(ARCHIVE_PREFIX, id);
	return {
		kind: "archived",
		lastSavedAt: loaded.lastSavedAt,
		lastPlayedAt:
			typeof meta?.lastPlayedAt === "string"
				? meta.lastPlayedAt
				: loaded.lastSavedAt,
		epoch: typeof meta?.epoch === "number" ? meta.epoch : loaded.epoch,
		round: loaded.state.round,
		daemonFiles: listDaemonFiles(sessionDir(ARCHIVE_PREFIX, id)),
		engineSize: engineSize(ARCHIVE_PREFIX, id),
	};
}

export function rmArchivedSession(id: string): void {
	ignoringStorageErrors(() => removeKeysUnder(sessionDir(ARCHIVE_PREFIX, id)));
}

export function isSessionComplete(sessionId: string): boolean {
	const files = readSessionFiles(SESSIONS_PREFIX, sessionId);
	return (
		files.meta !== null &&
		files.engine !== null &&
		localStorage.getItem(savingMarkerKey(SESSIONS_PREFIX, sessionId)) === null
	);
}

export async function archiveSession(sessionId: string): Promise<void> {
	const files = readSessionFiles(SESSIONS_PREFIX, sessionId);
	const saveWasInterrupted =
		localStorage.getItem(savingMarkerKey(SESSIONS_PREFIX, sessionId)) !== null;
	if (files.meta === null || files.engine === null || saveWasInterrupted) {
		throw new Error(
			`archiveSession: session "${sessionId}" is incomplete or missing`,
		);
	}
	let meta: MetaFile;
	try {
		meta = JSON.parse(files.meta) as MetaFile;
	} catch {
		throw new Error(
			`archiveSession: meta.json for "${sessionId}" is not valid JSON`,
		);
	}
	meta.readonly = true;
	meta.lastPlayedAt = meta.lastSavedAt;
	removeKeysUnder(sessionDir(ARCHIVE_PREFIX, sessionId));
	writeSessionFiles(ARCHIVE_PREFIX, sessionId, {
		...files,
		meta: JSON.stringify(meta, null, 2),
	});
}

export function rmSession(id: string): void {
	ignoringStorageErrors(() => {
		removeKeysUnder(sessionDir(SESSIONS_PREFIX, id));
		if (getActiveSessionId() === id) {
			localStorage.removeItem(ACTIVE_KEY);
		}
	});
}

export function seedFromArchive(
	archiveId: string,
	freshState: GameState,
): string {
	const archiveResult = loadArchivedSession(archiveId);
	if (archiveResult.kind !== "ok") {
		throw new Error(
			`seedFromArchive: archive "${archiveId}" is not loadable (kind: ${archiveResult.kind})`,
		);
	}

	const archivedLogs = JSON.parse(
		JSON.stringify(archiveResult.state.conversationLogs),
	) as GameState["conversationLogs"];
	const mergedState: GameState = {
		...freshState,
		conversationLogs: archivedLogs,
	};

	const broadcastedState = appendBroadcast(
		mergedState,
		"The sysadmin has created a new room.",
	);

	const newEpoch = archiveResult.epoch + 1;
	const now = new Date().toISOString();
	const files = serializeSession(broadcastedState, now, now, newEpoch);

	const newId = mintSessionId();
	writeSessionFiles(SESSIONS_PREFIX, newId, {
		meta: files.meta,
		daemonEntries: Object.entries(files.daemons).map(([aiId, value]) => ({
			suffix: `${aiId}.txt`,
			value,
		})),
		engine: files.engine,
	});

	return newId;
}

export function getSessionInfo(
	id: string,
): Extract<SessionInfo, { kind: "ok" | "broken" | "version-mismatch" }> {
	const inspected = inspectSession(id, SESSIONS_PREFIX);

	if ("unloadable" in inspected) {
		const info = inspected.unloadable;
		if (info.kind !== "version-mismatch") return info;
		const meta = readMetaFile(SESSIONS_PREFIX, id) as
			| (MetaFile & { phase?: number })
			| null;
		const lastSavedAt =
			typeof meta?.lastSavedAt === "string" ? meta.lastSavedAt : undefined;
		const epochOrPreV6Phase =
			typeof meta?.epoch === "number" ? meta.epoch : meta?.phase;
		const epoch =
			typeof epochOrPreV6Phase === "number" ? epochOrPreV6Phase : undefined;
		return {
			...info,
			...(lastSavedAt !== undefined ? { lastSavedAt } : {}),
			...(epoch !== undefined ? { epoch } : {}),
		};
	}

	const { loaded } = inspected;
	return {
		kind: "ok",
		lastSavedAt: loaded.lastSavedAt,
		epoch: loaded.epoch,
		round: loaded.state.round,
		daemonFiles: listDaemonFiles(sessionDir(SESSIONS_PREFIX, id)),
		engineSize: engineSize(SESSIONS_PREFIX, id),
	};
}
