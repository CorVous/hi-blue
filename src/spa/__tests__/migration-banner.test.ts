import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATIC_CONTENT_PACKS } from "./fixtures/static-content-packs";
import { STATIC_PERSONAS } from "./fixtures/static-personas";

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

const INDEX_BODY_HTML = `
<main>
  <section id="start-screen" hidden>
    <p class="start-placeholder">initialising daemon mesh&hellip;</p>
    <button id="begin" type="button" disabled>[ BEGIN ]</button>
  </section>
  <div id="phase-banner" hidden></div>
  <div id="panels" class="row">
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
    <div class="prompt-wrap">
      <div id="prompt-overlay" aria-hidden="true"></div>
      <input id="prompt" type="text" placeholder="Enter a message…" autocomplete="off" />
    </div>
    <output id="lockout-error" class="lockout-error" role="status" aria-live="polite" hidden></output>
    <button id="send" type="submit">Send</button>
  </form>
  <section id="cap-hit" hidden></section>
  <aside id="persistence-warning" hidden role="status" aria-live="polite"></aside>
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

function getMain(): HTMLElement {
	const main = document.querySelector<HTMLElement>("main");
	if (!main) throw new Error("main element not found");
	return main;
}

async function awaitIgnoringRejection(
	promise: Promise<unknown>,
): Promise<void> {
	try {
		await promise;
	} catch {}
}

describe("renderStart — legacy-save-discarded banner (via reason param)", () => {
	beforeEach(() => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		vi.stubGlobal("__DEV__", true);
		document.body.innerHTML = INDEX_BODY_HTML;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("shows legacy-save-discarded banner when reason=legacy-save-discarded is passed", async () => {
		const stub = makeLocalStorageStub({});
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		await awaitIgnoringRejection(
			renderStart(getMain(), { reason: "legacy-save-discarded" }),
		);

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toContain(
			"Saved game data from an older format has been discarded",
		);
	});

	it("does NOT show legacy banner when reason param is absent", async () => {
		const stub = makeLocalStorageStub({});
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		await awaitIgnoringRejection(renderStart(getMain()));

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(true);
	});
});

describe("session-storage — legacy save detection and deletion", () => {
	it("deleteLegacySaveKey removes the legacy key", async () => {
		const LEGACY_GAME_STATE = JSON.stringify({ schemaVersion: 5 });
		const stub = makeLocalStorageStub({ [LEGACY_KEY]: LEGACY_GAME_STATE });
		vi.stubGlobal("localStorage", stub);

		const { deleteLegacySaveKey, hasLegacySave } = await import(
			"../persistence/session-storage.js"
		);

		expect(hasLegacySave()).toBe(true);
		deleteLegacySaveKey();
		expect(stub._store[LEGACY_KEY]).toBeUndefined();
		expect(hasLegacySave()).toBe(false);

		vi.unstubAllGlobals();
	});

	it("hasLegacySave returns false when no legacy key present", async () => {
		const stub = makeLocalStorageStub({});
		vi.stubGlobal("localStorage", stub);

		const { hasLegacySave } = await import("../persistence/session-storage.js");
		expect(hasLegacySave()).toBe(false);

		vi.unstubAllGlobals();
	});

	it("mintAndActivateNewSession sets the active session pointer", async () => {
		const stub = makeLocalStorageStub({});
		vi.stubGlobal("localStorage", stub);

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);

		mintAndActivateNewSession();
		expect(stub._store[ACTIVE_KEY]).toMatch(/^0x[0-9A-F]{4}$/);

		vi.unstubAllGlobals();
	});
});
