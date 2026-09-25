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
import { renderGame } from "./views/game.js";
import { renderSessions } from "./views/sessions.js";
import { renderStart } from "./views/start.js";

function discardOrphanedLegacySave(): void {
	if (hasLegacySave() && getActiveSessionId() === null) {
		deleteLegacySaveKey();
		setBootReason("legacy-save-discarded");
	}
}

discardOrphanedLegacySave();

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
