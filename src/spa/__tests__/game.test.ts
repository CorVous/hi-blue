import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
 */
function makeAiSseStream(jsonAction: string): ReadableStream<Uint8Array> {
	const sseData = `data: ${JSON.stringify({ choices: [{ delta: { content: jsonAction } }] })}\n\ndata: [DONE]\n\n`;
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

	it("after one submit, all three transcript panels have content", async () => {
		const mockFetch = makeThreeAiFetchMock(
			RED_ACTION,
			GREEN_ACTION,
			BLUE_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined,
		});
		// Math.random=0.9 produces identity shuffle: ["red","green","blue"]
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const form = getEl<HTMLFormElement>("#composer");
		promptInput.value = "@Sage hello world";
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage hi";
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");

		// Without debug param: action log should be hidden
		renderGame(getEl<HTMLElement>("main"));
		const actionLog = getEl<HTMLElement>("#action-log");
		expect(actionLog.hasAttribute("hidden")).toBe(true);

		// With debug=1: action log should be visible
		const params = new URLSearchParams("debug=1");
		renderGame(getEl<HTMLElement>("main"), params);
		expect(actionLog.hasAttribute("hidden")).toBe(false);
	});

	it("action-log entries are populated after a round (hidden or visible)", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");

		// Show debug so we can verify entries
		const params = new URLSearchParams("debug=1");
		renderGame(getEl<HTMLElement>("main"), params);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage test";
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

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
		promptInput.value = "@Sage test";
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(mockFetch).toHaveBeenCalledTimes(3);
	});

	it("shows 'thinking…' placeholder in the addressed panel during the round, stripped after responses arrive", async () => {
		const mockFetch = makeThreeAiFetchMock(
			RED_ACTION,
			GREEN_ACTION,
			BLUE_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const form = getEl<HTMLFormElement>("#composer");
		// Address the green panel via @Sage mention
		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		// Synchronously after submit (before fetch resolves), the placeholder is visible
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		expect(greenTranscript.textContent).toContain("thinking…");

		await new Promise((resolve) => setTimeout(resolve, 300));

		// After the round resolves, the placeholder is gone and the response is rendered
		expect(greenTranscript.textContent).not.toContain("thinking…");
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("winImmediately=1"),
		);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage go";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Phase banner should be visible with the phase 2 objective
		const phaseBanner = getEl<HTMLElement>("#phase-banner");
		expect(phaseBanner.hasAttribute("hidden")).toBe(false);
		expect(phaseBanner.textContent).toContain("Phase 2");
		expect(phaseBanner.textContent).toContain("get the key in the keyhole");

		// All transcripts should have been cleared and repopulated with a separator
		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		expect(redTranscript.textContent).toContain("--- Phase 2 begins:");
		// No content from the previous phase should remain
		expect(redTranscript.textContent).not.toContain("[you]");
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("winImmediately=1"),
		);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Submit 1: phase 1 → phase 2 (phase_advanced)
		promptInput.value = "@Sage one";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Submit 2: phase 2 → phase 3 (phase_advanced)
		promptInput.value = "@Sage two";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Submit 3: phase 3 → game_ended
		promptInput.value = "@Sage three";
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
		expect(save.version).toBe(1);
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		const createObjectURLSpy = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:http://localhost/test");
		const revokeObjectURLSpy = vi
			.spyOn(URL, "revokeObjectURL")
			.mockReturnValue(undefined);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("winImmediately=1"),
		);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		for (const msg of ["@Sage one", "@Sage two", "@Sage three"]) {
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("winImmediately=1"),
		);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		for (const msg of ["@Sage one", "@Sage two", "@Sage three"]) {
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(
			getEl<HTMLElement>("main"),
			new URLSearchParams("winImmediately=1"),
		);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		for (const msg of ["@Sage one", "@Sage two", "@Sage three"]) {
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
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// setItem should have been called with the game state key
		expect(stub.setItem).toHaveBeenCalledWith(
			"hi-blue-game-state",
			expect.any(String),
		);
		// Saved JSON must include a transcripts key (bug fix: AI responses persisted)
		const savedJson = stub._store["hi-blue-game-state"];
		expect(savedJson).toBeDefined();
		const saved = JSON.parse(savedJson as string) as Record<string, unknown>;
		expect(saved).toHaveProperty("transcripts");
	});

	it("state is restored from localStorage on renderGame when saved state exists", async () => {
		// First: run a round using chat actions so AI responses land in transcripts
		const stub = makeLocalStorageStub();
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(RED_ACTION, GREEN_ACTION, BLUE_ACTION),
		);
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame: renderGame1 } = await import("../routes/game.js");
		renderGame1(getEl<HTMLElement>("main"));

		const form1 = getEl<HTMLFormElement>("#composer");
		const promptInput1 = getEl<HTMLInputElement>("#prompt");
		promptInput1.value = "@Sage hello";
		promptInput1.dispatchEvent(new Event("input"));
		form1.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Verify state was saved and the saved JSON contains the AI response tag
		expect(stub.setItem).toHaveBeenCalled();
		const savedJson = stub._store["hi-blue-game-state"];
		expect(savedJson).toBeDefined();
		expect(savedJson).toContain("RED_RESPONSE_UNIQUE_TAG");

		// Second: simulate a fresh page load with the saved state
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.resetModules();
		// getItem should return the previously saved state
		const { renderGame: renderGame2 } = await import("../routes/game.js");
		renderGame2(getEl<HTMLElement>("main"));

		// Budget should reflect round 1 complete (4/5)
		const redBudget = document.querySelector<HTMLSpanElement>(
			'.ai-panel[data-ai="red"] .panel-budget',
		);
		expect(redBudget?.textContent).toContain("4");

		// Transcripts must be restored verbatim (regression: AI responses were lost on reload)
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
		// The probe key for isStorageAvailable() is "hi-blue-storage-probe-XXXXX" (not the game key),
		// so we only intercept setItem for the game state key specifically.
		stub.setItem.mockImplementation((key: string, value: string) => {
			if (key === "hi-blue-game-state") {
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
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage test";
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
		promptInput.value = "@Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(false);

		// Warning banner should be visible
		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toBeTruthy();
	});

	it("localStorage disabled shows warning banner and starts a fresh game", async () => {
		// Stub localStorage as completely unavailable (both probe and all calls throw)
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
		renderGame(getEl<HTMLElement>("main"));

		// Warning banner should be shown immediately (storage unavailable)
		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toBeTruthy();

		// Game should still function (submit works)
		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// All three panels should have content (game ran normally)
		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		const blueTranscript = getEl<HTMLElement>('[data-transcript="blue"]');
		expect(redTranscript.textContent?.trim()).toBeTruthy();
		expect(greenTranscript.textContent?.trim()).toBeTruthy();
		expect(blueTranscript.textContent?.trim()).toBeTruthy();
	});

	it("regression #46: transcript content (including raw LLM output) is preserved across a fresh renderGame", async () => {
		// Use pass actions so the raw completion string lands in the transcript
		// even though the parsed action carries no chat content.
		const stub = makeLocalStorageStub();
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame: renderGame1 } = await import("../routes/game.js");
		renderGame1(getEl<HTMLElement>("main"));

		const form1 = getEl<HTMLFormElement>("#composer");
		const promptInput1 = getEl<HTMLInputElement>("#prompt");
		promptInput1.value = "@Sage test";
		promptInput1.dispatchEvent(new Event("input"));
		form1.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Capture the transcript text rendered after the round
		const redTextAfterRound =
			document.querySelector<HTMLElement>('[data-transcript="red"]')
				?.textContent ?? "";
		expect(redTextAfterRound.trim()).toBeTruthy();

		// Saved JSON should include transcripts snapshot
		const savedJson = stub._store["hi-blue-game-state"];
		expect(savedJson).toBeDefined();
		const saved = JSON.parse(savedJson as string) as Record<string, unknown>;
		expect(saved).toHaveProperty("transcripts");

		// Simulate page refresh: fresh renderGame with the same localStorage stub
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.resetModules();
		const { renderGame: renderGame2 } = await import("../routes/game.js");
		renderGame2(getEl<HTMLElement>("main"));

		// Transcript must be restored verbatim from the snapshot
		const redTextRestored =
			document.querySelector<HTMLElement>('[data-transcript="red"]')
				?.textContent ?? "";
		expect(redTextRestored).toBe(redTextAfterRound);
	});
});

describe("renderGame — chat_lockout event", () => {
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

	it("chat_lockout appends the lockout message to the locked AI's transcript", async () => {
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.stubGlobal("localStorage", { getItem: () => null });
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
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 300));

		// The chat_lockout event should have appended the message to red's transcript.
		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		expect(redTranscript.textContent).toContain("[Ember is unresponsive…]");

		// After the chat_lockout fires for red, typing @Ember should leave Send disabled.
		const sendBtn = getEl<HTMLButtonElement>("#send");
		promptInput.value = "@Ember hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(true);
	});
});

describe("renderGame — mention-based addressing", () => {
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

	it("empty input on initial load leaves Send disabled", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const sendBtn = getEl<HTMLButtonElement>("#send");
		expect(sendBtn.disabled).toBe(true);
	});

	it("typing 'hi' (no mention) leaves Send disabled", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		promptInput.value = "hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(true);
	});

	it("typing '@Sage hi' enables Send", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		promptInput.value = "@Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(false);
	});

	it("submit with '@Sage hi' routes [you] message to green panel", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		const blueTranscript = getEl<HTMLElement>('[data-transcript="blue"]');

		expect(greenTranscript.textContent).toContain("[you] @Sage hi");
		expect(redTranscript.textContent).not.toContain("[you]");
		expect(blueTranscript.textContent).not.toContain("[you]");
	});

	it("@Sage while green locked leaves Send disabled", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", { getItem: () => null });
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
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		// Submit first round to trigger the lockout
		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// After a successful send with green locked, the persisted prefix is written.
		expect(promptInput.value).toBe("@Sage ");

		// Now typing @Sage should leave Send disabled (green is locked)
		promptInput.value = "@Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(true);
	});
});

describe("renderGame — panel-click addressee", () => {
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

	it("empty input + click red panel → '@Ember ', Send stays disabled (no body)", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');

		expect(promptInput.value).toBe("");
		redPanel.click();

		expect(promptInput.value).toBe("@Ember ");
		// Per #110: addressee prefix alone is not enough to enable Send.
		expect(sendBtn.disabled).toBe(true);
	});

	it("'@Sage hi' in input + click red panel → '@Ember hi'", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');

		promptInput.value = "@Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		redPanel.click();

		expect(promptInput.value).toBe("@Ember hi");
	});

	it("multi-mention '@Sage tell @Frost go' + click red → only first mention replaced", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');

		promptInput.value = "@Sage tell @Frost go";
		promptInput.dispatchEvent(new Event("input"));
		redPanel.click();

		expect(promptInput.value).toBe("@Ember tell @Frost go");
	});

	it("cursor is preserved after mention mutation (after the mention)", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');

		promptInput.value = "@Sage hi";
		// Simulate cursor at end (position 8)
		promptInput.setSelectionRange(8, 8);
		redPanel.click();

		// "@Ember hi" length is 9; cursor was at 8 (after @Sage hi), delta = 1 → 9
		expect(promptInput.selectionStart).toBe(9);
	});

	it("clicking a locked panel is a no-op (input unchanged)", async () => {
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.stubGlobal("localStorage", { getItem: () => null });
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
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Trigger one round to lock out red
		promptInput.value = "@Sage hello";
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

	it("'@Nonpersona hi' + click blue → prepends '@Frost '", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const bluePanel = getEl<HTMLElement>('.ai-panel[data-ai="blue"]');

		promptInput.value = "@nonpersona hi";
		promptInput.dispatchEvent(new Event("input"));
		bluePanel.click();

		expect(promptInput.value).toBe("@Frost @nonpersona hi");
	});
});

describe("renderGame — URL param sourcing", () => {
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		// Router passes empty URLSearchParams (hash had no query string)
		renderGame(getEl<HTMLElement>("main"), new URLSearchParams());

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		// Post-#107: submit handler requires a valid @mention; without one,
		// deriveComposerState returns sendEnabled=false and the submit no-ops.
		promptInput.value = "@Ember go";
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		// Router parses debug=1 from the hash and passes it as params
		renderGame(getEl<HTMLElement>("main"), new URLSearchParams("debug=1"));

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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		// Router passes debug=0 from the hash; location.search has debug=1
		renderGame(getEl<HTMLElement>("main"), new URLSearchParams("debug=0"));

		const actionLog = getEl<HTMLElement>("#action-log");
		// Hash wins: debug=0 → log must remain hidden
		expect(actionLog.hasAttribute("hidden")).toBe(true);
	});
});

describe("renderGame — addressee persistence after send", () => {
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

	it("first-load: input empty and Send disabled (#107 preserved)", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		expect(promptInput.value).toBe("");
		expect(sendBtn.disabled).toBe(true);
	});

	it("after a successful send: input contains '@Sage ' and Send is disabled", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(promptInput.value).toBe("@Sage ");
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Send disabled after first send (only prefix remains)
		expect(sendBtn.disabled).toBe(true);

		// Typing body text after the persisted prefix re-enables Send
		promptInput.value = "@Sage how are you";
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		// First turn
		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Prefix persists after first send
		expect(promptInput.value).toBe("@Sage ");

		// Second turn: extend the persisted prefix
		promptInput.value = "@Sage how are you";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Prefix persists again after second send
		expect(promptInput.value).toBe("@Sage ");

		// Both messages should be in the green transcript
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		expect(greenTranscript.textContent).toContain("[you] @Sage hello");
		expect(greenTranscript.textContent).toContain("[you] @Sage how are you");
	});

	it("canonical-name normalization: @sage (lowercase) → '@Sage ' after send", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "@sage hi";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Should use canonical name from PERSONAS (Sage, not sage)
		expect(promptInput.value).toBe("@Sage ");
	});

	it("locked-AI at round-completion: mention prefix persists but Send stays disabled", async () => {
		const mockFetch = makeThreeAiFetchMock(
			PASS_ACTION,
			PASS_ACTION,
			PASS_ACTION,
		);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", { getItem: () => null });
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
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Prefix persists even when green is locked
		expect(promptInput.value).toBe("@Sage ");
		// Send must be disabled: green is locked and no body text
		expect(sendBtn.disabled).toBe(true);
	});
});

describe("visual feedback for active addressee", () => {
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

	it("empty input → neutral state: no composer-border-*, no panel--addressed, no mention-highlight", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Trigger input event with empty value
		promptInput.value = "";
		promptInput.dispatchEvent(new Event("input"));

		// No composer-border-- class
		const hasAnyBorder = [...promptInput.classList].some((c) =>
			c.startsWith("composer-border--"),
		);
		expect(hasAnyBorder).toBe(false);

		// No panel--addressed
		const addressedPanels = document.querySelectorAll(".panel--addressed");
		expect(addressedPanels.length).toBe(0);

		// No mention-highlight in overlay
		const overlay = document.querySelector<HTMLElement>("#prompt-overlay");
		expect(overlay?.querySelector(".mention-highlight")).toBeNull();
	});

	it("typing '@Sage hi' → green border, green panel highlight, @Sage span in overlay", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage hi";
		promptInput.dispatchEvent(new Event("input"));

		// Composer border is green
		expect(promptInput.classList.contains("composer-border--green")).toBe(true);

		// Green panel has highlight classes
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--addressed")).toBe(true);
		expect(greenPanel.classList.contains("panel--addressed-green")).toBe(true);

		// Red and blue panels do NOT have highlight
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');
		const bluePanel = getEl<HTMLElement>('.ai-panel[data-ai="blue"]');
		expect(redPanel.classList.contains("panel--addressed")).toBe(false);
		expect(bluePanel.classList.contains("panel--addressed")).toBe(false);

		// Overlay has exactly one mention-highlight span with @Sage text and mention--green
		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const spans = overlay.querySelectorAll(".mention-highlight");
		expect(spans.length).toBe(1);
		expect(spans[0]?.textContent).toBe("@Sage");
		expect(spans[0]?.classList.contains("mention--green")).toBe(true);
	});

	it("multi-mention '@Sage tell @Frost ...' → exactly one mention-highlight for @Sage only", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage tell @Frost ...";
		promptInput.dispatchEvent(new Event("input"));

		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const spans = overlay.querySelectorAll(".mention-highlight");
		expect(spans.length).toBe(1);
		expect(spans[0]?.textContent).toBe("@Sage");
		expect(spans[0]?.classList.contains("mention--green")).toBe(true);
	});

	it("trailing punctuation '@Sage,' → overlay mention-highlight has textContent '@Sage' (comma is plain text)", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage,";
		promptInput.dispatchEvent(new Event("input"));

		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const span = overlay.querySelector(".mention-highlight");
		expect(span?.textContent).toBe("@Sage");

		// Comma should be outside the span (in a text node)
		expect(overlay.textContent).toBe("@Sage,");
	});

	it("clearing input → all visual feedback removed", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");

		// First set a mention
		promptInput.value = "@Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(promptInput.classList.contains("composer-border--green")).toBe(true);

		// Now clear
		promptInput.value = "";
		promptInput.dispatchEvent(new Event("input"));

		// All composer-border-- classes removed
		const hasAnyBorder = [...promptInput.classList].some((c) =>
			c.startsWith("composer-border--"),
		);
		expect(hasAnyBorder).toBe(false);

		// No panel--addressed
		const addressedPanels = document.querySelectorAll(".panel--addressed");
		expect(addressedPanels.length).toBe(0);

		// No mention-highlight in overlay
		const overlay = getEl<HTMLElement>("#prompt-overlay");
		expect(overlay.querySelector(".mention-highlight")).toBeNull();
	});

	it("panel-click transfers highlight: type @Sage hi then click blue panel → blue border, blue panel, @Frost span", async () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Type @Sage hi
		promptInput.value = "@Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(promptInput.classList.contains("composer-border--green")).toBe(true);

		// Click blue panel
		const bluePanel = getEl<HTMLElement>('.ai-panel[data-ai="blue"]');
		bluePanel.click();

		// Input value should start with @Frost
		expect(promptInput.value.startsWith("@Frost")).toBe(true);

		// Blue border
		expect(promptInput.classList.contains("composer-border--blue")).toBe(true);
		expect(promptInput.classList.contains("composer-border--green")).toBe(
			false,
		);

		// Blue panel has highlight
		expect(bluePanel.classList.contains("panel--addressed")).toBe(true);
		expect(bluePanel.classList.contains("panel--addressed-blue")).toBe(true);

		// Green panel no longer highlighted
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--addressed")).toBe(false);

		// Overlay highlight is @Frost with mention--blue
		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const span = overlay.querySelector(".mention-highlight");
		expect(span?.textContent).toBe("@Frost");
		expect(span?.classList.contains("mention--blue")).toBe(true);
	});

	it("locked addressee still gets visual feedback (typing path)", async () => {
		vi.stubGlobal("fetch", {});
		vi.stubGlobal("localStorage", { getItem: () => null });

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
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		// Submit one round to lock green
		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Now type @Sage hi (green is locked)
		promptInput.value = "@Sage hi";
		promptInput.dispatchEvent(new Event("input"));

		// Send disabled (green locked)
		expect(sendBtn.disabled).toBe(true);

		// Visual feedback still shows green
		expect(promptInput.classList.contains("composer-border--green")).toBe(true);
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--addressed")).toBe(true);

		// Overlay still shows the mention highlight
		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const span = overlay.querySelector(".mention-highlight");
		expect(span?.textContent).toBe("@Sage");
		expect(span?.classList.contains("mention--green")).toBe(true);
	});
});

describe("renderGame — chat lockout visual affordances (panel muting + inline error)", () => {
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

	/** Helper: inject a chatLockoutTriggered for a given aiId via submitMessage spy. */
	async function setupLockoutMock(aiId: "red" | "green" | "blue", message: string) {
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		await setupLockoutMock("red", "Ember is unresponsive…");

		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
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

	it("type @Sage while green locked → Send disabled, #lockout-error visible with text containing 'Sage'", async () => {
		vi.stubGlobal(
			"fetch",
			makeThreeAiFetchMock(PASS_ACTION, PASS_ACTION, PASS_ACTION),
		);
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		await setupLockoutMock("green", "Sage is unresponsive…");

		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		// Submit to trigger the lockout
		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Type @Sage hi while green is locked
		promptInput.value = "@Sage hi";
		promptInput.dispatchEvent(new Event("input"));

		expect(sendBtn.disabled).toBe(true);

		const lockoutError = getEl<HTMLOutputElement>("#lockout-error");
		expect(lockoutError.hasAttribute("hidden")).toBe(false);
		expect(lockoutError.textContent).toContain("Sage");
	});

	it("chat_lockout_resolved mid-draft → muting clears, #lockout-error hidden, Send re-enables when @Sage re-typed", async () => {
		// First round: inject lockout for green
		// Second round: inject lockout_resolved for green via mock
		vi.stubGlobal("localStorage", { getItem: () => null });
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
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Round 1: lock green
		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Verify green is locked
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--locked")).toBe(true);

		// Round 2 via @Ember: resolve green lockout
		promptInput.value = "@Ember hi";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Green panel should no longer be locked
		expect(greenPanel.classList.contains("panel--locked")).toBe(false);

		// Type @Sage again: should now enable Send and hide error
		promptInput.value = "@Sage hi";
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		await setupLockoutMock("green", "Sage is unresponsive…");

		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		// Trigger lockout
		promptInput.value = "@Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
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
