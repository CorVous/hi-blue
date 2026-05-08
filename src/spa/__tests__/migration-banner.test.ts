/**
 * migration-banner.test.ts
 *
 * Tests that the legacy-save-discarded banner is shown exactly once when
 * the old `hi-blue-game-state` key is present on first load, and is not
 * shown on subsequent loads (because the legacy key is deleted after display).
 *
 * Part of issue #172 (step 7 of plan).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATIC_CONTENT_PACKS } from "./fixtures/static-content-packs";
import { STATIC_PERSONAS } from "./fixtures/static-personas";

// Pin generatePersonas to static fixture (no LLM call in tests).
vi.mock("../../content", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../content")>();
	return {
		...actual,
		generatePersonas: async () => STATIC_PERSONAS,
	};
});

// Pin generateContentPacks to static content packs (no LLM call in tests).
vi.mock("../../content/content-pack-generator", () => ({
	generateContentPacks: async () => STATIC_CONTENT_PACKS,
}));

const INDEX_BODY_HTML = `
<main>
  <div id="phase-banner" hidden></div>
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
    <article class="ai-panel" data-ai="blue">
      <header class="panel-header">
        <span class="panel-name"></span>
        <span class="panel-budget" data-budget=""></span>
      </header>
      <div class="transcript" data-transcript="blue"></div>
    </article>
  </div>
  <form id="composer">
    <div class="prompt-wrap">
      <div id="prompt-overlay" aria-hidden="true"></div>
      <input id="prompt" type="text" placeholder="Enter a message…" autocomplete="off" />
    </div>
    <output id="lockout-error" class="lockout-error" role="status" aria-live="polite" hidden></output>
    <button id="send" type="submit">Send</button>
  </form>
  <section id="cap-hit" hidden></section>
  <aside id="persistence-warning" hidden role="status" aria-live="polite"></aside>
  <aside id="action-log" hidden>
    <h3>Action Log (debug)</h3>
    <ul id="action-log-list"></ul>
  </aside>
  <section id="endgame" hidden>
    <h2>hi-blue — endgame</h2>
    <div id="endgame-subtitle">The three phases are complete. The room is still.</div>
    <div class="endgame-section">
      <h3>Save the AIs to USB</h3>
      <button type="button" id="download-ais-btn">Download AIs</button>
      <output id="download-status" aria-live="polite"></output>
    </div>
    <div class="endgame-section">
      <h3>Submit anonymous diagnostics</h3>
      <input type="text" id="diagnostics-summary" placeholder="one word (e.g. curious)" maxlength="30" />
      <button type="button" id="submit-diagnostics-btn">Submit diagnostics</button>
      <output id="diagnostics-status" aria-live="polite"></output>
    </div>
  </section>
</main>
<script type="module" src="./assets/index.js"></script>
`;

const LEGACY_KEY = "hi-blue-game-state";
const ACTIVE_KEY = "hi-blue:active-session";

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

const LEGACY_GAME_STATE = JSON.stringify({
	schemaVersion: 5,
	savedAt: new Date().toISOString(),
	game: {
		currentPhase: 1,
		isComplete: false,
		personas: {},
		phases: [],
		contentPacks: [],
	},
});

// Minimal fetch mock (no actual HTTP calls needed for migration banner test)
function makeFetchMock(): typeof fetch {
	// Return a non-terminated stream that never resolves (we don't need to submit)
	return vi.fn().mockResolvedValue({
		ok: true,
		body: {
			getReader: () => ({
				read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
				releaseLock: vi.fn(),
			}),
		},
	}) as unknown as typeof fetch;
}

function getMain(): HTMLElement {
	const main = document.querySelector<HTMLElement>("main");
	if (!main) throw new Error("main element not found");
	return main;
}

describe("renderGame — migration banner (legacy-save-discarded)", () => {
	beforeEach(() => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("shows legacy-save-discarded banner when hi-blue-game-state is present and active-session is absent", async () => {
		// Setup: legacy save present, no active session pointer
		const stub = makeLocalStorageStub({
			[LEGACY_KEY]: LEGACY_GAME_STATE,
		});
		vi.stubGlobal("localStorage", stub);
		vi.stubGlobal("fetch", makeFetchMock());
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getMain());

		// Banner should be visible with the legacy-save-discarded message
		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toContain(
			"Saved game data from an older format has been discarded",
		);
	});

	it("deletes the legacy key after showing the banner", async () => {
		const stub = makeLocalStorageStub({
			[LEGACY_KEY]: LEGACY_GAME_STATE,
		});
		vi.stubGlobal("localStorage", stub);
		vi.stubGlobal("fetch", makeFetchMock());
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getMain());

		// Legacy key should be gone after boot
		expect(stub._store[LEGACY_KEY]).toBeUndefined();
	});

	it("sets active session pointer after discarding legacy save", async () => {
		const stub = makeLocalStorageStub({
			[LEGACY_KEY]: LEGACY_GAME_STATE,
		});
		vi.stubGlobal("localStorage", stub);
		vi.stubGlobal("fetch", makeFetchMock());
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getMain());

		// Active session pointer should be set
		expect(stub._store[ACTIVE_KEY]).toMatch(/^0x[0-9A-F]{4}$/);
	});

	it("does NOT show banner on second load when legacy key is gone", async () => {
		// First load: legacy key present
		const stub = makeLocalStorageStub({
			[LEGACY_KEY]: LEGACY_GAME_STATE,
		});
		vi.stubGlobal("localStorage", stub);
		vi.stubGlobal("fetch", makeFetchMock());
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame: renderGame1 } = await import("../routes/game.js");
		await renderGame1(getMain());

		// Verify first load showed banner and deleted legacy key
		expect(stub._store[LEGACY_KEY]).toBeUndefined();
		const firstWarning = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(firstWarning?.hasAttribute("hidden")).toBe(false);

		// Second load: simulate page refresh (legacy key is gone)
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.resetModules();
		const { renderGame: renderGame2 } = await import("../routes/game.js");
		await renderGame2(getMain());

		// Banner should NOT be shown this time (legacy key gone, active session set)
		const secondWarning = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(secondWarning?.hasAttribute("hidden")).toBe(true);
	});

	it("does NOT show legacy banner when no legacy key exists (fresh install)", async () => {
		// No legacy key, no active session
		const stub = makeLocalStorageStub({});
		vi.stubGlobal("localStorage", stub);
		vi.stubGlobal("fetch", makeFetchMock());
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getMain());

		// Banner should NOT be shown
		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(true);
	});
});
