import { describe, expect, it } from "vitest";
import { currentView } from "../current-view.js";
import type {
	DispatcherReason,
	DispatcherVerdict,
} from "../persistence/active-session-dispatcher.js";

function verdict(
	route: DispatcherVerdict["route"],
	reason: DispatcherReason,
	needsMint = false,
): DispatcherVerdict {
	return { route, reason, needsMint };
}

describe("currentView — verdict × pickerOpen truth table", () => {
	it("populated + closed → game view", () => {
		const result = currentView({
			verdict: verdict("#/game", "populated"),
			pickerOpen: false,
		});
		expect(result).toEqual({ view: "game", reason: "populated" });
	});

	it("empty + closed → start view", () => {
		const result = currentView({
			verdict: verdict("#/start", "empty"),
			pickerOpen: false,
		});
		expect(result).toEqual({ view: "start", reason: "empty" });
	});

	it("no-active-pointer + closed → start view", () => {
		const result = currentView({
			verdict: verdict("#/start", "no-active-pointer", true),
			pickerOpen: false,
		});
		expect(result).toEqual({ view: "start", reason: "no-active-pointer" });
	});

	it("broken + closed → sessions view (sticky)", () => {
		const result = currentView({
			verdict: verdict("#/sessions", "broken"),
			pickerOpen: false,
		});
		expect(result).toEqual({ view: "sessions", reason: "broken" });
	});

	it("version-mismatch + closed → sessions view (sticky)", () => {
		const result = currentView({
			verdict: verdict("#/sessions", "version-mismatch"),
			pickerOpen: false,
		});
		expect(result).toEqual({ view: "sessions", reason: "version-mismatch" });
	});

	it("populated + open → sessions view, no reason", () => {
		const result = currentView({
			verdict: verdict("#/game", "populated"),
			pickerOpen: true,
		});
		expect(result).toEqual({ view: "sessions", reason: null });
	});

	it("empty + open → sessions view, no reason", () => {
		const result = currentView({
			verdict: verdict("#/start", "empty"),
			pickerOpen: true,
		});
		expect(result).toEqual({ view: "sessions", reason: null });
	});

	it("no-active-pointer + open → sessions view, no reason", () => {
		const result = currentView({
			verdict: verdict("#/start", "no-active-pointer", true),
			pickerOpen: true,
		});
		expect(result).toEqual({ view: "sessions", reason: null });
	});

	it("broken + open → sessions view, reason still broken (sticky wins)", () => {
		const result = currentView({
			verdict: verdict("#/sessions", "broken"),
			pickerOpen: true,
		});
		expect(result).toEqual({ view: "sessions", reason: "broken" });
	});

	it("version-mismatch + open → sessions view, reason still version-mismatch (sticky wins)", () => {
		const result = currentView({
			verdict: verdict("#/sessions", "version-mismatch"),
			pickerOpen: true,
		});
		expect(result).toEqual({
			view: "sessions",
			reason: "version-mismatch",
		});
	});
});
