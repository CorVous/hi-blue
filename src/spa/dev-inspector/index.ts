import type { GameSession } from "../game/game-session.js";
import type { PendingBootstrap } from "../game/pending-bootstrap.js";
import { getPendingCallMeta } from "../game/pending-bootstrap.js";
import { clearDaemonTurnResults, renderDaemonFooter } from "./daemon-footer.js";
import { renderGameStrip } from "./game-strip.js";
import { clearPendingStrip, renderPendingStrip } from "./pending-strip.js";
import { getMapFocus, renderWorldMap, setMapFocus } from "./world-map.js";

export interface RenderInspectorOpts {
	session?: GameSession;
	pendingBootstrap?: PendingBootstrap;
}

let escapeListenerAttached = false;

export function renderInspector(
	root: HTMLElement,
	opts: RenderInspectorOpts,
): void {
	if (!__DEV__) return;

	const doc = root.ownerDocument;
	const strip = doc.querySelector<HTMLElement>("#dev-game-strip");
	const map = doc.querySelector<HTMLElement>("#dev-world-map");
	const footers = doc.querySelectorAll<HTMLElement>(".dev-daemon-footer");

	// Branch 1: Full inspector (session exists)
	if (opts.session) {
		clearPendingStrip(strip);
		clearDaemonTurnResults();
		if (strip) strip.removeAttribute("hidden");
		if (map) map.removeAttribute("hidden");
		for (const f of footers) f.removeAttribute("hidden");
		if (strip) renderGameStrip(strip, opts.session);
		if (map) renderWorldMap(map, opts.session);

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

		// Attach Escape listener (only once per document)
		if (!escapeListenerAttached) {
			escapeListenerAttached = true;
			doc.addEventListener("keydown", (e) => {
				if (e.key === "Escape" && getMapFocus() !== null) {
					setMapFocus(null);
				}
			});
		}
		return;
	}

	// Branch 2: Pending bootstrap (no session, bootstrap in flight)
	if (opts.pendingBootstrap) {
		if (strip) {
			strip.removeAttribute("hidden");
			renderPendingStrip(strip, opts.pendingBootstrap, getPendingCallMeta());
		}
		if (map) map.setAttribute("hidden", "");
		for (const f of footers) f.setAttribute("hidden", "");
		return;
	}

	// Branch 3: No session, no pending — clear everything
	clearPendingStrip(strip);
	if (strip) {
		strip.setAttribute("hidden", "");
		strip.replaceChildren();
	}
	if (map) map.setAttribute("hidden", "");
	for (const f of footers) f.setAttribute("hidden", "");
}

/**
 * Test-only helper to reset inspector state between tests.
 */
export function __resetInspectorForTests(): void {
	escapeListenerAttached = false;
	setMapFocus(null);
}
