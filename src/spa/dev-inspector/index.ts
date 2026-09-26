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

interface InspectorContainers {
	doc: Document;
	strip: HTMLElement | null;
	map: HTMLElement | null;
	footers: NodeListOf<HTMLElement>;
}

export function renderInspector(
	root: HTMLElement,
	opts: RenderInspectorOpts,
): void {
	if (!__DEV__) return;

	const doc = root.ownerDocument;
	const containers: InspectorContainers = {
		doc,
		strip: doc.querySelector<HTMLElement>("#dev-game-strip"),
		map: doc.querySelector<HTMLElement>("#dev-world-map"),
		footers: doc.querySelectorAll<HTMLElement>(".dev-daemon-footer"),
	};

	if (opts.session) {
		renderSessionInspector(containers, opts.session);
	} else if (opts.pendingBootstrap) {
		renderPendingBootstrapInspector(containers, opts.pendingBootstrap);
	} else {
		hideInspector(containers);
	}
}

function renderSessionInspector(
	{ doc, strip, map, footers }: InspectorContainers,
	session: GameSession,
): void {
	clearPendingStrip(strip);
	clearDaemonTurnResults();
	if (strip) strip.removeAttribute("hidden");
	if (map) map.removeAttribute("hidden");
	for (const f of footers) f.removeAttribute("hidden");
	if (strip) renderGameStrip(strip, session);
	if (map) renderWorldMap(map, session);

	const state = session.getState();
	for (const aiId of Object.keys(state.personas)) {
		const panel = doc.querySelector<HTMLElement>(
			`.ai-panel[data-ai="${aiId}"]`,
		);
		if (panel) {
			renderDaemonFooter(panel, aiId, session);
		}
	}

	attachEscapeClearsFocusOnce(doc);
}

function attachEscapeClearsFocusOnce(doc: Document): void {
	if (escapeListenerAttached) return;
	escapeListenerAttached = true;
	doc.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && getMapFocus() !== null) {
			setMapFocus(null);
		}
	});
}

function renderPendingBootstrapInspector(
	{ strip, map, footers }: InspectorContainers,
	pendingBootstrap: PendingBootstrap,
): void {
	if (strip) {
		strip.removeAttribute("hidden");
		renderPendingStrip(strip, pendingBootstrap, getPendingCallMeta());
	}
	if (map) map.setAttribute("hidden", "");
	for (const f of footers) f.setAttribute("hidden", "");
}

function hideInspector({ strip, map, footers }: InspectorContainers): void {
	clearPendingStrip(strip);
	if (strip) {
		strip.setAttribute("hidden", "");
		strip.replaceChildren();
	}
	if (map) map.setAttribute("hidden", "");
	for (const f of footers) f.setAttribute("hidden", "");
}

export function __resetInspectorForTests(): void {
	escapeListenerAttached = false;
	setMapFocus(null);
}
