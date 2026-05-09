/**
 * main.ts
 *
 * SPA entry point. Registers routes and starts the hash-based router.
 *
 * Active-pointer dispatcher:
 *   On every route entry and hashchange, the dispatcher reads the active-session
 *   pointer + loadResult and decides whether the current route is appropriate.
 *   Mismatches are handled by redirecting (never by calling the renderer).
 *
 * Issue #173 (parent #155).
 */

import "./styles.css";
import { initByokModal } from "./byok-modal.js";
import { dispatchActiveSession } from "./persistence/active-session-dispatcher.js";
import {
	deleteLegacySaveKey,
	getActiveSessionId,
	hasLegacySave,
	loadActiveSession,
	mintAndActivateNewSession,
} from "./persistence/session-storage.js";
import { registerRoute, start } from "./router.js";
import { renderGame } from "./routes/game.js";
import { renderSessions } from "./routes/sessions.js";
import { renderStart } from "./routes/start.js";

// ── One-time legacy-save check at boot ────────────────────────────────────────
// If the old single-key save exists and no active-session pointer is set,
// discard the legacy save and pass the reason via query param on redirect.
// We use a query param rather than module state to avoid coupling boot order.

let legacySaveDiscarded = false;
try {
	if (hasLegacySave() && getActiveSessionId() === null) {
		deleteLegacySaveKey();
		legacySaveDiscarded = true;
	}
} catch {
	// silently ignore if localStorage is unavailable
}

// ── withDispatcher: wraps a renderer with active-pointer logic ────────────────
//
// targetHash: the hash this renderer owns (e.g. "#/start" or "#/game")
// gameOnly:   when true, only render if verdict.reason === "populated";
//             otherwise redirect to #/start
// startOnly:  when true, only redirect if verdict.reason === "populated"
//             (i.e. active session exists → send to game)

type RendererFn = (
	root: HTMLElement,
	params: URLSearchParams,
) => Promise<void> | void;

function withDispatcher(
	targetHash: "#/start" | "#/game" | "#/sessions",
	renderer: RendererFn,
): RendererFn {
	return (root: HTMLElement, params: URLSearchParams) => {
		// #/sessions opts out of dispatcher redirect logic — render unconditionally.
		if (targetHash === "#/sessions") {
			return renderer(root, params);
		}

		// Read state from storage
		const activeSessionId = getActiveSessionId();
		let loadResult = loadActiveSession();

		let effectiveActiveId = activeSessionId;

		// Build initial snapshot
		let snapshot = { activeSessionId: effectiveActiveId, loadResult };
		let verdict = dispatchActiveSession(snapshot);

		// If needsMint, mint a new session id and recompute
		if (verdict.needsMint) {
			mintAndActivateNewSession();
			effectiveActiveId = getActiveSessionId();
			loadResult = loadActiveSession();
			snapshot = { activeSessionId: effectiveActiveId, loadResult };
			verdict = dispatchActiveSession(snapshot);
		}

		if (targetHash === "#/start") {
			// Start screen: redirect to game only when session is populated
			if (verdict.reason === "populated") {
				location.hash = "#/game";
				return;
			}
			// Otherwise, fall through to renderer — pass reason (legacy-save-discarded)
			// as query param if not already present. broken/version-mismatch now route
			// to #/sessions instead of #/start.
			let effectiveParams = params;
			if (!effectiveParams.get("reason")) {
				if (legacySaveDiscarded) {
					effectiveParams = new URLSearchParams(params);
					effectiveParams.set("reason", "legacy-save-discarded");
					// Reset flag once consumed
					legacySaveDiscarded = false;
				}
			}
			return renderer(root, effectiveParams);
		}

		// targetHash === "#/game"
		// Only render when the session is populated; otherwise redirect appropriately.
		if (verdict.reason !== "populated") {
			if (
				verdict.reason === "broken" ||
				verdict.reason === "version-mismatch"
			) {
				location.hash = `#/sessions?reason=${verdict.reason}`;
			} else {
				location.hash = "#/start";
			}
			return;
		}

		return renderer(root, params);
	};
}

// ── Route registration ────────────────────────────────────────────────────────

registerRoute(
	"#/start",
	withDispatcher("#/start", (root, params) => renderStart(root, params)),
);

registerRoute(
	"#/",
	withDispatcher("#/game", (root, params) => renderGame(root, params)),
);

registerRoute(
	"#/game",
	withDispatcher("#/game", (root, params) => renderGame(root, params)),
);

registerRoute(
	"#/sessions",
	withDispatcher("#/sessions", (root, params) => renderSessions(root, params)),
);

start();
initByokModal();
