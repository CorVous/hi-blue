import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentPack } from "../game/types.js";

vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
vi.stubGlobal("__DEV__", true);

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

function makeLocalStorageStub(initialData: Record<string, string> = {}) {
	const store: Record<string, string> = { ...initialData };
	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			for (const k of Object.keys(store)) delete store[k];
		}),
		get length() {
			return Object.keys(store).length;
		},
		key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
		_store: store,
	};
}

async function seedSessionInStub(
	stub: ReturnType<typeof makeLocalStorageStub>,
): Promise<void> {
	const { startGame } = await import("../game/engine.js");
	const { mintAndActivateNewSession, saveActiveSession } = await import(
		"../persistence/session-storage.js"
	);
	const prev = globalThis.localStorage;
	Object.defineProperty(globalThis, "localStorage", {
		value: stub,
		writable: true,
		configurable: true,
	});
	try {
		mintAndActivateNewSession();
		const gameState = startGame(
			STATIC_PERSONAS,
			STATIC_CONTENT_PACKS[0] ?? TEST_CONTENT_PACK,
			{ budgetPerAi: 5, rng: () => 0 },
		);
		saveActiveSession(gameState);
	} finally {
		Object.defineProperty(globalThis, "localStorage", {
			value: prev,
			writable: true,
			configurable: true,
		});
	}
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
		await seedSessionInStub(stub);
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
