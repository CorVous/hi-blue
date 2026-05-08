/**
 * session-storage.ts
 *
 * Facade over localStorage for the multi-file session format.
 *
 * Each session is stored as six localStorage keys:
 *   hi-blue:sessions/<id>/meta.json
 *   hi-blue:sessions/<id>/<aiId>.txt  × 3
 *   hi-blue:sessions/<id>/whispers.txt
 *   hi-blue:sessions/<id>/engine.dat   ← commit signal (written last)
 *
 * The active session pointer is stored at hi-blue:active-session.
 *
 * See docs/adr/0004-editable-vs-sealed-save-surface.md.
 */

import type { AiId, GameState } from "../game/types.js";
import {
	type DeserializeResult,
	deserializeSession,
	serializeSession,
} from "./session-codec.js";

// ── Keys ──────────────────────────────────────────────────────────────────────

export const ACTIVE_KEY = "hi-blue:active-session";
export const SESSIONS_PREFIX = "hi-blue:sessions/";
export const LEGACY_KEY = "hi-blue-game-state";

// ── SaveResult (mirrors game-storage.ts for API compatibility) ────────────────

export type SaveResult =
	| { ok: true }
	| { ok: false; reason: "unavailable" | "quota" | "unknown" };

// ── LoadResult ────────────────────────────────────────────────────────────────

export type LoadResult =
	| { kind: "none" }
	| {
			kind: "ok";
			state: GameState;
			sessionId: string;
			createdAt: string;
			lastSavedAt: string;
	  }
	| { kind: "broken"; sessionId: string }
	| { kind: "version-mismatch"; sessionId: string };

// ── Session ID ────────────────────────────────────────────────────────────────

/**
 * Mint a new 4-hex session id in the form `0xXXXX`.
 * Moved here from bbs-chrome.ts.
 */
export function mintSessionId(): string {
	const r = Math.floor(Math.random() * 0xffff);
	return `0x${r.toString(16).toUpperCase().padStart(4, "0")}`;
}

// ── Pointer management ────────────────────────────────────────────────────────

/** Return the currently active session id, or null if not set. */
export function getActiveSessionId(): string | null {
	try {
		return localStorage.getItem(ACTIVE_KEY);
	} catch {
		return null;
	}
}

/** Set the active session id pointer. */
export function setActiveSessionId(id: string): void {
	try {
		localStorage.setItem(ACTIVE_KEY, id);
	} catch {
		// swallow — best effort
	}
}

/** Mint a new session id and set it as the active pointer. Returns the new id. */
export function mintAndActivateNewSession(): string {
	const id = mintSessionId();
	setActiveSessionId(id);
	return id;
}

// ── Key helpers ───────────────────────────────────────────────────────────────

function metaKey(sessionId: string): string {
	return `${SESSIONS_PREFIX}${sessionId}/meta.json`;
}

function daemonKey(sessionId: string, aiId: AiId): string {
	return `${SESSIONS_PREFIX}${sessionId}/${aiId}.txt`;
}

function whispersKey(sessionId: string): string {
	return `${SESSIONS_PREFIX}${sessionId}/whispers.txt`;
}

function engineKey(sessionId: string): string {
	return `${SESSIONS_PREFIX}${sessionId}/engine.dat`;
}

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Save the active session to localStorage.
 *
 * Write order (strict):
 *   1. meta.json
 *   2..4. <aiId>.txt × 3
 *   5. whispers.txt
 *   6. engine.dat   ← commit signal
 *
 * Returns SaveResult. On error, no partial rollback is performed (the missing
 * engine.dat is the break signal on load).
 */
export function saveActiveSession(
	state: GameState,
	opts?: { createdAt?: string },
): SaveResult {
	const sessionId = getActiveSessionId();
	if (!sessionId) return { ok: false, reason: "unknown" };

	const now = new Date().toISOString();
	const createdAt = opts?.createdAt ?? now;

	let files: ReturnType<typeof serializeSession>;
	try {
		files = serializeSession(state, now, createdAt);
	} catch {
		return { ok: false, reason: "unknown" };
	}

	try {
		// 1. meta.json
		localStorage.setItem(metaKey(sessionId), files.meta);

		// 2..4. daemon files in persona insertion order
		for (const [aiId, daemonJson] of Object.entries(files.daemons)) {
			localStorage.setItem(daemonKey(sessionId, aiId), daemonJson);
		}

		// 5. whispers.txt
		localStorage.setItem(whispersKey(sessionId), files.whispers);

		// 6. engine.dat (commit signal — written last)
		// serializeSession always returns a string (not null) for engine.
		// biome-ignore lint/style/noNonNullAssertion: serializeSession always returns a non-null engine string
		localStorage.setItem(engineKey(sessionId), files.engine!);

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

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Load the active session from localStorage.
 *
 * Returns:
 *   { kind: "none" }                      — no active pointer set
 *   { kind: "ok", state, ... }            — successfully loaded
 *   { kind: "broken", sessionId }         — engine.dat missing or corrupt
 *   { kind: "version-mismatch", sessionId } — sealed schemaVersion stale
 */
export function loadActiveSession(): LoadResult {
	const sessionId = getActiveSessionId();
	if (!sessionId) return { kind: "none" };

	try {
		// Read all six files
		const metaJson = localStorage.getItem(metaKey(sessionId));
		const whispersJson = localStorage.getItem(whispersKey(sessionId));
		const engineBlob = localStorage.getItem(engineKey(sessionId));

		// No data at all: session was minted but never saved — treat as "none".
		// This happens when the game is freshly started but no round has been
		// submitted yet, e.g. after discarding a legacy save and minting a new session.
		if (metaJson === null && whispersJson === null && engineBlob === null) {
			return { kind: "none" };
		}

		// engine.dat absent (but other files present) → broken commit
		if (engineBlob === null) return { kind: "broken", sessionId };

		// meta.json absent → broken
		if (metaJson === null) return { kind: "broken", sessionId };

		// whispers.txt absent → broken
		if (whispersJson === null) return { kind: "broken", sessionId };

		// Read daemon files — discover aiIds from meta to avoid key-enumeration
		// We read all localStorage keys that match our daemon pattern for this session
		const daemonsRaw: Record<AiId, string> = {};
		const prefix = `${SESSIONS_PREFIX}${sessionId}/`;
		// Enumerate keys matching the daemon pattern
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			if (!key.startsWith(prefix)) continue;
			const suffix = key.slice(prefix.length);
			if (suffix.endsWith(".txt") && suffix !== "whispers.txt") {
				const aiId = suffix.slice(0, -4); // strip .txt
				const value = localStorage.getItem(key);
				if (value !== null) daemonsRaw[aiId] = value;
			}
		}

		const result: DeserializeResult = deserializeSession({
			meta: metaJson,
			daemons: daemonsRaw,
			whispers: whispersJson,
			engine: engineBlob,
		});

		if (result.kind === "ok") {
			return {
				kind: "ok",
				state: result.state,
				sessionId,
				createdAt: result.createdAt,
				lastSavedAt: result.lastSavedAt,
			};
		}
		if (result.kind === "version-mismatch") {
			return { kind: "version-mismatch", sessionId };
		}
		return { kind: "broken", sessionId };
	} catch {
		return { kind: "broken", sessionId };
	}
}

// ── Clear ─────────────────────────────────────────────────────────────────────

/**
 * Delete all six session files plus the active pointer.
 * Best-effort: errors are silently swallowed.
 */
export function clearActiveSession(): void {
	const sessionId = getActiveSessionId();
	try {
		localStorage.removeItem(ACTIVE_KEY);
	} catch {
		// swallow
	}
	if (!sessionId) return;

	try {
		// Remove all keys under this session prefix
		const prefix = `${SESSIONS_PREFIX}${sessionId}/`;
		const keysToRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith(prefix)) keysToRemove.push(key);
		}
		for (const key of keysToRemove) {
			localStorage.removeItem(key);
		}
	} catch {
		// swallow
	}
}

// ── Legacy ─────────────────────────────────────────────────────────────────────

/** Check whether the legacy single-key save exists. */
export function hasLegacySave(): boolean {
	try {
		return localStorage.getItem(LEGACY_KEY) !== null;
	} catch {
		return false;
	}
}

/** Delete the legacy single-key save. */
export function deleteLegacySaveKey(): void {
	try {
		localStorage.removeItem(LEGACY_KEY);
	} catch {
		// swallow
	}
}

// ── Stubs for future slices ───────────────────────────────────────────────────

/** List all session ids in localStorage. */
export function listSessions(): string[] {
	throw new Error("not-implemented: listSessions");
}

/** Duplicate a session, returning the new session id. */
export function dupSession(_sessionId: string): string {
	throw new Error("not-implemented: dupSession");
}

/** Remove a session by id. */
export function rmSession(_sessionId: string): void {
	throw new Error("not-implemented: rmSession");
}

/** Load a session by id (without making it active). */
export function loadSession(_sessionId: string): LoadResult {
	throw new Error("not-implemented: loadSession");
}
