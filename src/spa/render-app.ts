import { currentView, type View } from "./current-view.js";
import { getPendingBootstrap } from "./game/pending-bootstrap.js";
import {
	type DispatcherReason,
	type DispatcherVerdict,
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
	schemaVersion?: number;
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

export function setBootReason(reason: RenderReason | null): void {
	pendingBootReason = reason;
}

function pendingBootstrapOwnsFreshSession(
	view: View,
	verdict: DispatcherVerdict,
): boolean {
	const sessionIsFresh =
		verdict.reason === "empty" || verdict.reason === "no-active-pointer";
	return (
		view === "start" &&
		!pickerOpen &&
		getPendingBootstrap() !== undefined &&
		sessionIsFresh
	);
}

function takeEffectiveReason(
	viewDerivedReason: RenderReason | null,
	opts: RenderOpts | undefined,
): RenderReason | null {
	if (opts && "reason" in opts) return opts.reason ?? null;
	if (pendingBootReason !== null) {
		const bootReason = pendingBootReason;
		pendingBootReason = null;
		return bootReason;
	}
	return viewDerivedReason;
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

	const derived = currentView({ verdict, pickerOpen });
	const view: View = pendingBootstrapOwnsFreshSession(derived.view, verdict)
		? "game"
		: derived.view;
	const effectiveReason = takeEffectiveReason(derived.reason, opts);

	root.dataset.view = view;
	if (effectiveReason !== null) {
		root.dataset.reason = effectiveReason;
	} else {
		delete root.dataset.reason;
	}

	let effectiveSchemaVersion: number | undefined;
	if (effectiveReason === "version-mismatch") {
		effectiveSchemaVersion = opts?.schemaVersion ?? verdict.schemaVersion;
	}

	const renderer = renderers.get(view);
	if (!renderer) return;
	return renderer(root, {
		reason: effectiveReason,
		...(effectiveSchemaVersion !== undefined
			? { schemaVersion: effectiveSchemaVersion }
			: {}),
	});
}
