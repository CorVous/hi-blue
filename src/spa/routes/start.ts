/**
 * start.ts
 *
 * Route renderer for #/start.
 *
 * Responsibilities:
 *   - Show #start-screen, hide #panels and #composer.
 *   - Show a persistence-warning banner when ?reason=broken|version-mismatch|
 *     legacy-save-discarded is present.
 *   - Kick off generateNewGameAssets() on mount; BEGIN starts disabled.
 *   - On success → enable BEGIN and hold assets in module scope.
 *   - On failure (CapHitError or any error) → show #cap-hit, hide #start-screen.
 *   - BEGIN click → buildSessionFromAssets, applyTestAffordances, saveActiveSession,
 *     then location.hash = "#/game". Idempotent against double-click.
 *
 * Issue #173 (parent #155).
 */

import {
	buildSessionFromAssets,
	type ContentPackProvider,
	generateNewGameAssets,
	type NewGameAssets,
	type SynthesisProvider,
} from "../game/bootstrap.js";
import { saveActiveSession } from "../persistence/session-storage.js";
import { applyTestAffordances } from "./game.js";

/** Warning reason strings shown in the persistence warning banner. */
export const PERSISTENCE_WARNING_MESSAGES: Record<string, string> = {
	broken:
		"Saved game data was unreadable and has been discarded. Starting a new game.",
	"version-mismatch":
		"Saved game data is from an older version and has been discarded. Starting a new game.",
	"legacy-save-discarded":
		"Saved game data from an older format has been discarded. Starting a new game.",
};

/**
 * Injection points for testing (not used in production).
 * Callers can provide alternative providers via the params sentinel trick:
 * we expose a module-level override hook used by tests.
 */
export interface StartTestOverrides {
	synthesis?: SynthesisProvider;
	packProvider?: ContentPackProvider;
	rng?: () => number;
}

/** Module-level test overrides — set by tests, cleared after each render. */
let _testOverrides: StartTestOverrides | undefined;

export function _setTestOverrides(
	overrides: StartTestOverrides | undefined,
): void {
	_testOverrides = overrides;
}

/** Module-level pending assets holder. Cleared on each render call. */
let _pendingAssets: NewGameAssets | undefined;
let _beginClickPending = false;

export function renderStart(
	root: HTMLElement,
	params?: URLSearchParams,
): Promise<void> {
	const doc = root.ownerDocument;

	// Hide panels, composer, and sessions screen; show start screen
	const startScreenEl = doc.querySelector<HTMLElement>("#start-screen");
	const panelsEl = doc.querySelector<HTMLElement>("#panels");
	const composerEl = doc.querySelector<HTMLElement>("#composer");
	const sessionsScreenEl = doc.querySelector<HTMLElement>("#sessions-screen");

	if (panelsEl) panelsEl.hidden = true;
	if (composerEl) composerEl.hidden = true;
	if (sessionsScreenEl) sessionsScreenEl.hidden = true;
	if (startScreenEl) startScreenEl.hidden = false;

	// Show persistence warning if reason param is present
	const reason = params?.get("reason") ?? null;
	if (reason) {
		const persistenceWarningEl = doc.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		if (persistenceWarningEl) {
			const msg =
				PERSISTENCE_WARNING_MESSAGES[reason] ??
				`Saved game data could not be loaded (${reason}). Starting a new game.`;
			persistenceWarningEl.textContent = msg;
			persistenceWarningEl.removeAttribute("hidden");
		}
	}

	const beginBtn = doc.querySelector<HTMLButtonElement>("#begin");
	if (!beginBtn) return Promise.resolve();

	// Reset module-level state on each render call
	_pendingAssets = undefined;
	_beginClickPending = false;
	beginBtn.disabled = true;

	// Merge hash-query-string params with location.search so ?winImmediately=1 etc. work
	const effectiveParams = new URLSearchParams(
		typeof location !== "undefined" ? location.search : "",
	);
	if (params) {
		for (const [k, v] of params) effectiveParams.set(k, v);
	}

	// BEGIN click handler — idempotent, requires assets to be ready
	beginBtn.addEventListener("click", () => {
		if (_beginClickPending) return;
		if (!_pendingAssets) return;
		_beginClickPending = true;
		beginBtn.disabled = true;

		const assets = _pendingAssets;
		let session = buildSessionFromAssets(assets);
		session = applyTestAffordances(session, effectiveParams);

		const saveResult = saveActiveSession(session.getState());
		if (!saveResult.ok) {
			// Surface save failure via persistence warning but still navigate
			const persistenceWarningEl = doc.querySelector<HTMLElement>(
				"#persistence-warning",
			);
			if (persistenceWarningEl) {
				persistenceWarningEl.textContent =
					"Game progress cannot be saved: storage is full or disabled.";
				persistenceWarningEl.removeAttribute("hidden");
			}
		}

		// Navigate to game regardless of save result (game.ts will handle missing session)
		location.hash = "#/game";
	});

	// Kick off generation
	const generationPromise = (async () => {
		try {
			const assets = await generateNewGameAssets(_testOverrides);
			_pendingAssets = assets;
			beginBtn.disabled = false;
		} catch (err) {
			// Funnel failure to #cap-hit (same UX as game-route CapHitError)
			const capHitEl = doc.querySelector<HTMLElement>("#cap-hit");
			if (capHitEl) capHitEl.removeAttribute("hidden");
			if (startScreenEl) startScreenEl.setAttribute("hidden", "");
			// Re-throw so callers can observe the failure
			throw err;
		} finally {
			// Clear test overrides after each render cycle
			_testOverrides = undefined;
		}
	})();

	return generationPromise;
}
