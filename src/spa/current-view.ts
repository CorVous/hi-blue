/**
 * current-view.ts
 *
 * Pure function that composes a dispatcher verdict with the in-memory
 * `pickerOpen` flag and decides which view to render.
 *
 * The dispatcher tells us what storage says should be on screen
 * (#/start, #/game, or #/sessions). The picker is the one screen the
 * dispatcher can't infer — it's a transient affordance triggered by the
 * sessions-icon click. This wrapper combines the two.
 *
 * Combine rule:
 *   1. If the verdict already routes to sessions (broken / version-mismatch),
 *      the picker is sticky: pickerOpen is ignored, the view stays sessions,
 *      and verdict.reason is surfaced for the banner.
 *   2. Otherwise, pickerOpen overrides the verdict's natural route to
 *      sessions, but no reason is set — the user opened it themselves.
 *   3. Otherwise, map verdict.route → view name and surface verdict.reason.
 *
 * See docs/adr/0011-remove-url-routing.md.
 */

import type {
	DispatcherReason,
	DispatcherVerdict,
} from "./persistence/active-session-dispatcher.js";

export type View = "start" | "game" | "sessions";

export interface CurrentViewInput {
	verdict: DispatcherVerdict;
	pickerOpen: boolean;
}

export interface CurrentViewResult {
	view: View;
	reason: DispatcherReason | null;
}

export function currentView(input: CurrentViewInput): CurrentViewResult {
	const { verdict, pickerOpen } = input;

	if (verdict.route === "#/sessions") {
		return { view: "sessions", reason: verdict.reason };
	}

	if (pickerOpen) {
		return { view: "sessions", reason: null };
	}

	const view: View = verdict.route === "#/game" ? "game" : "start";
	return { view, reason: verdict.reason };
}
