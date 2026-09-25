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
