import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentPack } from "../game/types.js";

vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
vi.stubGlobal("__DEV__", true);

import {
	makeLocalStorageStub,
	seedSessionInStub,
} from "./fixtures/local-storage";
import { STATIC_CONTENT_PACKS } from "./fixtures/static-content-packs";
import { STATIC_PERSONAS } from "./fixtures/static-personas";

const TEST_CONTENT_PACK: ContentPack = {
	setting: "",
	weather: "",
	timeOfDay: "",
	entities: [],
	wallName: "wall",
	aiStarts: {},
};

async function buildEngineState() {
	const { startGame } = await import("../game/engine.js");
	return startGame(
		STATIC_PERSONAS,
		STATIC_CONTENT_PACKS[0] ?? TEST_CONTENT_PACK,
		{ budgetPerAi: 5, rng: () => 0 },
	);
}

vi.mock("../../content", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../content")>();
	return {
		...actual,
		generatePersonas: async () => STATIC_PERSONAS,
	};
});

vi.mock("../../content/content-pack-generator", () => ({
	generateDualContentPacks: async () => ({
		packA: STATIC_CONTENT_PACKS[0],
		packB: STATIC_CONTENT_PACKS[0],
	}),
}));

const AI_BUDGET = { remaining: 4, total: 5 };

const FAKE_GAME_STATE = {
	isComplete: true,
	outcome: "win" as const,
	personas: STATIC_PERSONAS,
	contentPack: STATIC_CONTENT_PACKS[0],
	setting: "",
	weather: "",
	timeOfDay: "",
	round: 1,
	budgets: { red: AI_BUDGET, green: AI_BUDGET, cyan: AI_BUDGET },
	conversationLogs: { red: [], green: [], cyan: [] },
	lockedOut: new Set<string>(),
	world: { entities: [] },
	personaSpatial: {},
	complicationSchedule: { countdown: 0, settingShiftFired: false },
	activeComplications: [],
};

const GAME_ENDED_RESULT = {
	result: {
		round: 1,
		actions: [],
		gameEnded: true,
	},
	completions: { red: "done", green: "done", cyan: "done" },
	nextState: FAKE_GAME_STATE,
};

vi.mock("../game/game-session.js", () => {
	class MockGameSession {
		submitMessage = vi
			.fn()
			.mockImplementation(() => Promise.resolve(GAME_ENDED_RESULT));
		getState = vi.fn().mockImplementation(() => FAKE_GAME_STATE);
		static restore = vi.fn().mockImplementation(() => ({
			submitMessage: vi
				.fn()
				.mockImplementation(() => Promise.resolve(GAME_ENDED_RESULT)),
			getState: vi.fn().mockImplementation(() => FAKE_GAME_STATE),
		}));
	}
	return { GameSession: MockGameSession };
});

const INDEX_BODY_HTML = `
<main>
  <div id="panels">
    <article class="ai-panel" data-ai="red">
      <header class="panel-header">
        <span class="panel-name"></span>
        <span class="panel-budget" data-budget=""></span>
      </header>
      <div class="transcript" data-transcript="red"></div>
    </article>
    <article class="ai-panel" data-ai="green">
      <header class="panel-header">
        <span class="panel-name"></span>
        <span class="panel-budget" data-budget=""></span>
      </header>
      <div class="transcript" data-transcript="green"></div>
    </article>
    <article class="ai-panel" data-ai="cyan">
      <header class="panel-header">
        <span class="panel-name"></span>
        <span class="panel-budget" data-budget=""></span>
      </header>
      <div class="transcript" data-transcript="cyan"></div>
    </article>
  </div>
  <form id="composer">
    <input id="prompt" type="text" placeholder="Enter a message…" autocomplete="off" />
    <button id="send" type="submit">Send</button>
  </form>
  <section id="cap-hit" hidden></section>
  <aside id="persistence-warning" hidden role="status" aria-live="polite"></aside>
</main>
<script type="module" src="./assets/index.js"></script>
`;

function getEl<T extends HTMLElement>(selector: string): T {
	const el = document.querySelector<T>(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

describe("renderGame — game_ended disables #send permanently (regression #89)", () => {
	beforeEach(async () => {
		document.body.innerHTML = INDEX_BODY_HTML;
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub, { buildState: buildEngineState });
		vi.stubGlobal("localStorage", stub);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("#send stays disabled after game_ended fires (finally block must not re-enable it)", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage finish the game";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await vi.waitFor(() => {
			expect(getEl<HTMLButtonElement>("#send").disabled).toBe(true);
		});

		const sendBtn = getEl<HTMLButtonElement>("#send");
		expect(sendBtn.disabled).toBe(true);

		const promptEl = getEl<HTMLInputElement>("#prompt");
		expect(promptEl.disabled).toBe(true);
	});
});
