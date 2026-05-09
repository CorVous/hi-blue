/**
 * active-session-dispatcher.ts
 *
 * Pure function that inspects an active-session snapshot and returns a routing
 * verdict: which route to land on and why.
 *
 * Five-state truth table:
 *   1. activeSessionId === null → #/start, reason "no-active-pointer", needsMint true
 *   2. loadResult.kind === "ok"             → #/game,     reason "populated",        needsMint false
 *   3. loadResult.kind === "none"           → #/start,    reason "empty",            needsMint false
 *   4. loadResult.kind === "broken"         → #/sessions, reason "broken",           needsMint false
 *   5. loadResult.kind === "version-mismatch" → #/sessions, reason "version-mismatch", needsMint false
 *
 * Issue #174 (parent #155).
 */

import type { LoadResult } from "./session-storage.js";

export type DispatcherReason =
	| "populated"
	| "empty"
	| "broken"
	| "version-mismatch"
	| "no-active-pointer";

export interface DispatcherVerdict {
	route: "#/start" | "#/game" | "#/sessions";
	reason: DispatcherReason;
	needsMint: boolean;
}

export interface DispatcherSnapshot {
	activeSessionId: string | null;
	loadResult: LoadResult;
}

/**
 * Pure routing function. No side effects, no DOM, no localStorage access.
 *
 * Callers are responsible for reading `activeSessionId` and `loadResult`
 * from storage before calling this function.
 */
export function dispatchActiveSession(
	snapshot: DispatcherSnapshot,
): DispatcherVerdict {
	const { activeSessionId, loadResult } = snapshot;

	// Row 1: no active pointer at all → mint a new session and go to start
	if (activeSessionId === null) {
		return { route: "#/start", reason: "no-active-pointer", needsMint: true };
	}

	// Rows 2–5: active pointer exists; outcome depends on the load result
	switch (loadResult.kind) {
		case "ok":
			return { route: "#/game", reason: "populated", needsMint: false };

		case "none":
			return { route: "#/start", reason: "empty", needsMint: false };

		case "broken":
			return { route: "#/sessions", reason: "broken", needsMint: false };

		case "version-mismatch":
			// TODO(#146): version-mismatch handling
			return {
				route: "#/sessions",
				reason: "version-mismatch",
				needsMint: false,
			};
	}
}
