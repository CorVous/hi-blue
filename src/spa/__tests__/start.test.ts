/**
 * start.test.ts
 *
 * Unit tests for the renderStart() route renderer (routes/start.ts).
 *
 * Covers:
 *  - Generation kicks off on mount; BEGIN starts disabled
 *  - BEGIN becomes enabled after generation resolves
 *  - BEGIN click calls saveActiveSession and navigates to #/game
 *  - CapHitError → #cap-hit visible, #start-screen hidden
 *  - reason=broken / version-mismatch banner text
 *  - reason=legacy-save-discarded banner text (see also migration-banner.test.ts)
 *  - No reason param → no banner
 *
 * Issue #173 (parent #155).
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

// ── HTML fixture ──────────────────────────────────────────────────────────────

const INDEX_BODY_HTML = `
<main>
  <section id="start-screen" hidden>
    <p class="start-placeholder">initialising daemon mesh&hellip;</p>
    <button id="begin" type="button" disabled>[ BEGIN ]</button>
  </section>
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
  <section id="endgame" hidden></section>
</main>
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("renderStart — screen visibility", () => {
	beforeEach(() => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("shows #start-screen and hides #panels and #composer on mount", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		try {
			await renderStart(getMain(), new URLSearchParams());
		} catch {
			// generation may reject in test environment — ok
		}

		const startScreen = document.querySelector<HTMLElement>("#start-screen");
		const panelsEl = document.querySelector<HTMLElement>("#panels");
		const composerEl = document.querySelector<HTMLElement>("#composer");

		expect(startScreen?.hasAttribute("hidden")).toBe(false);
		expect(panelsEl?.hasAttribute("hidden")).toBe(true);
		expect(composerEl?.hasAttribute("hidden")).toBe(true);
	});
});

describe("renderStart — BEGIN button state", () => {
	beforeEach(() => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("BEGIN is disabled at mount while generation is in flight", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		// renderStart kicks off generation and returns a promise. Before the
		// promise settles, BEGIN must be disabled. We check the synchronous
		// post-mount state by starting the render but not awaiting it yet.
		const renderPromise = renderStart(getMain(), new URLSearchParams());

		// Immediately after mount (generation promise is in flight), BEGIN is disabled
		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		expect(beginBtn?.disabled).toBe(true);

		// Clean up — let generation finish
		try {
			await renderPromise;
		} catch {
			// ok
		}
	});

	it("BEGIN becomes enabled after generation resolves successfully", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		await renderStart(getMain(), new URLSearchParams());

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		expect(beginBtn?.disabled).toBe(false);
	});
});

describe("renderStart — BEGIN click saves session and navigates", () => {
	beforeEach(() => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("BEGIN click sets location.hash to #/game", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		await renderStart(getMain(), new URLSearchParams());

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		expect(beginBtn?.disabled).toBe(false);

		// Click BEGIN — start.ts will call saveActiveSession then set location.hash
		beginBtn?.click();

		expect(location.hash).toBe("#/game");
	});

	it("BEGIN click is idempotent: button is disabled after first click", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		await renderStart(getMain(), new URLSearchParams());

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		beginBtn?.click();
		beginBtn?.click();

		// After first click, _beginClickPending=true and btn.disabled=true; second is no-op.
		expect(beginBtn?.disabled).toBe(true);
	});
});

describe("renderStart — CapHitError handling", () => {
	beforeEach(() => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("shows #cap-hit and hides #start-screen when generateNewGameAssets throws CapHitError", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();

		// Override the bootstrap module so generateNewGameAssets throws CapHitError
		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			const { CapHitError } = await import("../llm-client.js");
			return {
				...actual,
				generateNewGameAssets: async () => {
					throw new CapHitError({
						message: "rate limit",
						reason: "per-ip-daily",
						retryAfterSec: 86400,
					});
				},
			};
		});

		// Re-import after doMock so the mock takes effect
		const { renderStart } = await import("../routes/start.js");

		try {
			await renderStart(getMain(), new URLSearchParams());
		} catch {
			// renderStart re-throws generation errors — expected
		}

		const capHitEl = document.querySelector<HTMLElement>("#cap-hit");
		const startScreenEl = document.querySelector<HTMLElement>("#start-screen");

		expect(capHitEl?.hasAttribute("hidden")).toBe(false);
		expect(startScreenEl?.hidden).toBe(true);
	});
});

describe("renderStart — persistence warning banners", () => {
	beforeEach(() => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("shows 'broken' banner text when reason=broken", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		try {
			await renderStart(getMain(), new URLSearchParams("reason=broken"));
		} catch {
			// ok
		}

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toContain(
			"Saved game data was unreadable and has been discarded",
		);
	});

	it("shows 'version-mismatch' banner text when reason=version-mismatch", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		try {
			await renderStart(
				getMain(),
				new URLSearchParams("reason=version-mismatch"),
			);
		} catch {
			// ok
		}

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toContain(
			"Saved game data is from an older version and has been discarded",
		);
	});

	it("shows 'legacy-save-discarded' banner text when reason=legacy-save-discarded", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		try {
			await renderStart(
				getMain(),
				new URLSearchParams("reason=legacy-save-discarded"),
			);
		} catch {
			// ok
		}

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toContain(
			"Saved game data from an older format has been discarded",
		);
	});

	it("shows no banner when reason param is absent", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		try {
			await renderStart(getMain(), new URLSearchParams());
		} catch {
			// ok
		}

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(true);
	});

	it("shows fallback banner text for an unknown reason string", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		try {
			await renderStart(
				getMain(),
				new URLSearchParams("reason=totally-unknown"),
			);
		} catch {
			// ok
		}

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		// Fallback message includes the unknown reason string
		expect(warningEl?.textContent).toContain("totally-unknown");
	});
});
