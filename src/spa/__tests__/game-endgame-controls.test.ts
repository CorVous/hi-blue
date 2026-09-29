import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOTSTRAP_LOADING_TIMEOUT_MS } from "../game/bootstrap.js";
import { startGame } from "../game/engine.js";
import type { GameState } from "../game/types.js";
import {
	saveActiveSession,
	setActiveSessionId,
} from "../persistence/session-storage.js";
import { type SessionSave, showEndgame } from "../views/game-endgame.js";
import { installLocalStorageStub } from "./fixtures/local-storage";
import {
	STATIC_CONTENT_PACKS,
	STATIC_OBJECTIVE_TYPES,
} from "./fixtures/static-content-packs";
import { STATIC_PERSONAS } from "./fixtures/static-personas";

const generateDualContentPacks = vi.hoisted(() => vi.fn());

vi.mock("../../content/content-pack-generator", () => ({
	generateDualContentPacks,
}));

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
  <aside id="persistence-warning" hidden></aside>
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

describe("showEndgame — a choice that outlives the endgame screen", () => {
	beforeEach(() => {
		installLocalStorageStub();
		document.body.innerHTML = ENDGAME_HTML;
		generateDualContentPacks.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("leaves the room another tab continued alone when a stale Continue lands after the endgame was replaced", async () => {
		const sessionId = "0xCCCC";
		const game = endedGame();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		setActiveSessionId(sessionId);
		const firstSave = saveActiveSession(game, { sessionId });
		if (!firstSave.ok) throw new Error("test: could not save the ended game");
		let releasePacks: () => void = () => undefined;
		generateDualContentPacks.mockReturnValue(
			new Promise((resolve) => {
				releasePacks = () =>
					resolve({
						packA: STATIC_CONTENT_PACKS[0],
						packB: STATIC_CONTENT_PACKS[0],
						objectiveTypes: STATIC_OBJECTIVE_TYPES,
					});
			}),
		);
		const releaseEndedGame = vi.fn();
		showEndgame(
			root(),
			game,
			{ sessionId, lastSavedAt: firstSave.lastSavedAt },
			releaseEndedGame,
		);

		button("#endgame-continue-btn").click();
		await vi.waitFor(() => expect(generateDualContentPacks).toHaveBeenCalled());
		vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
		const otherTabSave = saveActiveSession(
			{ ...game, isComplete: false },
			{ sessionId, createdAt: "2026-01-01T00:00:00.000Z" },
		);
		if (!otherTabSave.ok) throw new Error("test: other tab could not save");
		setHiddenEndgame();
		releasePacks();

		await vi.waitFor(() =>
			expect(
				document.querySelector<HTMLElement>("#persistence-warning")?.hidden,
			).toBe(false),
		);
		expect(releaseEndedGame).not.toHaveBeenCalled();
		expect(root().dataset.view).toBe("game");
	});

	it("gives up on a same-daemons build that never finishes and offers the choices again", async () => {
		vi.useFakeTimers();
		generateDualContentPacks.mockReturnValue(new Promise(() => undefined));
		show(endedGame(), UNSAVED);

		button("#endgame-same-daemons-btn").click();
		await vi.waitFor(() => expect(generateDualContentPacks).toHaveBeenCalled());
		expect(button("#endgame-new-daemons-btn").disabled).toBe(true);
		const provider = generateDualContentPacks.mock.calls[0]?.[3] as {
			signal?: AbortSignal;
		};

		await vi.advanceTimersByTimeAsync(BOOTSTRAP_LOADING_TIMEOUT_MS + 1);

		expect(document.querySelector("#endgame-choice-status")?.textContent).toBe(
			"could not spin up a new room: content-pack generation timed out",
		);
		expect(provider.signal?.aborted).toBe(true);
		for (const selector of [
			"#endgame-new-daemons-btn",
			"#endgame-same-daemons-btn",
			"#endgame-continue-btn",
		]) {
			expect(button(selector).disabled).toBe(false);
		}
	});
});

function setHiddenEndgame(): void {
	const endgameEl = document.querySelector<HTMLElement>("#endgame");
	if (endgameEl) endgameEl.hidden = true;
}
