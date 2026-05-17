/**
 * render-app.ts
 *
 * The single re-render primitive that replaces the hash-based router.
 * Reads the active-session pointer + load result from localStorage,
 * resolves the view via the dispatcher + currentView, and dispatches
 * to the registered renderer.
 *
 * Two pieces of in-memory state live here:
 *   - pickerOpen: whether the user has the sessions picker open. Toggled
 *     by the sessions icon and Escape; cleared by route navigations.
 *   - pendingBootReason: a one-shot reason consumed by the first renderApp
 *     call (used at boot to surface legacy-save-discarded).
 *
 * See docs/adr/0011-remove-url-routing.md.
 */

import { currentView, type View } from "./current-view.js";
import { getPendingBootstrap } from "./game/pending-bootstrap.js";
import {
	type DispatcherReason,
	dispatchActiveSession,
} from "./persistence/active-session-dispatcher.js";
import {
	getActiveSessionId,
	loadActiveSession,
	mintAndActivateNewSession,
} from "./persistence/session-storage.js";

export type RenderReason = DispatcherReason | "legacy-save-discarded" | "stuck";

export interface RenderOpts {
	reason?: RenderReason | null;
}

export type ViewRenderer = (
	root: HTMLElement,
	opts?: RenderOpts,
) => Promise<void> | void;

const renderers = new Map<View, ViewRenderer>();
let pickerOpen = false;
let pendingBootReason: RenderReason | null = null;

export function registerView(view: View, renderer: ViewRenderer): void {
	renderers.set(view, renderer);
}

export function setPickerOpen(open: boolean): void {
	pickerOpen = open;
}

export function isPickerOpen(): boolean {
	return pickerOpen;
}

export function togglePickerOpen(): void {
	pickerOpen = !pickerOpen;
}

/**
 * Stash a one-shot reason that the next renderApp call will surface as
 * its effective reason, regardless of what the dispatcher derives.
 * Used at boot for legacy-save-discarded.
 */
export function setBootReason(reason: RenderReason | null): void {
	pendingBootReason = reason;
}

export function renderApp(
	root: HTMLElement,
	opts?: RenderOpts,
): Promise<void> | void {
	let snapshot = {
		activeSessionId: getActiveSessionId(),
		loadResult: loadActiveSession(),
	};
	let verdict = dispatchActiveSession(snapshot);
	if (verdict.needsMint) {
		mintAndActivateNewSession();
		snapshot = {
			activeSessionId: getActiveSessionId(),
			loadResult: loadActiveSession(),
		};
		verdict = dispatchActiveSession(snapshot);
	}

	let { view, reason } = currentView({ verdict, pickerOpen });

	// Pending-bootstrap override: when CONNECT has been clicked and an in-flight
	// bootstrap is producing content for a freshly-minted (empty) session, the
	// game route owns the progressive-loading UI rather than bouncing to start.
	// Never override away from sticky sessions (broken / version-mismatch): a
	// pending bootstrap must not overwrite a stale session under the same id.
	if (
		view === "start" &&
		!pickerOpen &&
		getPendingBootstrap() !== undefined &&
		(verdict.reason === "empty" || verdict.reason === "no-active-pointer")
	) {
		view = "game";
	}

	// Reason precedence: explicit opts > one-shot boot reason > view-derived.
	let effectiveReason: RenderReason | null = reason;
	if (opts && "reason" in opts) {
		effectiveReason = opts.reason ?? null;
	} else if (pendingBootReason !== null) {
		effectiveReason = pendingBootReason;
		pendingBootReason = null;
	}

	root.dataset.view = view;
	if (effectiveReason !== null) {
		root.dataset.reason = effectiveReason;
	} else {
		delete root.dataset.reason;
	}

	const renderer = renderers.get(view);
	if (!renderer) return;
	return renderer(root, { reason: effectiveReason });
}
