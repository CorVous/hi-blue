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
import { getPendingBootstrap } from "./game/pending-bootstrap.js";
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
			// Stale sessions belong on the picker — never render the start screen
			// (which kicks off a bootstrap) while a broken or version-mismatch
			// session owns the active pointer.  Rendering start would let the user
			// click CONNECT and then have the bootstrap save new content under the
			// old session id.
			if (
				verdict.reason === "broken" ||
				verdict.reason === "version-mismatch"
			) {
				location.hash = `#/sessions?reason=${verdict.reason}`;
				return;
			}
			// Otherwise, fall through to renderer — pass reason (legacy-save-discarded)
			// as query param if not already present.
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
		// Render when the session is populated, OR when a fresh bootstrap is
		// in flight (the player just submitted CONNECT but content packs
		// haven't landed yet — the game route owns the progressive-loading UI).
		// Never allow a pending bootstrap to bypass a stale session redirect:
		// that would let the bootstrap overwrite the old save under the same id.
		if (verdict.reason !== "populated") {
			if (
				getPendingBootstrap() !== undefined &&
				verdict.reason !== "version-mismatch" &&
				verdict.reason !== "broken"
			) {
				return renderer(root, params);
			}
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

const sessionsIconBtn =
	document.querySelector<HTMLButtonElement>("#sessions-icon");
if (sessionsIconBtn) {
	sessionsIconBtn.addEventListener("click", () => {
		// Toggle: if already on the picker, go back to the main screen.
		// The dispatcher resolves #/game → #/start when no populated session.
		if (location.hash.startsWith("#/sessions")) {
			location.hash = "#/game";
		} else {
			location.hash = "#/sessions";
		}
	});
}

document.addEventListener("keydown", (e) => {
	if (e.key !== "Escape") return;
	if (!location.hash.startsWith("#/sessions")) return;
	const byokDialog = document.querySelector<HTMLDialogElement>("#byok-dialog");
	if (byokDialog?.open) return;
	const tag = (e.target as HTMLElement | null)?.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA") return;
	location.hash = "#/game";
});
