import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATIC_CONTENT_PACKS } from "./fixtures/static-content-packs";
import { STATIC_PERSONAS } from "./fixtures/static-personas";

// Pin generatePersonas to a static fixture so the test can rely on
// stable red/green/blue handles and Ember/Sage/Frost names.
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

// ── Shared localStorage stub helpers ──────────────────────────────────────────
// game.ts (post-#173) requires a pre-populated active session to avoid
// redirecting to #/start. These helpers set up a valid session in localStorage
// so renderGame() proceeds to the restore path.

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

/**
 * Seed a localStorage stub with a valid active session derived from
 * STATIC_PERSONAS and STATIC_CONTENT_PACKS.
 *
 * Called in beforeEach (or inline) so game.ts finds a restorable session
 * instead of redirecting to #/start.
 *
 * Must be called BEFORE vi.resetModules() in each test (modules that import
 * session-storage.ts must still be the same instance).
 */
async function seedSessionInStub(
	stub: ReturnType<typeof makeLocalStorageStub>,
): Promise<void> {
	// Use the real buildSessionFromAssets + saveActiveSession
	const { buildSessionFromAssets } = await import("../game/bootstrap.js");
	const { mintAndActivateNewSession, saveActiveSession } = await import(
		"../persistence/session-storage.js"
	);

	// Temporarily install the stub
	const prev = globalThis.localStorage;
	Object.defineProperty(globalThis, "localStorage", {
		value: stub,
		writable: true,
		configurable: true,
	});

	try {
		mintAndActivateNewSession();
		const session = buildSessionFromAssets({
			personas: STATIC_PERSONAS,
			contentPacks: STATIC_CONTENT_PACKS,
		});
		saveActiveSession(session.getState());
	} finally {
		Object.defineProperty(globalThis, "localStorage", {
			value: prev,
			writable: true,
			configurable: true,
		});
	}
}

// Matches the body content of src/spa/index.html (three-panel layout)
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

function getEl<T extends HTMLElement>(selector: string): T {
	const el = document.querySelector<T>(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
}

/**
 * Creates an SSE response body that yields a single JSON action as an OpenAI delta event.
 * The runRound coordinator collects all delta tokens into one string and parses as JSON.
 *
 * Includes a final usage chunk (mimicking OpenRouter with usage:{include:true}) so
 * the budget-deduction path sees a non-zero cost.
 */
function makeAiSseStream(jsonAction: string): ReadableStream<Uint8Array> {
	const deltaChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: jsonAction } }] })}\n\n`;
	const usageChunk = `data: ${JSON.stringify({ choices: [], usage: { cost: 0.01, total_tokens: 100 } })}\n\n`;
	const sseData = `${deltaChunk}${usageChunk}data: [DONE]\n\n`;
	return makeSSEStream([sseData]);
}

/** Returns a fresh fetch mock that serves three AI responses in sequence. */
function makeThreeAiFetchMock(
	redAction: string,
	greenAction: string,
	blueAction: string,
) {
	return vi
		.fn()
		.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeAiSseStream(redAction),
		})
		.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeAiSseStream(greenAction),
		})
		.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeAiSseStream(blueAction),
		});
}

/** passAiResponse: used when we just want all AIs to pass (budget deduction still fires). */
const PASS_ACTION = '{"action":"pass"}';
const RED_ACTION = '{"action":"chat","content":"RED_RESPONSE_UNIQUE_TAG"}';
const GREEN_ACTION = '{"action":"chat","content":"GREEN_RESPONSE_UNIQUE_TAG"}';
const BLUE_ACTION = '{"action":"chat","content":"BLUE_RESPONSE_UNIQUE_TAG"}';

describe("renderGame (game route — three-AI)", () => {
	let _stub: ReturnType<typeof makeLocalStorageStub>;

	beforeEach(async () => {
		// Must be set before each test since vi.unstubAllGlobals() in afterEach removes it
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		// Seed a valid session so game.ts finds an active session on render.
		_stub = makeLocalStorageStub();
		await seedSessionInStub(_stub);
		vi.stubGlobal("localStorage", _stub);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("after one submit, all three transcript panels have content", async () => {
		const mockFetch = makeThreeAiFetchMock(
			RED_ACTION,
			GREEN_ACTION,
			BLUE_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		// Math.random=0.9 produces identity shuffle: ["red","green","blue"]
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const form = getEl<HTMLFormElement>("#composer");
		promptInput.value = "*Sage hello world";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 300));

		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		const blueTranscript = getEl<HTMLElement>('[data-transcript="blue"]');

		expect(redTranscript.textContent?.trim()).toBeTruthy();
		expect(greenTranscript.textContent?.trim()).toBeTruthy();
		expect(blueTranscript.textContent?.trim()).toBeTruthy();
	});

	it("each panel only contains its own AI's completion text", async () => {
		const mockFetch = makeThreeAiFetchMock(
			RED_ACTION,
			GREEN_ACTION,
			BLUE_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		const blueTranscript = getEl<HTMLElement>('[data-transcript="blue"]');

		// Each panel should contain its AI's unique tag
		expect(redTranscript.textContent).toContain("RED_RESPONSE_UNIQUE_TAG");
		expect(greenTranscript.textContent).toContain("GREEN_RESPONSE_UNIQUE_TAG");
		expect(blueTranscript.textContent).toContain("BLUE_RESPONSE_UNIQUE_TAG");

		// Red panel should not contain green or blue content
		expect(redTranscript.textContent).not.toContain(
			"GREEN_RESPONSE_UNIQUE_TAG",
		);
		expect(redTranscript.textContent).not.toContain("BLUE_RESPONSE_UNIQUE_TAG");
	});

	it("action-log is hidden by default and visible with debug=1", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");

		// Without debug param: action log should be hidden
		await renderGame(getEl<HTMLElement>("main"));
		const actionLog = getEl<HTMLElement>("#action-log");
		expect(actionLog.hasAttribute("hidden")).toBe(true);

		// With debug=1: action log should be visible
		const params = new URLSearchParams("debug=1");
		await renderGame(getEl<HTMLElement>("main"), params);
		expect(actionLog.hasAttribute("hidden")).toBe(false);
	});

	it("action-log entries are populated after a round (hidden or visible)", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");

		// Show debug so we can verify entries
		const params = new URLSearchParams("debug=1");
		await renderGame(getEl<HTMLElement>("main"), params);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		const logList = getEl<HTMLUListElement>("#action-log-list");
		expect(logList.children.length).toBeGreaterThan(0);
	});

	it("budgets decrement after a round (5 -> 4 for all AIs)", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		// Initial budgets should show 5
		const redBudget = document.querySelector<HTMLSpanElement>(
			'.ai-panel[data-ai="red"] .panel-budget',
		);
		const greenBudget = document.querySelector<HTMLSpanElement>(
			'.ai-panel[data-ai="green"] .panel-budget',
		);
		const blueBudget = document.querySelector<HTMLSpanElement>(
			'.ai-panel[data-ai="blue"] .panel-budget',
		);
		expect(redBudget?.textContent).toContain("5");

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// After one round, budgets should be 4
		expect(redBudget?.textContent).toContain("4");
		expect(greenBudget?.textContent).toContain("4");
		expect(blueBudget?.textContent).toContain("4");
	});

	it("fetch is called exactly three times per round (once per AI)", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(mockFetch).toHaveBeenCalledTimes(3);
	});

	it("shows per-daemon braille spinners during the round, stripped after responses arrive", async () => {
		const mockFetch = makeThreeAiFetchMock(
			RED_ACTION,
			GREEN_ACTION,
			BLUE_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const form = getEl<HTMLFormElement>("#composer");
		// Address the green panel via *Sage mention
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		// Synchronously after submit, every daemon's panel border carries
		// at least one .panel-spinner span next to the .panel-name label.
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		const bluePanel = getEl<HTMLElement>('.ai-panel[data-ai="blue"]');
		expect(redPanel.querySelector(".panel-name .panel-spinner")).not.toBeNull();
		expect(
			greenPanel.querySelector(".panel-name .panel-spinner"),
		).not.toBeNull();
		expect(
			bluePanel.querySelector(".panel-name .panel-spinner"),
		).not.toBeNull();

		// Input is reset to "*Sage " immediately on send (not after the round).
		expect(promptInput.value).toBe("*Sage ");
		// Player line shows the stripped body (no leading mention).
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		expect(greenTranscript.textContent).toContain("> hello");
		expect(greenTranscript.textContent).not.toContain("> *Sage hello");

		await new Promise((resolve) => setTimeout(resolve, 300));

		// After the round resolves, no spinners remain on any panel.
		expect(redPanel.querySelector(".panel-spinner")).toBeNull();
		expect(greenPanel.querySelector(".panel-spinner")).toBeNull();
		expect(bluePanel.querySelector(".panel-spinner")).toBeNull();
		expect(greenTranscript.textContent).toContain("GREEN_RESPONSE_UNIQUE_TAG");
	});

	it("phase_advanced shows banner with new objective and clears transcripts", async () => {
		// winImmediately=1: first submit fires winCondition → phase_advanced event
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("winImmediately=1"),
		);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage go";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Phase banner should be visible with the phase 2 setting
		const phaseBanner = getEl<HTMLElement>("#phase-banner");
		expect(phaseBanner.hasAttribute("hidden")).toBe(false);
		expect(phaseBanner.textContent).toContain("Phase 2");
		// Setting comes from STATIC_CONTENT_PACKS phase 2: "sun-baked salt flat"
		expect(phaseBanner.textContent).toContain("sun-baked salt flat");

		// All transcripts should have been cleared and repopulated with a separator
		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		expect(redTranscript.textContent).toContain("--- Phase 2 begins:");
		// No content from the previous phase should remain
		expect(redTranscript.textContent).not.toContain("> *Sage");
		expect(redTranscript.textContent).not.toContain("> *Ember");
		expect(redTranscript.textContent).not.toContain("> *Frost");
	});

	it("after three-phase win condition, endgame screen shown and chat hidden; download button has parseable GameSave", async () => {
		// Three submits to exhaust all three phases (winImmediately=1)
		// Each submit calls fetch 3 times → 9 total fetches
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeAiSseStream(PASS_ACTION),
		});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("winImmediately=1"),
		);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Submit 1: phase 1 → phase 2 (phase_advanced)
		promptInput.value = "*Sage one";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Submit 2: phase 2 → phase 3 (phase_advanced)
		promptInput.value = "*Sage two";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Submit 3: phase 3 → game_ended
		promptInput.value = "*Sage three";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Chat panels and composer should be hidden
		const panelsEl = document.querySelector<HTMLElement>("#panels");
		const composerEl = document.querySelector<HTMLElement>("#composer");
		expect(panelsEl?.hidden).toBe(true);
		expect(composerEl?.hidden).toBe(true);

		// Endgame screen should be visible
		const endgameEl = getEl<HTMLElement>("#endgame");
		expect(endgameEl.hasAttribute("hidden")).toBe(false);

		// Download button should have parseable save payload with three personas
		const downloadBtn = getEl<HTMLButtonElement>("#download-ais-btn");
		const saveJson = downloadBtn.dataset.savePayload;
		expect(saveJson).toBeTruthy();
		const save = JSON.parse(saveJson as string);
		expect(save.version).toBe(3);
		expect(save.ais).toHaveLength(3);
	});

	it("clicking download button triggers blob download, disables button, shows 'Saved.'", async () => {
		// Drive to game_ended
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeAiSseStream(PASS_ACTION),
		});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		const createObjectURLSpy = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:http://localhost/test");
		const revokeObjectURLSpy = vi
			.spyOn(URL, "revokeObjectURL")
			.mockReturnValue(undefined);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("winImmediately=1"),
		);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		for (const msg of ["*Sage one", "*Sage two", "*Sage three"]) {
			promptInput.value = msg;
			promptInput.dispatchEvent(new Event("input"));
			form.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		const downloadBtn = getEl<HTMLButtonElement>("#download-ais-btn");
		const downloadStatus = getEl<HTMLElement>("#download-status");

		expect(downloadBtn.disabled).toBe(false);
		downloadBtn.click();

		expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
		expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
		expect(downloadBtn.disabled).toBe(true);
		expect(downloadStatus.textContent).toBe("Saved.");
	});

	it("clicking submit-diagnostics with empty summary shows validation message and does NOT POST", async () => {
		// Drive to game_ended
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeAiSseStream(PASS_ACTION),
		});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("winImmediately=1"),
		);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		for (const msg of ["*Sage one", "*Sage two", "*Sage three"]) {
			promptInput.value = msg;
			promptInput.dispatchEvent(new Event("input"));
			form.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		const callCountBeforeDiagnostics = mockFetch.mock.calls.length;

		const submitDiagnosticsBtn = getEl<HTMLButtonElement>(
			"#submit-diagnostics-btn",
		);
		const diagnosticsStatus = getEl<HTMLElement>("#diagnostics-status");

		// Leave summary empty and click — should show validation message
		submitDiagnosticsBtn.click();
		expect(diagnosticsStatus.textContent).toContain(
			"Please enter a one-word summary first.",
		);
		// No extra fetch calls
		expect(mockFetch.mock.calls.length).toBe(callCountBeforeDiagnostics);
	});

	it("clicking submit-diagnostics with a summary POSTs to /diagnostics with mode: no-cors", async () => {
		// Drive to game_ended
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeAiSseStream(PASS_ACTION),
		});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("winImmediately=1"),
		);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		for (const msg of ["*Sage one", "*Sage two", "*Sage three"]) {
			promptInput.value = msg;
			promptInput.dispatchEvent(new Event("input"));
			form.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		const callCountBeforeDiagnostics = mockFetch.mock.calls.length;

		const submitDiagnosticsBtn = getEl<HTMLButtonElement>(
			"#submit-diagnostics-btn",
		);
		const diagnosticsStatusEl = getEl<HTMLElement>("#diagnostics-status");
		const diagnosticsSummaryInput = getEl<HTMLInputElement>(
			"#diagnostics-summary",
		);

		diagnosticsSummaryInput.value = "curious";
		submitDiagnosticsBtn.click();

		// Allow the fetch to settle
		await new Promise((resolve) => setTimeout(resolve, 50));

		// One extra fetch call for diagnostics
		expect(mockFetch.mock.calls.length).toBe(callCountBeforeDiagnostics + 1);
		const [diagnosticsUrl, diagnosticsOptions] = mockFetch.mock.calls[
			callCountBeforeDiagnostics
		] as [string, RequestInit];
		expect(diagnosticsUrl).toBe("http://localhost:8787/diagnostics");
		expect(diagnosticsOptions.method).toBe("POST");
		expect(diagnosticsOptions.mode).toBe("no-cors");
		const body = JSON.parse(diagnosticsOptions.body as string) as {
			summary: string;
			downloaded: boolean;
		};
		expect(body.summary).toBe("curious");

		expect(diagnosticsStatusEl.textContent).toBe("Diagnostics submitted.");
	});
});

describe("renderGame — localStorage persistence", () => {
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

	beforeEach(() => {
		// Must be set before each test since vi.unstubAllGlobals() in afterEach removes it
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("state is saved to localStorage after a successful round", async () => {
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub);
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// setItem should have been called with the engine.dat commit key (new format)
		const engineKey = Object.keys(stub._store).find((k) =>
			k.endsWith("/engine.dat"),
		);
		expect(engineKey).toBeDefined();
		// engine.dat value is a base64-encoded obfuscated blob (not plain JSON)
		if (!engineKey) throw new Error("engineKey should be defined");
		expect(stub._store[engineKey]).toMatch(/^[A-Za-z0-9+/=]+$/);
	});

	it("state is restored from localStorage on renderGame when saved state exists", async () => {
		// First: run a round using chat actions so AI responses land in transcripts
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub);
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(RED_ACTION, GREEN_ACTION, BLUE_ACTION),
		);
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame: renderGame1 } = await import("../routes/game.js");
		await renderGame1(getEl<HTMLElement>("main"));

		const form1 = getEl<HTMLFormElement>("#composer");
		const promptInput1 = getEl<HTMLInputElement>("#prompt");
		promptInput1.value = "*Sage hello";
		promptInput1.dispatchEvent(new Event("input"));
		form1.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Verify state was saved in the new multi-file format (engine.dat is commit signal)
		expect(stub.setItem).toHaveBeenCalled();
		const engineKey = Object.keys(stub._store).find((k) =>
			k.endsWith("/engine.dat"),
		);
		expect(engineKey).toBeDefined();

		// Daemon .txt files should contain the AI response tag (chat histories are editable)
		const daemonKeys = Object.keys(stub._store).filter(
			(k) => k.endsWith(".txt") && !k.endsWith("whispers.txt"),
		);
		const daemonContents = daemonKeys.map((k) => stub._store[k] ?? "").join("");
		expect(daemonContents).toContain("RED_RESPONSE_UNIQUE_TAG");

		// Second: simulate a fresh page load with the saved state
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.resetModules();
		// getItem should return the previously saved state
		const { renderGame: renderGame2 } = await import("../routes/game.js");
		await renderGame2(getEl<HTMLElement>("main"));

		// Budget should reflect round 1 complete: 5¢ - 1¢ cost = 4.000¢
		const redBudget = document.querySelector<HTMLSpanElement>(
			'.ai-panel[data-ai="red"] .panel-budget',
		);
		expect(redBudget?.textContent).toBe("4.000¢");

		// Transcripts must be restored from chatHistories (new format uses chatHistories fallback)
		const redTranscript = document.querySelector<HTMLElement>(
			'[data-transcript="red"]',
		);
		const greenTranscript = document.querySelector<HTMLElement>(
			'[data-transcript="green"]',
		);
		const blueTranscript = document.querySelector<HTMLElement>(
			'[data-transcript="blue"]',
		);
		expect(redTranscript?.textContent).toContain("RED_RESPONSE_UNIQUE_TAG");
		expect(greenTranscript?.textContent).toContain("GREEN_RESPONSE_UNIQUE_TAG");
		expect(blueTranscript?.textContent).toContain("BLUE_RESPONSE_UNIQUE_TAG");
	});

	it("quota-exceeded localStorage write surfaces the warning banner without breaking the round", async () => {
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub);
		// Intercept setItem for the engine.dat commit key (new format).
		// The probe key and other session keys pass through normally.
		stub.setItem.mockImplementation((key: string, value: string) => {
			if (key.endsWith("/engine.dat")) {
				throw Object.assign(new DOMException("quota", "QuotaExceededError"));
			}
			// Probe key and other keys pass through
			(stub as { _store: Record<string, string> })._store[key] = value;
		});
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Send button should be in a known state after round (round completed,
		// prompt was cleared so Send is disabled until a new @mention is typed).
		const sendBtn = getEl<HTMLButtonElement>("#send");
		// roundInFlight is false (round finished), so disabled reflects empty prompt.
		// Typing a valid mention re-enables it.
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(false);

		// Warning banner should be visible
		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toBeTruthy();
	});

	it("localStorage disabled shows warning banner (gameplay not possible without storage)", async () => {
		// Stub localStorage as completely unavailable (both probe and all calls throw).
		// Post-#173: game.ts requires a pre-existing session; when storage is unavailable
		// the warning is shown but no session can be established, so gameplay is inert.
		const unavailableStub = {
			getItem: vi.fn(() => {
				throw new DOMException("denied", "SecurityError");
			}),
			setItem: vi.fn(() => {
				throw new DOMException("denied", "SecurityError");
			}),
			removeItem: vi.fn(() => {
				throw new DOMException("denied", "SecurityError");
			}),
			clear: vi.fn(() => {
				throw new DOMException("denied", "SecurityError");
			}),
			get length() {
				return 0;
			},
			key: vi.fn(() => null),
		};

		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.stubGlobal("localStorage", unavailableStub);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		// Warning banner should be shown immediately (storage unavailable)
		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toBeTruthy();
	});

	it("chat message content is preserved across a fresh renderGame via chatHistories", async () => {
		// Use chat actions so AI responses land in chatHistories (which are persisted).
		// Note: the new format stores chat histories in daemon .txt files, so raw
		// tool outputs (pass/pick_up/etc.) are NOT preserved — only chat messages are.
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub);
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(RED_ACTION, GREEN_ACTION, BLUE_ACTION),
		);
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame: renderGame1 } = await import("../routes/game.js");
		await renderGame1(getEl<HTMLElement>("main"));

		const form1 = getEl<HTMLFormElement>("#composer");
		const promptInput1 = getEl<HTMLInputElement>("#prompt");
		promptInput1.value = "*Sage hello";
		promptInput1.dispatchEvent(new Event("input"));
		form1.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Verify chat content landed in the transcript
		const redTextAfterRound =
			document.querySelector<HTMLElement>('[data-transcript="red"]')
				?.textContent ?? "";
		expect(redTextAfterRound).toContain("RED_RESPONSE_UNIQUE_TAG");

		// Verify state is saved in the new multi-file format (engine.dat as commit signal)
		const engineKey = Object.keys(stub._store).find((k) =>
			k.endsWith("/engine.dat"),
		);
		expect(engineKey).toBeDefined();

		// Simulate page refresh: fresh renderGame with the same localStorage stub
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.resetModules();
		const { renderGame: renderGame2 } = await import("../routes/game.js");
		await renderGame2(getEl<HTMLElement>("main"));

		// Chat responses must be visible after reload (restored from chatHistories)
		const redTextRestored =
			document.querySelector<HTMLElement>('[data-transcript="red"]')
				?.textContent ?? "";
		expect(redTextRestored).toContain("RED_RESPONSE_UNIQUE_TAG");
	});
});

describe("renderGame — chat_lockout event", () => {
	beforeEach(async () => {
		// Must be set before each test since vi.unstubAllGlobals() in afterEach removes it
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		const _stub = makeLocalStorageStub();
		await seedSessionInStub(_stub);
		vi.stubGlobal("localStorage", _stub);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("chat_lockout appends the lockout message to the locked AI's transcript", async () => {
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();

		// Import GameSession first so the spy is in place before renderGame
		// creates a session from the same module registry.
		const { GameSession } = await import("../game/game-session.js");
		// Capture the original before spying to avoid infinite recursion.
		const originalSubmit = GameSession.prototype.submitMessage;
		vi.spyOn(GameSession.prototype, "submitMessage").mockImplementation(
			async function (
				this: InstanceType<typeof GameSession>,
				...args: Parameters<InstanceType<typeof GameSession>["submitMessage"]>
			) {
				// Call the real implementation to get a valid nextState.
				const real = await originalSubmit.apply(this, args);
				// Inject a chatLockoutTriggered into the result so the encoder
				// emits a chat_lockout SSE event, exercising the SPA branch.
				return {
					...real,
					result: {
						...real.result,
						chatLockoutTriggered: {
							aiId: "red" as const,
							message: "Ember is unresponsive…",
						},
					},
				};
			},
		);

		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 300));

		// The chat_lockout event should have appended the message to red's transcript.
		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		expect(redTranscript.textContent).toContain("[Ember is unresponsive…]");

		// After the chat_lockout fires for red, typing *Ember should leave Send disabled.
		const sendBtn = getEl<HTMLButtonElement>("#send");
		promptInput.value = "*Ember hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(true);
	});
});

describe("renderGame — mention-based addressing", () => {
	beforeEach(async () => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		const _stub = makeLocalStorageStub();
		await seedSessionInStub(_stub);
		vi.stubGlobal("localStorage", _stub);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("empty input on initial load leaves Send disabled", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const sendBtn = getEl<HTMLButtonElement>("#send");
		expect(sendBtn.disabled).toBe(true);
	});

	it("typing 'hi' (no mention) leaves Send disabled", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		promptInput.value = "hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(true);
	});

	it("typing '*Sage hi' enables Send", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(false);
	});

	it("submit with '*Sage hi' routes '> hi' message (mention stripped) to green panel", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		const blueTranscript = getEl<HTMLElement>('[data-transcript="blue"]');

		expect(greenTranscript.textContent).toContain("> hi");
		expect(greenTranscript.textContent).not.toContain("> *Sage hi");
		expect(redTranscript.textContent).not.toContain("> *Sage");
		expect(blueTranscript.textContent).not.toContain("> *Sage");
	});

	it("*Sage while green locked leaves Send disabled", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();

		// Import GameSession first so the spy is in place before renderGame
		// creates a session from the same module registry.
		const { GameSession } = await import("../game/game-session.js");
		const originalSubmit = GameSession.prototype.submitMessage;
		vi.spyOn(GameSession.prototype, "submitMessage").mockImplementation(
			async function (
				this: InstanceType<typeof GameSession>,
				...args: Parameters<InstanceType<typeof GameSession>["submitMessage"]>
			) {
				const real = await originalSubmit.apply(this, args);
				// Inject a chatLockoutTriggered for green so the SPA sets green locked.
				return {
					...real,
					result: {
						...real.result,
						chatLockoutTriggered: {
							aiId: "green" as const,
							message: "Sage is unresponsive…",
						},
					},
				};
			},
		);

		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		// Submit first round to trigger the lockout
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// After a successful send with green locked, the persisted prefix is written.
		expect(promptInput.value).toBe("*Sage ");

		// Now typing *Sage should leave Send disabled (green is locked)
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(true);
	});
});

describe("renderGame — panel-click addressee", () => {
	beforeEach(async () => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		const _stub = makeLocalStorageStub();
		await seedSessionInStub(_stub);
		vi.stubGlobal("localStorage", _stub);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("empty input + click red panel → '*Ember ', Send stays disabled (no body)", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');

		expect(promptInput.value).toBe("");
		redPanel.click();

		expect(promptInput.value).toBe("*Ember ");
		// Per #110: addressee prefix alone is not enough to enable Send.
		expect(sendBtn.disabled).toBe(true);
	});

	it("'*Sage hi' in input + click red panel → '*Ember hi'", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');

		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		redPanel.click();

		expect(promptInput.value).toBe("*Ember hi");
	});

	it("multi-mention '*Sage tell *Frost go' + click red → only first mention replaced", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');

		promptInput.value = "*Sage tell *Frost go";
		promptInput.dispatchEvent(new Event("input"));
		redPanel.click();

		expect(promptInput.value).toBe("*Ember tell *Frost go");
	});

	it("cursor is preserved after mention mutation (after the mention)", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');

		promptInput.value = "*Sage hi";
		// Simulate cursor at end (position 8)
		promptInput.setSelectionRange(8, 8);
		redPanel.click();

		// "*Ember hi" length is 9; cursor was at 8 (after *Sage hi), delta = 1 → 9
		expect(promptInput.selectionStart).toBe(9);
	});

	it("clicking a locked panel is a no-op (input unchanged)", async () => {
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();

		// Import GameSession first to set up the spy before renderGame
		const { GameSession } = await import("../game/game-session.js");
		const originalSubmit = GameSession.prototype.submitMessage;
		vi.spyOn(GameSession.prototype, "submitMessage").mockImplementation(
			async function (
				this: InstanceType<typeof GameSession>,
				...args: Parameters<InstanceType<typeof GameSession>["submitMessage"]>
			) {
				const real = await originalSubmit.apply(this, args);
				// Lock out red
				return {
					...real,
					result: {
						...real.result,
						chatLockoutTriggered: {
							aiId: "red" as const,
							message: "Ember is unresponsive…",
						},
					},
				};
			},
		);

		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Trigger one round to lock out red
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Now click red panel — should be no-op because red is locked
		promptInput.value = "";
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');
		redPanel.click();

		// Input should remain empty (red is locked out)
		expect(promptInput.value).toBe("");
	});

	it("'*Nonpersona hi' + click blue → prepends '*Frost '", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const bluePanel = getEl<HTMLElement>('.ai-panel[data-ai="blue"]');

		promptInput.value = "*nonpersona hi";
		promptInput.dispatchEvent(new Event("input"));
		bluePanel.click();

		expect(promptInput.value).toBe("*Frost *nonpersona hi");
	});
});

describe("renderGame — URL param sourcing", () => {
	beforeEach(async () => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		const _stub = makeLocalStorageStub();
		await seedSessionInStub(_stub);
		vi.stubGlobal("localStorage", _stub);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("search-only: ?winImmediately=1 in location.search (router passes empty params) triggers phase_advanced on first submit", async () => {
		// Router always passes a non-null URLSearchParams, but it may be empty
		// when the flag is in location.search rather than the hash query string.
		vi.stubGlobal("location", {
			search: "?winImmediately=1",
			origin: "http://localhost:8787",
			hash: "",
		});
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		// Router passes empty URLSearchParams (hash had no query string)
		await renderGame(getEl<HTMLElement>("main"), new URLSearchParams());

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		// Post-#107: submit handler requires a valid @mention; without one,
		// deriveComposerState returns sendEnabled=false and the submit no-ops.
		promptInput.value = "*Ember go";
		// Dispatch input so the SPA's listener updates the composer state.
		promptInput.dispatchEvent(new Event("input", { bubbles: true }));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Phase banner should be visible — winImmediately fired from location.search
		const phaseBanner = getEl<HTMLElement>("#phase-banner");
		expect(phaseBanner.hasAttribute("hidden")).toBe(false);
		expect(phaseBanner.textContent).toContain("Phase 2");
	});

	it("hash-only: debug=1 in hash params (no location.search) shows action log", async () => {
		vi.stubGlobal("location", {
			search: "",
			origin: "http://localhost:8787",
			hash: "#/?debug=1",
		});
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		// Router parses debug=1 from the hash and passes it as params
		await renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("debug=1"),
		);

		const actionLog = getEl<HTMLElement>("#action-log");
		expect(actionLog.hasAttribute("hidden")).toBe(false);
	});

	it("conflict: location.search has debug=1 but hash params have debug=0 → hash wins, log is hidden", async () => {
		vi.stubGlobal("location", {
			search: "?debug=1",
			origin: "http://localhost:8787",
			hash: "#/?debug=0",
		});
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		// Router passes debug=0 from the hash; location.search has debug=1
		await renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("debug=0"),
		);

		const actionLog = getEl<HTMLElement>("#action-log");
		// Hash wins: debug=0 → log must remain hidden
		expect(actionLog.hasAttribute("hidden")).toBe(true);
	});
});

describe("renderGame — addressee persistence after send", () => {
	beforeEach(async () => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		const _stub = makeLocalStorageStub();
		await seedSessionInStub(_stub);
		vi.stubGlobal("localStorage", _stub);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("first-load: input empty and Send disabled (#107 preserved)", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		expect(promptInput.value).toBe("");
		expect(sendBtn.disabled).toBe(true);
	});

	it("after a successful send: input contains '*Sage ' and Send is disabled", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(promptInput.value).toBe("*Sage ");
		expect(promptInput.selectionStart).toBe(6);
		expect(promptInput.selectionEnd).toBe(6);
		expect(sendBtn.disabled).toBe(true);
	});

	it("typing body text after a successful send re-enables Send", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Send disabled after first send (only prefix remains)
		expect(sendBtn.disabled).toBe(true);

		// Typing body text after the persisted prefix re-enables Send
		promptInput.value = "*Sage how are you";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(false);
	});

	it("two-message conversation: same addressee persists across turns, both in transcript", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeAiSseStream(PASS_ACTION),
		});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		// First turn
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Prefix persists after first send
		expect(promptInput.value).toBe("*Sage ");

		// Second turn: extend the persisted prefix
		promptInput.value = "*Sage how are you";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Prefix persists again after second send
		expect(promptInput.value).toBe("*Sage ");

		// Both messages should be in the green transcript (with leading mention stripped)
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		expect(greenTranscript.textContent).toContain("> hello");
		expect(greenTranscript.textContent).toContain("> how are you");
	});

	it("canonical-name normalization: *sage (lowercase) → '*Sage ' after send", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*sage hi";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Should use canonical name from PERSONAS (Sage, not sage)
		expect(promptInput.value).toBe("*Sage ");
	});

	it("locked-AI at round-completion: mention prefix persists but Send stays disabled", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();

		// Inject chatLockoutTriggered for green so the SPA sets green locked.
		const { GameSession } = await import("../game/game-session.js");
		const originalSubmit = GameSession.prototype.submitMessage;
		vi.spyOn(GameSession.prototype, "submitMessage").mockImplementation(
			async function (
				this: InstanceType<typeof GameSession>,
				...args: Parameters<InstanceType<typeof GameSession>["submitMessage"]>
			) {
				const real = await originalSubmit.apply(this, args);
				return {
					...real,
					result: {
						...real.result,
						chatLockoutTriggered: {
							aiId: "green" as const,
							message: "Sage is unresponsive…",
						},
					},
				};
			},
		);

		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Prefix persists even when green is locked
		expect(promptInput.value).toBe("*Sage ");
		// Send must be disabled: green is locked and no body text
		expect(sendBtn.disabled).toBe(true);
	});
});

describe("visual feedback for active addressee", () => {
	beforeEach(async () => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		const _stub = makeLocalStorageStub();
		await seedSessionInStub(_stub);
		vi.stubGlobal("localStorage", _stub);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("empty input → neutral state: no composer-border-*, no panel--addressed, no mention-highlight", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Trigger input event with empty value
		promptInput.value = "";
		promptInput.dispatchEvent(new Event("input"));

		// No --panel-color set on prompt
		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("");

		// No panel--addressed
		const addressedPanels = document.querySelectorAll(".panel--addressed");
		expect(addressedPanels.length).toBe(0);

		// No mention-highlight in overlay
		const overlay = document.querySelector<HTMLElement>("#prompt-overlay");
		expect(overlay?.querySelector(".mention-highlight")).toBeNull();
	});

	it("typing '*Sage hi' → green border, green panel highlight, *Sage span in overlay", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));

		// Composer border is green
		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("#81b29a");

		// Green panel has highlight classes
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--addressed")).toBe(true);

		// Red and blue panels do NOT have highlight
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');
		const bluePanel = getEl<HTMLElement>('.ai-panel[data-ai="blue"]');
		expect(redPanel.classList.contains("panel--addressed")).toBe(false);
		expect(bluePanel.classList.contains("panel--addressed")).toBe(false);

		// Overlay has exactly one mention-highlight span with *Sage text and mention--green
		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const spans = overlay.querySelectorAll(".mention-highlight");
		expect(spans.length).toBe(1);
		expect(spans[0]?.textContent).toBe("*Sage");
		expect(
			(spans[0] as HTMLElement)?.style.getPropertyValue("--panel-color"),
		).toBe("#81b29a");
	});

	it("multi-mention '*Sage tell *Frost ...' → exactly one mention-highlight for *Sage only", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage tell *Frost ...";
		promptInput.dispatchEvent(new Event("input"));

		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const spans = overlay.querySelectorAll(".mention-highlight");
		expect(spans.length).toBe(1);
		expect(spans[0]?.textContent).toBe("*Sage");
		expect(
			(spans[0] as HTMLElement)?.style.getPropertyValue("--panel-color"),
		).toBe("#81b29a");
	});

	it("trailing punctuation '*Sage,' → overlay mention-highlight has textContent '*Sage' (comma is plain text)", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage,";
		promptInput.dispatchEvent(new Event("input"));

		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const span = overlay.querySelector(".mention-highlight");
		expect(span?.textContent).toBe("*Sage");

		// Comma should be outside the span (in a text node)
		expect(overlay.textContent).toBe("*Sage,");
	});

	it("clearing input → all visual feedback removed", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");

		// First set a mention
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("#81b29a");

		// Now clear
		promptInput.value = "";
		promptInput.dispatchEvent(new Event("input"));

		// --panel-color cleared from prompt
		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("");

		// No panel--addressed
		const addressedPanels = document.querySelectorAll(".panel--addressed");
		expect(addressedPanels.length).toBe(0);

		// No mention-highlight in overlay
		const overlay = getEl<HTMLElement>("#prompt-overlay");
		expect(overlay.querySelector(".mention-highlight")).toBeNull();
	});

	it("panel-click transfers highlight: type *Sage hi then click blue panel → blue border, blue panel, *Frost span", async () => {
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Type *Sage hi
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("#81b29a");

		// Click blue panel
		const bluePanel = getEl<HTMLElement>('.ai-panel[data-ai="blue"]');
		bluePanel.click();

		// Input value should start with *Frost
		expect(promptInput.value.startsWith("*Frost")).toBe(true);

		// Blue border
		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("#5fa8d3");

		// Blue panel has highlight
		expect(bluePanel.classList.contains("panel--addressed")).toBe(true);

		// Green panel no longer highlighted
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--addressed")).toBe(false);

		// Overlay highlight is *Frost with blue --panel-color
		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const span = overlay.querySelector<HTMLElement>(".mention-highlight");
		expect(span?.textContent).toBe("*Frost");
		expect(span?.style.getPropertyValue("--panel-color")).toBe("#5fa8d3");
	});

	it("locked addressee still gets visual feedback (typing path)", async () => {
		vi.stubGlobal("fetch", {});

		vi.resetModules();

		// Import GameSession before renderGame so the spy is in place
		const { GameSession } = await import("../game/game-session.js");
		const originalSubmit = GameSession.prototype.submitMessage;
		vi.spyOn(GameSession.prototype, "submitMessage").mockImplementation(
			async function (
				this: InstanceType<typeof GameSession>,
				...args: Parameters<InstanceType<typeof GameSession>["submitMessage"]>
			) {
				const real = await originalSubmit.apply(this, args);
				return {
					...real,
					result: {
						...real.result,
						chatLockoutTriggered: {
							aiId: "green" as const,
							message: "Sage is unresponsive…",
						},
					},
				};
			},
		);

		// Provide a mock fetch for the session submit
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: (() => {
				const encoder = new TextEncoder();
				const sseData = `data: ${JSON.stringify({ choices: [{ delta: { content: '{"action":"pass"}' } }] })}\n\ndata: [DONE]\n\n`;
				return new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(encoder.encode(sseData));
						controller.close();
					},
				});
			})(),
		});
		vi.stubGlobal("fetch", mockFetch);

		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		// Submit one round to lock green
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Now type *Sage hi (green is locked)
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));

		// Send disabled (green locked)
		expect(sendBtn.disabled).toBe(true);

		// Visual feedback still shows green
		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("#81b29a");
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--addressed")).toBe(true);

		// Overlay still shows the mention highlight
		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const span = overlay.querySelector<HTMLElement>(".mention-highlight");
		expect(span?.textContent).toBe("*Sage");
		expect(span?.style.getPropertyValue("--panel-color")).toBe("#81b29a");
	});
});

describe("renderGame — chat lockout visual affordances (panel muting + inline error)", () => {
	beforeEach(async () => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		const _stub = makeLocalStorageStub();
		await seedSessionInStub(_stub);
		vi.stubGlobal("localStorage", _stub);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	/** Helper: inject a chatLockoutTriggered for a given aiId via submitMessage spy. */
	async function setupLockoutMock(
		aiId: "red" | "green" | "blue",
		message: string,
	) {
		const { GameSession } = await import("../game/game-session.js");
		const originalSubmit = GameSession.prototype.submitMessage;
		vi.spyOn(GameSession.prototype, "submitMessage").mockImplementation(
			async function (
				this: InstanceType<typeof GameSession>,
				...args: Parameters<InstanceType<typeof GameSession>["submitMessage"]>
			) {
				const real = await originalSubmit.apply(this, args);
				return {
					...real,
					result: {
						...real.result,
						chatLockoutTriggered: { aiId, message },
					},
				};
			},
		);
	}

	it("chat_lockout fires → locked panel gains panel--locked and aria-disabled=true", async () => {
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		await setupLockoutMock("red", "Ember is unresponsive…");

		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');
		expect(redPanel.classList.contains("panel--locked")).toBe(true);
		expect(redPanel.getAttribute("aria-disabled")).toBe("true");

		// Green and blue panels should NOT be locked
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		const bluePanel = getEl<HTMLElement>('.ai-panel[data-ai="blue"]');
		expect(greenPanel.classList.contains("panel--locked")).toBe(false);
		expect(bluePanel.classList.contains("panel--locked")).toBe(false);
	});

	it("type *Sage while green locked → Send disabled, #lockout-error visible with text containing 'Sage'", async () => {
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		await setupLockoutMock("green", "Sage is unresponsive…");

		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		// Submit to trigger the lockout
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Type *Sage hi while green is locked
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));

		expect(sendBtn.disabled).toBe(true);

		const lockoutError = getEl<HTMLOutputElement>("#lockout-error");
		expect(lockoutError.hasAttribute("hidden")).toBe(false);
		expect(lockoutError.textContent).toContain("Sage");
	});

	it("chat_lockout_resolved mid-draft → muting clears, #lockout-error hidden, Send re-enables when *Sage re-typed", async () => {
		// First round: inject lockout for green
		// Second round: inject lockout_resolved for green via mock
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		const { GameSession } = await import("../game/game-session.js");
		const originalSubmit = GameSession.prototype.submitMessage;
		let callCount = 0;
		vi.spyOn(GameSession.prototype, "submitMessage").mockImplementation(
			async function (
				this: InstanceType<typeof GameSession>,
				...args: Parameters<InstanceType<typeof GameSession>["submitMessage"]>
			) {
				const real = await originalSubmit.apply(this, args);
				callCount++;
				if (callCount === 1) {
					// First call: lock green
					return {
						...real,
						result: {
							...real.result,
							chatLockoutTriggered: {
								aiId: "green" as const,
								message: "Sage is unresponsive…",
							},
						},
					};
				}
				// Second call: resolve green lockout
				return {
					...real,
					result: {
						...real.result,
						chatLockoutsResolved: ["green" as const],
					},
				};
			},
		);

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeAiSseStream(PASS_ACTION),
		});
		vi.stubGlobal("fetch", mockFetch);

		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Round 1: lock green
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Verify green is locked
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--locked")).toBe(true);

		// Round 2 via *Ember: resolve green lockout
		promptInput.value = "*Ember hi";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Green panel should no longer be locked
		expect(greenPanel.classList.contains("panel--locked")).toBe(false);

		// Type *Sage again: should now enable Send and hide error
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));

		const sendBtn = getEl<HTMLButtonElement>("#send");
		expect(sendBtn.disabled).toBe(false);

		const lockoutError = getEl<HTMLOutputElement>("#lockout-error");
		expect(lockoutError.hasAttribute("hidden")).toBe(true);
	});

	it("empty input + green locked → green panel muted but #lockout-error stays hidden", async () => {
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		await setupLockoutMock("green", "Sage is unresponsive…");

		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Trigger lockout
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Clear input (empty text)
		promptInput.value = "";
		promptInput.dispatchEvent(new Event("input"));

		// Green panel is muted (locked)
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--locked")).toBe(true);

		// Error element is hidden (no addressee)
		const lockoutError = getEl<HTMLOutputElement>("#lockout-error");
		expect(lockoutError.hasAttribute("hidden")).toBe(true);
	});
});
