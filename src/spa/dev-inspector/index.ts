import type { GameSession } from "../game/game-session.js";
import type { PendingBootstrap } from "../game/pending-bootstrap.js";
import { clearDaemonTurnResults, renderDaemonFooter } from "./daemon-footer.js";
import { renderGameStrip } from "./game-strip.js";

export interface RenderInspectorOpts {
	session?: GameSession;
	pendingBootstrap: PendingBootstrap | undefined;
}

export function renderInspector(
	root: HTMLElement,
	opts: RenderInspectorOpts,
): void {
	if (!__DEV__) return;
	if (!opts.session) return;

	// Clear stale daemon turn results from previous sessions
	clearDaemonTurnResults();

	const doc = root.ownerDocument;
	const strip = doc.querySelector<HTMLElement>("#dev-game-strip");
	const map = doc.querySelector<HTMLElement>("#dev-world-map");
	if (strip) strip.removeAttribute("hidden");
	if (map) map.removeAttribute("hidden");
	const footers = doc.querySelectorAll<HTMLElement>(".dev-daemon-footer");
	for (const f of footers) f.removeAttribute("hidden");
	if (strip && opts.session) renderGameStrip(strip, opts.session);

	// Render per-Daemon footers for each AI
	const state = opts.session.getState();
	for (const aiId of Object.keys(state.personas)) {
		const panel = doc.querySelector<HTMLElement>(
			`.ai-panel[data-ai="${aiId}"]`,
		);
		if (panel) {
			renderDaemonFooter(panel, aiId, opts.session);
		}
	}
}
