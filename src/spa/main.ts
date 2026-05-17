/**
 * main.ts
 *
 * SPA entry point. Registers the three view renderers with render-app, then
 * does the one boot render. All subsequent rerenders are driven by routes
 * calling renderApp directly.
 *
 * See docs/adr/0011-remove-url-routing.md.
 */

import "./styles.css";
import { initByokModal } from "./byok-modal.js";
import {
	deleteLegacySaveKey,
	getActiveSessionId,
	hasLegacySave,
} from "./persistence/session-storage.js";
import {
	isPickerOpen,
	registerView,
	renderApp,
	setBootReason,
	setPickerOpen,
	togglePickerOpen,
} from "./render-app.js";
import { renderGame } from "./routes/game.js";
import { renderSessions } from "./routes/sessions.js";
import { renderStart } from "./routes/start.js";

// One-time legacy-save check at boot: if the old single-key save exists and
// no active-session pointer is set, discard the legacy save and stash the
// reason for the first renderApp call to surface.
try {
	if (hasLegacySave() && getActiveSessionId() === null) {
		deleteLegacySaveKey();
		setBootReason("legacy-save-discarded");
	}
} catch {
	// localStorage unavailable — silently skip.
}

registerView("start", renderStart);
registerView("game", renderGame);
registerView("sessions", renderSessions);

const rootEl = document.querySelector<HTMLElement>("main");
if (!rootEl) {
	throw new Error('main: root element "main" not found');
}

renderApp(rootEl);
initByokModal();

const sessionsIconBtn =
	document.querySelector<HTMLButtonElement>("#sessions-icon");
if (sessionsIconBtn) {
	sessionsIconBtn.addEventListener("click", () => {
		togglePickerOpen();
		renderApp(rootEl);
	});
}

document.addEventListener("keydown", (e) => {
	if (e.key !== "Escape") return;
	if (!isPickerOpen()) return;
	const byokDialog = document.querySelector<HTMLDialogElement>("#byok-dialog");
	if (byokDialog?.open) return;
	const tag = (e.target as HTMLElement | null)?.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA") return;
	setPickerOpen(false);
	renderApp(rootEl);
});
