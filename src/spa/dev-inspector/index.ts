import type { GameSession } from "../game/game-session.js";
import type { PendingBootstrap } from "../game/pending-bootstrap.js";
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

	const doc = root.ownerDocument;
	const strip = doc.querySelector<HTMLElement>("#dev-game-strip");
	const map = doc.querySelector<HTMLElement>("#dev-world-map");
	if (strip) strip.removeAttribute("hidden");
	if (map) map.removeAttribute("hidden");
	const footers = doc.querySelectorAll<HTMLElement>(".dev-daemon-footer");
	for (const f of footers) f.removeAttribute("hidden");
	if (strip && opts.session) renderGameStrip(strip, opts.session);
}
