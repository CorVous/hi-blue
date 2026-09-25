import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATIC_CONTENT_PACKS } from "../../__tests__/fixtures/static-content-packs";
import { STATIC_PERSONAS } from "../../__tests__/fixtures/static-personas";
import { GameSession } from "../../game/game-session";
import { __resetInspectorForTests, renderInspector } from "../index";

function inspectorShell(): void {
	document.body.innerHTML = `
		<div id="dev-game-strip" hidden></div>
		<div id="dev-world-map" hidden></div>
		<article class="ai-panel" data-ai="red">
			<div class="dev-daemon-footer" hidden></div>
		</article>
	`;
}

function buildSession(): GameSession {
	const contentPack = STATIC_CONTENT_PACKS[0];
	if (!contentPack) throw new Error("Content pack missing");
	return new GameSession(contentPack, STATIC_PERSONAS);
}

describe("dev inspector gating", () => {
	beforeEach(() => {
		__resetInspectorForTests();
		inspectorShell();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.stubGlobal("__DEV__", true);
		__resetInspectorForTests();
	});

	it("renderInspector paints nothing when __DEV__ is false (session branch)", () => {
		vi.stubGlobal("__DEV__", false);

		renderInspector(document.body, { session: buildSession() });

		expect(document.querySelector(".dev-map-grid")).toBeNull();
		expect(document.querySelectorAll(".dev-map-cell").length).toBe(0);
		expect(
			document.getElementById("dev-world-map")?.hasAttribute("hidden"),
		).toBe(true);
		expect(
			document.querySelector(".dev-daemon-footer")?.hasAttribute("hidden"),
		).toBe(true);
		expect(
			document.getElementById("dev-game-strip")?.hasAttribute("hidden"),
		).toBe(true);
	});

	it("renderInspector paints nothing when __DEV__ is false (pending branch)", () => {
		vi.stubGlobal("__DEV__", false);

		renderInspector(document.body, {
			pendingBootstrap: {
				firstRoundPromise: Promise.resolve([]),
				contentPacksPromise: Promise.resolve([]),
			} as never,
		});

		expect(document.querySelector(".dev-map-grid")).toBeNull();
		expect(
			document.getElementById("dev-game-strip")?.hasAttribute("hidden"),
		).toBe(true);
		expect(
			document.getElementById("dev-world-map")?.hasAttribute("hidden"),
		).toBe(true);
	});

	it("renderInspector still paints when __DEV__ is true", () => {
		renderInspector(document.body, { session: buildSession() });

		expect(document.querySelectorAll(".dev-map-cell").length).toBe(25);
		expect(
			document.getElementById("dev-world-map")?.hasAttribute("hidden"),
		).toBe(false);
	});

	it("no focus control renders when __DEV__ is false", () => {
		vi.stubGlobal("__DEV__", false);

		renderInspector(document.body, { session: buildSession() });

		expect(document.querySelector('[data-field="focus-vista"]')).toBeNull();
		expect(document.querySelectorAll("[data-vista-focus]").length).toBe(0);
	});
});
