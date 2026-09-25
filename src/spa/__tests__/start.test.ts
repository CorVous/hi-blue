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
  <section id="endgame" hidden></section>
</main>
`;

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

function setSearch(query: string): void {
	window.history.replaceState({}, "", `/?${query}`);
}

async function awaitIgnoringRejection(
	promise: Promise<unknown>,
): Promise<void> {
	try {
		await promise;
	} catch {}
}

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
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain()));

		const startScreen = document.querySelector<HTMLElement>("#start-screen");
		const panelsEl = document.querySelector<HTMLElement>("#panels");
		const composerEl = document.querySelector<HTMLElement>("#composer");

		expect(startScreen?.hasAttribute("hidden")).toBe(false);
		expect(panelsEl?.hasAttribute("hidden")).toBe(true);
		expect(composerEl?.hasAttribute("hidden")).toBe(true);
	});

	it("renders dial with colored status spans when animation is skipped", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain()));

		const dialEl = document.querySelector<HTMLElement>("#dial");
		expect(dialEl?.querySelectorAll(".ok").length ?? 0).toBeGreaterThan(0);
		expect(dialEl?.querySelectorAll(".hot").length ?? 0).toBeGreaterThan(0);
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
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		const renderPromise = renderStart(getMain());

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		expect(beginBtn?.disabled).toBe(false);

		await awaitIgnoringRejection(renderPromise);
	});

	it("BEGIN remains enabled after generation resolves successfully", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await renderStart(getMain());

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

	it("BEGIN click transitions the view to game", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await renderStart(getMain());

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		expect(beginBtn?.disabled).toBe(false);

		const pwEl = document.querySelector<HTMLInputElement>("#password");
		if (pwEl) pwEl.dataset.real = "password";

		beginBtn?.click();

		expect(getMain().dataset.view).toBe("game");
	});

	it("BEGIN click is idempotent: button is disabled after first click", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await renderStart(getMain());

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		const pwEl = document.querySelector<HTMLInputElement>("#password");
		if (pwEl) pwEl.dataset.real = "password";
		beginBtn?.click();
		beginBtn?.click();

		expect(beginBtn?.disabled).toBe(true);
	});

	it("CONNECT click with wrong password shows inline error and does not navigate", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await renderStart(getMain());

		const beginBtn = document.querySelector<HTMLButtonElement>("#begin");
		const pwEl = document.querySelector<HTMLInputElement>("#password");
		const errorEl = document.querySelector<HTMLElement>("#login-error");

		if (pwEl) pwEl.dataset.real = "wrong";

		const viewBefore = getMain().dataset.view;
		beginBtn?.click();

		expect(getMain().dataset.view).toBe(viewBefore);
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
			};
		});

		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain()));

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
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain(), { reason: "broken" }));

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
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain(), { reason: "stuck" }));

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toContain(
			"Game initialization took too long and was cancelled",
		);
	});

	it("shows 'version-mismatch' map-miss banner text when no archive entry exists", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(
			renderStart(getMain(), {
				reason: "version-mismatch",
				schemaVersion: 9,
			}),
		);

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toContain(
			"Saved game data is from an older version of hi-blue and cannot be loaded by this build. It has been kept — start a new game, or remove it from your Sessions list.",
		);
		expect(warningEl?.querySelector("a")).toBeNull();
	});

	it("shows 'version-mismatch' map-hit banner with archive link when entry exists", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const archiveMapModule = await import("../persistence/archive-map.js");
		archiveMapModule.SCHEMA_ARCHIVE_MAP[9] = "0.1.1";
		try {
			const { renderStart } = await import("../views/start.js");

			setSearch("skipDialup=1");
			await awaitIgnoringRejection(
				renderStart(getMain(), {
					reason: "version-mismatch",
					schemaVersion: 9,
				}),
			);

			const warningEl = document.querySelector<HTMLElement>(
				"#persistence-warning",
			);
			expect(warningEl?.hasAttribute("hidden")).toBe(false);
			expect(warningEl?.textContent).toContain(
				"Your saved Session is from an older version of hi-blue",
			);
			expect(warningEl?.textContent).toContain("v0.1.1");
			const link = warningEl?.querySelector("a");
			expect(link).not.toBeNull();
			expect(link?.getAttribute("href")).toBe("./v/0.1.1/");
		} finally {
			delete archiveMapModule.SCHEMA_ARCHIVE_MAP[9];
		}
	});

	it("shows 'legacy-save-discarded' banner text when reason=legacy-save-discarded", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
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

	it("shows no banner when reason opt is absent", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain()));

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(true);
	});

	it("silently skips a reason that has no copy", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain(), { reason: "empty" }));

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(true);
	});
});
