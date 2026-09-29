import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startGame } from "../game/engine.js";
import type { GameState } from "../game/types.js";
import { type SessionSave, showEndgame } from "../views/game-endgame.js";
import { installLocalStorageStub } from "./fixtures/local-storage";
import { STATIC_CONTENT_PACKS } from "./fixtures/static-content-packs";
import { STATIC_PERSONAS } from "./fixtures/static-personas";

vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");

const ENDGAME_HTML = `
<main data-view="game">
  <div id="panels"></div>
  <form id="composer"></form>
  <section id="cap-hit" hidden></section>
  <section id="endgame" hidden>
    <div id="endgame-subtitle"></div>
    <div id="endgame-final-round" hidden>
      <div id="endgame-final-lines"></div>
    </div>
    <button type="button" id="endgame-new-daemons-btn">new</button>
    <button type="button" id="endgame-same-daemons-btn">same</button>
    <button type="button" id="endgame-continue-btn" hidden>continue</button>
    <output id="endgame-choice-status"></output>
    <button type="button" id="download-ais-btn">Download AIs</button>
    <output id="download-status"></output>
    <input type="text" id="diagnostics-summary" />
    <button type="button" id="submit-diagnostics-btn">Submit diagnostics</button>
    <output id="diagnostics-status"></output>
  </section>
</main>
`;

const UNSAVED: SessionSave = { sessionId: null, lastSavedAt: null };

function endedGame(): GameState {
	const pack = STATIC_CONTENT_PACKS[0];
	if (!pack) throw new Error("test: no static content pack");
	return {
		...startGame(STATIC_PERSONAS, pack, { budgetPerAi: 5, rng: () => 0 }),
		isComplete: true,
		outcome: "win",
	};
}

function button(selector: string): HTMLButtonElement {
	const el = document.querySelector<HTMLButtonElement>(selector);
	if (!el) throw new Error(`test: missing ${selector}`);
	return el;
}

function root(): HTMLElement {
	const el = document.querySelector<HTMLElement>("main");
	if (!el) throw new Error("test: missing main");
	return el;
}

function show(state: GameState, save: SessionSave): void {
	showEndgame(root(), state, save, () => undefined);
}

function useBothControls(): void {
	button("#download-ais-btn").click();
	const summary = document.querySelector<HTMLInputElement>(
		"#diagnostics-summary",
	);
	if (summary) summary.value = "curious";
	button("#submit-diagnostics-btn").click();
}

function controlsUsed(): { download: boolean; diagnostics: boolean } {
	return {
		download: button("#download-ais-btn").disabled,
		diagnostics: button("#submit-diagnostics-btn").disabled,
	};
}

describe("showEndgame — download and diagnostics belong to one ended game", () => {
	beforeEach(() => {
		installLocalStorageStub();
		document.body.innerHTML = ENDGAME_HTML;
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
		vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("keeps both controls used when the same unsaved game is shown again", () => {
		const game = endedGame();
		show(game, UNSAVED);
		useBothControls();

		show(game, UNSAVED);

		expect(controlsUsed()).toEqual({ download: true, diagnostics: true });
	});

	it("starts a later unsaved game with both controls fresh", () => {
		show(endedGame(), UNSAVED);
		useBothControls();

		show(endedGame(), UNSAVED);

		expect(controlsUsed()).toEqual({ download: false, diagnostics: false });
		expect(document.querySelector("#download-status")?.textContent).toBe("");
	});

	it("keeps both controls used when the same save is restored again", () => {
		const save = { sessionId: "0xAAAA", lastSavedAt: "2026-01-01T00:00:00Z" };
		show(endedGame(), save);
		useBothControls();

		show(endedGame(), { ...save });

		expect(controlsUsed()).toEqual({ download: true, diagnostics: true });
	});

	it("starts a later game that ended under the same session id fresh", () => {
		show(endedGame(), {
			sessionId: "0xBBBB",
			lastSavedAt: "2026-01-01T00:00:00Z",
		});
		useBothControls();

		show(endedGame(), {
			sessionId: "0xBBBB",
			lastSavedAt: "2026-01-02T00:00:00Z",
		});

		expect(controlsUsed()).toEqual({ download: false, diagnostics: false });
	});
});
