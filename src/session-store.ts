/**
 * SessionStore
 *
 * Cookie-keyed in-process Map. Sessions persist across requests within a
 * single worker run. Worker restart drops all sessions.
 *
 * This is intentionally thin — it's a Map with two operations:
 *   - getOrCreate(sessionId, factory) → GameSession
 *   - get(sessionId) → GameSession | undefined
 *
 * KV persistence is out of scope for v1 (single-instance Wrangler dev).
 */

import { GameSession } from "./game-session";
import type { PhaseConfig } from "./types";

const SESSION_COOKIE = "hi-blue-session";

/** Module-level singleton — persists across requests within one worker isolate. */
const sessions = new Map<string, GameSession>();

/**
 * Generate a simple random session ID (not cryptographically strong, but
 * sufficient for a single-player local dev worker).
 */
function generateSessionId(): string {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Parse the session cookie value from a Cookie header string.
 * Returns undefined if the cookie is absent.
 */
export function parseSessionCookie(
	cookieHeader: string | null,
): string | undefined {
	if (!cookieHeader) return undefined;
	for (const part of cookieHeader.split(";")) {
		const [name, value] = part.trim().split("=");
		if (name?.trim() === SESSION_COOKIE && value) {
			return decodeURIComponent(value.trim());
		}
	}
	return undefined;
}

/**
 * Create a new session keyed by a freshly generated ID.
 * Returns { session, sessionId } so the caller can set the cookie.
 */
export function createSession(phaseConfig: PhaseConfig): {
	session: GameSession;
	sessionId: string;
} {
	const sessionId = generateSessionId();
	const session = new GameSession(phaseConfig);
	sessions.set(sessionId, session);
	return { session, sessionId };
}

/**
 * Retrieve an existing session by ID.
 * Returns undefined if not found (session expired via worker restart, or
 * invalid cookie).
 */
export function getSession(sessionId: string): GameSession | undefined {
	return sessions.get(sessionId);
}

/**
 * Build a Set-Cookie header value for the session cookie.
 * SameSite=Strict; HttpOnly; Path=/ — appropriate for a local dev worker.
 */
export function buildSessionCookie(sessionId: string): string {
	return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; SameSite=Strict; HttpOnly`;
}
