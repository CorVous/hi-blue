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
	| { ok: true }
	| { ok: false; reason: "unavailable" | "quota" | "unknown" };

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
const SESSION_ID_RANGE = 0xffff;

export function mintSessionId(): string {
	const value = Math.floor(Math.random() * SESSION_ID_RANGE);
	const hexDigits = value
		.toString(16)
		.toUpperCase()
		.padStart(SESSION_ID_HEX_DIGITS, "0");
	return `0x${hexDigits}`;
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

export function saveActiveSession(
	state: GameState,
	opts?: { createdAt?: string },
): SaveResult {
	const sessionId = getActiveSessionId();
	if (!sessionId) return { ok: false, reason: "unknown" };

	const now = new Date().toISOString();
	const createdAt = opts?.createdAt ?? now;

	let epoch = 1;
	ignoringStorageErrors(() => {
		const existingMeta = localStorage.getItem(
			metaKey(SESSIONS_PREFIX, sessionId),
		);
		if (existingMeta !== null) {
			const parsed = JSON.parse(existingMeta) as MetaFile;
			if (typeof parsed.epoch === "number") epoch = parsed.epoch;
		}
	});

	let files: ReturnType<typeof serializeSession>;
	try {
		files = serializeSession(state, now, createdAt, epoch);
	} catch {
		return { ok: false, reason: "unknown" };
	}

	try {
		localStorage.setItem(metaKey(SESSIONS_PREFIX, sessionId), files.meta);

		for (const [aiId, daemonJson] of Object.entries(files.daemons)) {
			localStorage.setItem(
				daemonKey(SESSIONS_PREFIX, sessionId, aiId),
				daemonJson,
			);
		}

		// biome-ignore lint/style/noNonNullAssertion: serializeSession always returns a non-null engine string
		localStorage.setItem(engineKey(SESSIONS_PREFIX, sessionId), files.engine!);

		return { ok: true };
	} catch (err) {
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

export function loadActiveSession(): LoadResult {
	const sessionId = getActiveSessionId();
	if (!sessionId) return { kind: "none" };
	return _loadSessionById(sessionId);
}

export function clearActiveSession(): void {
	const sessionId = getActiveSessionId();
	ignoringStorageErrors(() => localStorage.removeItem(ACTIVE_KEY));
	if (!sessionId) return;

	ignoringStorageErrors(() => {
		const prefix = `${SESSIONS_PREFIX}${sessionId}/`;
		const keysToRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith(prefix)) keysToRemove.push(key);
		}
		for (const key of keysToRemove) {
			localStorage.removeItem(key);
		}
	});
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

function _loadSessionById(
	sessionId: string,
	storagePrefix = SESSIONS_PREFIX,
): LoadResult {
	try {
		const metaJson = localStorage.getItem(metaKey(storagePrefix, sessionId));
		const engineBlob = localStorage.getItem(
			engineKey(storagePrefix, sessionId),
		);

		const mintedButNeverSaved = metaJson === null && engineBlob === null;
		if (mintedButNeverSaved) return { kind: "none" };

		if (engineBlob === null) return { kind: "broken", sessionId };

		if (metaJson === null) return { kind: "broken", sessionId };

		const daemonsRaw: Record<AiId, string> = {};
		const sessionPrefix = `${storagePrefix}${sessionId}/`;
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			if (!key.startsWith(sessionPrefix)) continue;
			const suffix = key.slice(sessionPrefix.length);
			if (suffix.endsWith(".txt")) {
				const aiId = suffix.slice(0, -4);
				const value = localStorage.getItem(key);
				if (value !== null) daemonsRaw[aiId] = value;
			}
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
	try {
		const ids = new Set<string>();
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			if (!key.startsWith(SESSIONS_PREFIX)) continue;
			const rest = key.slice(SESSIONS_PREFIX.length);
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

export function loadSession(sessionId: string): LoadResult {
	return _loadSessionById(sessionId);
}

export function mintSession(): string {
	return mintSessionId();
}

export function dupSession(srcId: string): string {
	const loadResult = _loadSessionById(srcId);
	if (loadResult.kind === "broken" || loadResult.kind === "version-mismatch") {
		throw new Error(
			`dupSession: cannot dup ${loadResult.kind} session "${srcId}"`,
		);
	}

	const srcPrefix = `${SESSIONS_PREFIX}${srcId}/`;

	const metaVal = localStorage.getItem(`${srcPrefix}meta.json`);
	const engineVal = localStorage.getItem(`${srcPrefix}engine.dat`);

	const daemonEntries: Array<{ key: string; value: string }> = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (!key) continue;
		if (!key.startsWith(srcPrefix)) continue;
		const suffix = key.slice(srcPrefix.length);
		if (suffix.endsWith(".txt")) {
			const value = localStorage.getItem(key);
			if (value !== null) daemonEntries.push({ key: suffix, value });
		}
	}

	const newId = mintSessionId();
	const dstPrefix = `${SESSIONS_PREFIX}${newId}/`;

	if (metaVal !== null) {
		localStorage.setItem(`${dstPrefix}meta.json`, metaVal);
	}
	for (const { key, value } of daemonEntries) {
		localStorage.setItem(`${dstPrefix}${key}`, value);
	}
	if (engineVal !== null) {
		localStorage.setItem(`${dstPrefix}engine.dat`, engineVal);
	}

	return newId;
}

export function listArchivedSessions(): string[] {
	try {
		const ids = new Set<string>();
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			if (!key.startsWith(ARCHIVE_PREFIX)) continue;
			const rest = key.slice(ARCHIVE_PREFIX.length);
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

export function loadArchivedSession(sessionId: string): LoadResult {
	return _loadSessionById(sessionId, ARCHIVE_PREFIX);
}

export function getArchivedSessionInfo(
	id: string,
): Extract<SessionInfo, { kind: "archived" | "broken" | "version-mismatch" }> {
	const prefix = `${ARCHIVE_PREFIX}${id}/`;

	function getDaemonFiles(): Array<{ name: string; size: number }> {
		const files: Array<{ name: string; size: number }> = [];
		ignoringStorageErrors(() => {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (!key) continue;
				if (!key.startsWith(prefix)) continue;
				const suffix = key.slice(prefix.length);
				if (suffix.endsWith(".txt")) {
					const value = localStorage.getItem(key);
					files.push({ name: suffix, size: value?.length ?? 0 });
				}
			}
		});
		return files.sort((a, b) => a.name.localeCompare(b.name));
	}

	const result = loadArchivedSession(id);
	if (result.kind === "broken")
		return { kind: "broken", daemonFiles: getDaemonFiles() };
	if (result.kind === "version-mismatch")
		return {
			kind: "version-mismatch",
			schemaVersion: result.schemaVersion,
			daemonFiles: getDaemonFiles(),
		};
	if (result.kind === "none") return { kind: "broken", daemonFiles: [] };

	let lastPlayedAt = result.lastSavedAt;
	let epoch = result.epoch;
	ignoringStorageErrors(() => {
		const metaRaw = localStorage.getItem(`${prefix}meta.json`);
		if (metaRaw) {
			const meta = JSON.parse(metaRaw) as MetaFile;
			if (typeof meta.lastPlayedAt === "string")
				lastPlayedAt = meta.lastPlayedAt;
			if (typeof meta.epoch === "number") epoch = meta.epoch;
		}
	});

	const engineVal = localStorage.getItem(`${prefix}engine.dat`) ?? "";
	return {
		kind: "archived",
		lastSavedAt: result.lastSavedAt,
		lastPlayedAt,
		epoch,
		round: result.state.round,
		daemonFiles: getDaemonFiles(),
		engineSize: engineVal.length,
	};
}

export function rmArchivedSession(id: string): void {
	ignoringStorageErrors(() => {
		const prefix = `${ARCHIVE_PREFIX}${id}/`;
		const keysToRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith(prefix)) keysToRemove.push(key);
		}
		for (const key of keysToRemove) {
			localStorage.removeItem(key);
		}
	});
}

export async function archiveSession(sessionId: string): Promise<void> {
	const srcPrefix = `${SESSIONS_PREFIX}${sessionId}/`;
	const metaJson = localStorage.getItem(`${srcPrefix}meta.json`);
	const engineVal = localStorage.getItem(`${srcPrefix}engine.dat`);
	if (metaJson === null || engineVal === null) {
		throw new Error(
			`archiveSession: session "${sessionId}" is incomplete or missing`,
		);
	}
	const daemonEntries: Array<{ suffix: string; value: string }> = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (!key?.startsWith(srcPrefix)) continue;
		const suffix = key.slice(srcPrefix.length);
		if (suffix.endsWith(".txt")) {
			const value = localStorage.getItem(key);
			if (value !== null) daemonEntries.push({ suffix, value });
		}
	}
	let meta: MetaFile;
	try {
		meta = JSON.parse(metaJson) as MetaFile;
	} catch {
		throw new Error(
			`archiveSession: meta.json for "${sessionId}" is not valid JSON`,
		);
	}
	meta.readonly = true;
	meta.lastPlayedAt = meta.lastSavedAt;
	const dstPrefix = `${ARCHIVE_PREFIX}${sessionId}/`;
	localStorage.setItem(`${dstPrefix}meta.json`, JSON.stringify(meta, null, 2));
	for (const { suffix, value } of daemonEntries) {
		localStorage.setItem(`${dstPrefix}${suffix}`, value);
	}
	localStorage.setItem(`${dstPrefix}engine.dat`, engineVal);
}

export function rmSession(id: string): void {
	ignoringStorageErrors(() => {
		const prefix = `${SESSIONS_PREFIX}${id}/`;
		const keysToRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith(prefix)) keysToRemove.push(key);
		}
		for (const key of keysToRemove) {
			localStorage.removeItem(key);
		}
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
	const dstPrefix = `${SESSIONS_PREFIX}${newId}/`;

	localStorage.setItem(`${dstPrefix}meta.json`, files.meta);
	for (const [aiId, daemonJson] of Object.entries(files.daemons)) {
		localStorage.setItem(`${dstPrefix}${aiId}.txt`, daemonJson);
	}
	// biome-ignore lint/style/noNonNullAssertion: serializeSession always returns a non-null engine string
	localStorage.setItem(`${dstPrefix}engine.dat`, files.engine!);

	return newId;
}

export function getSessionInfo(
	id: string,
): Extract<SessionInfo, { kind: "ok" | "broken" | "version-mismatch" }> {
	const prefix = `${SESSIONS_PREFIX}${id}/`;

	function getDaemonFiles(): Array<{ name: string; size: number }> {
		const files: Array<{ name: string; size: number }> = [];
		ignoringStorageErrors(() => {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (!key) continue;
				if (!key.startsWith(prefix)) continue;
				const suffix = key.slice(prefix.length);
				if (suffix.endsWith(".txt")) {
					const value = localStorage.getItem(key);
					files.push({ name: suffix, size: value?.length ?? 0 });
				}
			}
		});
		return files.sort((a, b) => a.name.localeCompare(b.name));
	}

	const result = loadSession(id);

	if (result.kind === "broken") {
		return { kind: "broken", daemonFiles: getDaemonFiles() };
	}

	if (result.kind === "version-mismatch") {
		let lastSavedAt: string | undefined;
		let epoch: number | undefined;
		ignoringStorageErrors(() => {
			const metaRaw = localStorage.getItem(`${prefix}meta.json`);
			if (metaRaw) {
				const meta = JSON.parse(metaRaw) as {
					lastSavedAt?: string;
					epoch?: number;
					phase?: number;
				};
				if (typeof meta.lastSavedAt === "string")
					lastSavedAt = meta.lastSavedAt;
				const epochOrPreV6Phase =
					typeof meta.epoch === "number" ? meta.epoch : meta.phase;
				if (typeof epochOrPreV6Phase === "number") epoch = epochOrPreV6Phase;
			}
		});
		const vmResult: SessionInfo = {
			kind: "version-mismatch",
			schemaVersion: result.schemaVersion,
			daemonFiles: getDaemonFiles(),
			...(lastSavedAt !== undefined ? { lastSavedAt } : {}),
			...(epoch !== undefined ? { epoch } : {}),
		};
		return vmResult;
	}

	if (result.kind === "none") {
		return { kind: "broken", daemonFiles: [] };
	}

	const engineVal = localStorage.getItem(`${prefix}engine.dat`) ?? "";
	return {
		kind: "ok",
		lastSavedAt: result.lastSavedAt,
		epoch: result.epoch,
		round: result.state.round,
		daemonFiles: getDaemonFiles(),
		engineSize: engineVal.length,
	};
}
