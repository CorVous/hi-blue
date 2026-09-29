import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { awaitIgnoringRejection } from "./fixtures/await-ignoring-rejection";
import { installLocalStorageStub } from "./fixtures/local-storage";
import { STATIC_CONTENT_PACKS } from "./fixtures/static-content-packs";
import { STATIC_PERSONAS } from "./fixtures/static-personas";

vi.mock("../../content/persona-generator", () => ({
	generatePersonas: async () => STATIC_PERSONAS,
}));

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
      <div id="start-bootstrap-error" hidden>
        <span id="start-bootstrap-error-text"></span>
        <button id="start-bootstrap-retry" type="button">[ retry ]</button>
      </div>
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

function getMain(): HTMLElement {
	const main = document.querySelector<HTMLElement>("main");
	if (!main) throw new Error("main element not found");
	return main;
}

function setSearch(query: string): void {
	window.history.replaceState({}, "", `/?${query}`);
}

beforeEach(() => {
	document.body.innerHTML = INDEX_BODY_HTML;
	installLocalStorageStub();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.resetModules();
	document.body.innerHTML = "";
});

describe("renderStart — screen visibility", () => {
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

describe("renderStart — generation failures that are not the spend cap", () => {
	afterEach(() => {
		vi.doUnmock("../game/bootstrap.js");
	});

	async function importStartWithSplits(
		splits: Array<
			() => {
				personasPromise: Promise<unknown>;
				contentPacksPromise: Promise<unknown>;
			}
		>,
	) {
		vi.resetModules();
		const calls = { count: 0 };
		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			return {
				...actual,
				generateNewGameAssetsSplit: () => {
					const make = splits[Math.min(calls.count, splits.length - 1)];
					calls.count++;
					if (!make) throw new Error("no split scripted");
					return make();
				},
			};
		});
		const { renderStart } = await import("../views/start.js");
		const pending = await import("../game/pending-bootstrap.js");
		return { renderStart, pending, calls };
	}

	function rejectedSplit(err: unknown) {
		return () => ({
			personasPromise: Promise.reject(err),
			contentPacksPromise: Promise.reject(err),
		});
	}

	const hangingSplit = () => ({
		personasPromise: new Promise<never>(() => {}),
		contentPacksPromise: new Promise<never>(() => {}),
	});

	it("shows a retryable error with the upstream message, not #cap-hit", async () => {
		let failure: unknown;
		const { renderStart } = await importStartWithSplits([
			() => rejectedSplit(failure)(),
		]);
		const { HttpStatusError } = await import("../llm-client.js");
		failure = new HttpStatusError({
			status: 401,
			statusText: "Unauthorized",
			upstreamMessage: "No auth credentials found",
			retryAfterSec: null,
		});

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain()));

		const errorEl = document.querySelector<HTMLElement>(
			"#start-bootstrap-error",
		);
		expect(errorEl?.hidden).toBe(false);
		expect(
			document.querySelector("#start-bootstrap-error-text")?.textContent,
		).toContain("HTTP 401: No auth credentials found");
		expect(document.querySelector("#cap-hit")?.hasAttribute("hidden")).toBe(
			true,
		);
		expect(document.querySelector<HTMLElement>("#start-screen")?.hidden).toBe(
			false,
		);
	});

	it("retry starts a fresh bootstrap and hides the error", async () => {
		const { renderStart, pending, calls } = await importStartWithSplits([
			rejectedSplit(new Error("network down")),
			hangingSplit,
		]);

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain()));
		const failed = pending.getPendingBootstrap();
		expect(failed?.status).toBe("failed");

		document
			.querySelector<HTMLButtonElement>("#start-bootstrap-retry")
			?.click();

		expect(calls.count).toBe(2);
		expect(pending.getPendingBootstrap()).not.toBe(failed);
		expect(
			document.querySelector<HTMLElement>("#start-bootstrap-error")?.hidden,
		).toBe(true);
	});

	it("rendering the start screen again keeps a failed bootstrap and shows its error without a new request", async () => {
		const { renderStart, pending, calls } = await importStartWithSplits([
			rejectedSplit(new Error("network down")),
			hangingSplit,
		]);

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain()));
		const failed = pending.getPendingBootstrap();
		expect(failed?.status).toBe("failed");
		const firstErrorText = document.querySelector(
			"#start-bootstrap-error-text",
		)?.textContent;

		await awaitIgnoringRejection(renderStart(getMain()));

		expect(calls.count).toBe(1);
		expect(pending.getPendingBootstrap()).toBe(failed);
		expect(
			document.querySelector<HTMLElement>("#start-bootstrap-error")?.hidden,
		).toBe(false);
		expect(
			document.querySelector("#start-bootstrap-error-text")?.textContent,
		).toBe(firstErrorText);
	});

	it("rendering the start screen again after a cap hit shows #cap-hit without a new request", async () => {
		let failure: unknown;
		const { renderStart, pending, calls } = await importStartWithSplits([
			() => rejectedSplit(failure)(),
			hangingSplit,
		]);
		const { CapHitError } = await import("../llm-client.js");
		failure = new CapHitError({
			message: "rate limit",
			reason: "per-ip-daily",
			retryAfterSec: 86400,
		});

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain()));
		expect(pending.getPendingBootstrap()?.status).toBe("failed");
		document.querySelector("#cap-hit")?.setAttribute("hidden", "");

		await awaitIgnoringRejection(renderStart(getMain()));

		expect(calls.count).toBe(1);
		expect(document.querySelector("#cap-hit")?.hasAttribute("hidden")).toBe(
			false,
		);
		expect(document.querySelector<HTMLElement>("#start-screen")?.hidden).toBe(
			true,
		);
	});

	it("CONNECT with a failed bootstrap starts a fresh one", async () => {
		const { renderStart, pending, calls } = await importStartWithSplits([
			rejectedSplit(new Error("network down")),
			hangingSplit,
		]);

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain()));
		const failed = pending.getPendingBootstrap();

		const passwordEl = document.querySelector<HTMLInputElement>("#password");
		if (passwordEl) passwordEl.dataset.real = "password";
		document.querySelector<HTMLButtonElement>("#begin")?.click();

		expect(calls.count).toBe(2);
		expect(pending.getPendingBootstrap()).not.toBe(failed);
		expect(pending.getPendingBootstrap()?.status).toBe("pending");
	});
});

describe("renderStart — persistence warning banners", () => {
	it.each([
		["broken", "Saved game data was unreadable and has been discarded"],
		["stuck", "Game initialization took too long and was cancelled"],
		[
			"legacy-save-discarded",
			"Saved game data from an older format has been discarded",
		],
	] as const)("shows the '%s' banner text", async (reason, copy) => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain(), { reason }));

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toContain(copy);
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

	it.each([
		["the reason opt is absent", undefined],
		["the reason has no copy", { reason: "empty" }],
	] as const)("shows no banner when %s", async (_case, opts) => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain(), opts));

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(true);
	});
});

describe("renderStart — repeated renders", () => {
	beforeEach(() => {
		vi.stubGlobal("__COMMIT_TIMESTAMP_MS__", 0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("hides a reason banner left by an earlier render when the next render has no reason", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain(), { reason: "broken" }));
		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hidden).toBe(false);

		await awaitIgnoringRejection(renderStart(getMain()));
		expect(warningEl?.hidden).toBe(true);
		expect(warningEl?.textContent).toBe("");
	});

	it("hides the endgame screen", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../views/start.js");
		const endgameEl = document.querySelector<HTMLElement>("#endgame");
		endgameEl?.removeAttribute("hidden");

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain()));

		expect(endgameEl?.hidden).toBe(true);
	});

	it("keeps one live login listener per element after rendering twice", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		const registrations: Array<{
			target: EventTarget;
			type: string;
			signal: AbortSignal | undefined;
		}> = [];
		const originalAdd = EventTarget.prototype.addEventListener;
		vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(
			function (
				this: EventTarget,
				type: string,
				listener: EventListenerOrEventListenerObject | null,
				options?: boolean | AddEventListenerOptions,
			) {
				const signal = typeof options === "object" ? options.signal : undefined;
				registrations.push({ target: this, type, signal });
				originalAdd.call(this, type, listener, options);
			},
		);

		setSearch("skipDialup=1");
		await awaitIgnoringRejection(renderStart(getMain()));
		await awaitIgnoringRejection(renderStart(getMain()));

		const liveCount = (selector: string, type: string): number =>
			registrations.filter(
				(r) =>
					r.target === document.querySelector(selector) &&
					r.type === type &&
					!r.signal?.aborted,
			).length;
		expect(liveCount("#login-form", "submit")).toBe(1);
		expect(liveCount("#begin", "click")).toBe(1);
		expect(liveCount("#password", "input")).toBe(1);
	});

	it("stops the previous dial-up animation when the start screen renders again", async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0.9);
		vi.resetModules();
		const { renderStart } = await import("../views/start.js");

		setSearch("");
		void renderStart(getMain()).catch(() => undefined);
		await vi.advanceTimersByTimeAsync(2_000);
		const dialEl = document.querySelector<HTMLElement>("#dial");
		expect(dialEl?.textContent?.length ?? 0).toBeGreaterThan(20);

		void renderStart(getMain()).catch(() => undefined);
		expect(dialEl?.textContent).toBe("");
		await vi.advanceTimersByTimeAsync(100);
		expect(dialEl?.textContent).toBe("");
	});
});
