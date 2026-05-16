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

// Pin generateDualContentPacks to static content packs (no LLM call in tests).
vi.mock("../../content/content-pack-generator", () => ({
	generateDualContentPacks: async () => ({
		packA: STATIC_CONTENT_PACKS[0],
		packB: STATIC_CONTENT_PACKS[0],
	}),
	generateContentPack: async () => STATIC_CONTENT_PACKS[0],
}));

// ── HTML fixture ──────────────────────────────────────────────────────────────

const INDEX_BODY_HTML = `
<main>
  <section id="start-screen" hidden>
    <pre id="dial" class="dial"></pre>
    <div id="login-reveal" class="login-reveal" hidden>
      <pre id="login-keyart" class="login-keyart"></pre>
      <form id="login-form" autocomplete="off">
        <div class="login-field">
          <label for="password">password:</label>
          <input id="password" type="text" autocomplete="off" data-real="" />
          <button id="begin" class="login-connect" type="submit" disabled>[ CONNECT ]</button>
        </div>
        <output id="login-error" hidden></output>
      </form>
      <pre id="login-postlog" class="dial"></pre>
    </div>
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
		vi.stubGlobal("__DEV__", true);
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
			await renderStart(getMain(), new URLSearchParams("skipDialup=1"));
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
		vi.stubGlobal("__DEV__", true);
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("BEGIN is enabled as soon as the login form reveals — generation runs in the background", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		// renderStart kicks off generation and returns a promise. With skipDialup,
		// the login form reveals synchronously; BEGIN should be available
		// immediately so the player can click through to the progressive-loading
		// game route while content packs are still resolving.
		const renderPromise = renderStart(
			getMain(),
			new URLSearchParams("skipDialup=1"),
		);

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		expect(beginBtn?.disabled).toBe(false);

		// Clean up — let generation finish
		try {
			await renderPromise;
		} catch {
			// ok
		}
	});

	it("BEGIN remains enabled after generation resolves successfully", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		await renderStart(getMain(), new URLSearchParams("skipDialup=1"));

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		expect(beginBtn?.disabled).toBe(false);
	});
});

describe("renderStart — BEGIN click saves session and navigates", () => {
	beforeEach(() => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		vi.stubGlobal("__DEV__", true);
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

		await renderStart(getMain(), new URLSearchParams("skipDialup=1"));

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		expect(beginBtn?.disabled).toBe(false);

		const pwEl = document.querySelector<HTMLInputElement>("#password");
		if (pwEl) pwEl.dataset.real = "password";

		// Click BEGIN — start.ts will call saveActiveSession then set location.hash
		beginBtn?.click();

		expect(location.hash).toBe("#/game");
	});

	it("BEGIN click is idempotent: button is disabled after first click", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		await renderStart(getMain(), new URLSearchParams("skipDialup=1"));

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		const pwEl = document.querySelector<HTMLInputElement>("#password");
		if (pwEl) pwEl.dataset.real = "password";
		beginBtn?.click();
		beginBtn?.click();

		// After first click, _beginClickPending=true and btn.disabled=true; second is no-op.
		expect(beginBtn?.disabled).toBe(true);
	});

	it("CONNECT click with wrong password shows inline error and does not navigate", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		await renderStart(getMain(), new URLSearchParams("skipDialup=1"));

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		const pwEl = document.querySelector<HTMLInputElement>("#password");
		const errorEl = document.querySelector<HTMLElement>("#login-error");

		// Wrong password — directly setting dataset.real bypasses the masking listener,
		// which is fine because the gate reads dataset.real.
		if (pwEl) pwEl.dataset.real = "wrong";

		const hashBefore = location.hash;
		beginBtn?.click();

		// Hash didn't change → did not navigate.
		expect(location.hash).toBe(hashBefore);
		// Error revealed and CONNECT remains enabled for retry.
		expect(errorEl?.hasAttribute("hidden")).toBe(false);
		expect(errorEl?.textContent).toContain("access denied");
		expect(beginBtn?.disabled).toBe(false);
	});
});

describe("renderStart — CapHitError handling", () => {
	beforeEach(() => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		vi.stubGlobal("__DEV__", true);
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("shows #cap-hit and hides #start-screen when generation throws CapHitError", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();

		// Override the bootstrap module so the split generation rejects with
		// CapHitError on both promises. Pending-bootstrap subscribes to each
		// promise; surfacing CapHitError on either is enough to trigger the
		// start route's #cap-hit fallback.
		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			const { CapHitError } = await import("../llm-client.js");
			const err = new CapHitError({
				message: "rate limit",
				reason: "per-ip-daily",
				retryAfterSec: 86400,
			});
			return {
				...actual,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.reject(err),
					contentPacksPromise: Promise.reject(err),
				}),
				generateNewGameAssets: async () => {
					throw err;
				},
			};
		});

		// Re-import after doMock so the mock takes effect
		const { renderStart } = await import("../routes/start.js");

		try {
			await renderStart(getMain(), new URLSearchParams("skipDialup=1"));
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
		vi.stubGlobal("__DEV__", true);
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
			await renderStart(
				getMain(),
				new URLSearchParams("reason=broken&skipDialup=1"),
			);
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

	it("shows 'stuck' banner text when reason=stuck", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		try {
			await renderStart(
				getMain(),
				new URLSearchParams("reason=stuck&skipDialup=1"),
			);
		} catch {
			// ok
		}

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toContain(
			"Game initialization took too long and was cancelled",
		);
	});

	it("shows 'version-mismatch' banner text when reason=version-mismatch", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../routes/start.js");

		try {
			await renderStart(
				getMain(),
				new URLSearchParams("reason=version-mismatch&skipDialup=1"),
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
				new URLSearchParams("reason=legacy-save-discarded&skipDialup=1"),
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
			await renderStart(getMain(), new URLSearchParams("skipDialup=1"));
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
				new URLSearchParams("reason=totally-unknown&skipDialup=1"),
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
