import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_SAVE_VERSION } from "../../save-serializer";
import { BOOTSTRAP_LOADING_TIMEOUT_MS } from "../game/bootstrap.js";
import {
	installLocalStorageStub,
	type LocalStorageStub,
	makeLocalStorageStub,
	seedSessionInStub,
} from "./fixtures/local-storage";
import {
	STATIC_CONTENT_PACKS,
	STATIC_OBJECTIVE_TYPES,
} from "./fixtures/static-content-packs";
import { STATIC_PERSONAS } from "./fixtures/static-personas";
import { waitUntilPasses } from "./fixtures/wait-until-passes";

vi.mock("../../content/persona-generator", () => ({
	generatePersonas: async () => STATIC_PERSONAS,
}));

vi.mock("../../content/content-pack-generator", () => ({
	generateDualContentPacks: async () => ({
		packA: STATIC_CONTENT_PACKS[0],
		packB: STATIC_CONTENT_PACKS[0],
		objectiveTypes: STATIC_OBJECTIVE_TYPES,
	}),
}));

const IDENTITY_SHUFFLE_RANDOM = 0.9;

const INDEX_BODY_HTML = `
<div id="stage"></div>
<main>
  <div id="topinfo">
    <span id="topinfo-left"></span>
    <span id="topinfo-right"></span>
  </div>
  <div id="topinfo-mobile-status"></div>
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
    <div class="prompt-wrap">
      <div id="prompt-overlay" aria-hidden="true"></div>
      <input id="prompt" type="text" placeholder="Enter a message…" autocomplete="off" />
    </div>
    <output id="lockout-error" class="lockout-error" role="status" aria-live="polite" hidden></output>
    <output id="round-error" class="round-error" role="status" aria-live="polite" hidden></output>
    <button id="send" type="submit">Send</button>
  </form>
  <section id="cap-hit" hidden></section>
  <section id="bootstrap-recovery" hidden>
    <h2 id="bootstrap-recovery-title"></h2>
    <pre id="bootstrap-recovery-body" class="cap-hit-body"></pre>
    <div class="bootstrap-recovery-actions">
      <button type="button" id="bootstrap-recovery-regen">[ regenerate world ]</button>
      <a id="bootstrap-recovery-abandon" href="#/start?reason=broken">abandon and reconnect</a>
    </div>
  </section>
  <aside id="persistence-warning" hidden role="status" aria-live="polite"></aside>
  <section id="endgame" hidden>
    <h2>hi-blue — endgame</h2>
    <div id="endgame-subtitle"></div>
    <div id="endgame-final-round" class="endgame-section" hidden>
      <div id="endgame-final-lines" class="transcript"></div>
    </div>
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

async function waitForRoundToSettle(): Promise<void> {
	await waitUntilPasses(() =>
		expect(getEl("#stage").hasAttribute("data-round-in-flight")).toBe(false),
	);
}

function setSearch(query: string): void {
	window.history.replaceState({}, "", `/?${query}`);
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

function makePassSseStream(): ReadableStream<Uint8Array> {
	const deltaChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: "" } }] })}\n\n`;
	const usageChunk = `data: ${JSON.stringify({ choices: [], usage: { cost: 0.01, total_tokens: 100 } })}\n\n`;
	const sseData = `${deltaChunk}${usageChunk}data: [DONE]\n\n`;
	return makeSSEStream([sseData]);
}

function makeMessageToolCallSseStream(
	content: string,
): ReadableStream<Uint8Array> {
	const args = JSON.stringify({ to: "blue", content });
	const chunk1 = `data: ${JSON.stringify({
		choices: [
			{
				delta: {
					tool_calls: [
						{
							index: 0,
							id: "call_msg",
							function: { name: "message", arguments: "" },
						},
					],
				},
			},
		],
	})}\n\n`;
	const chunk2 = `data: ${JSON.stringify({
		choices: [
			{
				delta: { tool_calls: [{ index: 0, function: { arguments: args } }] },
				finish_reason: "tool_calls",
			},
		],
	})}\n\n`;
	const usageChunk = `data: ${JSON.stringify({ choices: [], usage: { cost: 0.01, total_tokens: 100 } })}\n\n`;
	const sseData = `${chunk1}${chunk2}${usageChunk}data: [DONE]\n\n`;
	return makeSSEStream([sseData]);
}

function makeThreeAiPassFetchMock() {
	return vi
		.fn()
		.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makePassSseStream(),
		})
		.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makePassSseStream(),
		})
		.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makePassSseStream(),
		});
}

function makeMessageToolCallSseStreamTo(
	to: string,
	content: string,
): ReadableStream<Uint8Array> {
	const args = JSON.stringify({ to, content });
	const chunk1 = `data: ${JSON.stringify({
		choices: [
			{
				delta: {
					tool_calls: [
						{
							index: 0,
							id: "call_peer",
							function: { name: "message", arguments: "" },
						},
					],
				},
			},
		],
	})}\n\n`;
	const chunk2 = `data: ${JSON.stringify({
		choices: [
			{
				delta: { tool_calls: [{ index: 0, function: { arguments: args } }] },
				finish_reason: "tool_calls",
			},
		],
	})}\n\n`;
	const usageChunk = `data: ${JSON.stringify({ choices: [], usage: { cost: 0.01, total_tokens: 100 } })}\n\n`;
	const sseData = `${chunk1}${chunk2}${usageChunk}data: [DONE]\n\n`;
	return makeSSEStream([sseData]);
}

function makeMessageToolCallFetchMock() {
	return vi
		.fn()
		.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeMessageToolCallSseStream("RED_RESPONSE_UNIQUE_TAG"),
		})
		.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeMessageToolCallSseStream("GREEN_RESPONSE_UNIQUE_TAG"),
		})
		.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makeMessageToolCallSseStream("CYAN_RESPONSE_UNIQUE_TAG"),
		});
}

async function installSeededLocalStorage(): Promise<LocalStorageStub> {
	const stub = makeLocalStorageStub();
	await seedSessionInStub(stub, { objectiveTypes: STATIC_OBJECTIVE_TYPES });
	vi.stubGlobal("localStorage", stub);
	return stub;
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.resetModules();
	document.body.innerHTML = "";
});

describe("renderGame (game route — three-AI)", () => {
	let _stub: LocalStorageStub;

	beforeEach(async () => {
		document.body.innerHTML = INDEX_BODY_HTML;
		_stub = await installSeededLocalStorage();
	});

	it("after one submit, all three transcript panels have content", async () => {
		const mockFetch = makeMessageToolCallFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const form = getEl<HTMLFormElement>("#composer");
		promptInput.value = "*Sage hello world";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		const cyanTranscript = getEl<HTMLElement>('[data-transcript="cyan"]');

		await waitUntilPasses(() => {
			expect(redTranscript.textContent?.trim()).toBeTruthy();
			expect(greenTranscript.textContent?.trim()).toBeTruthy();
			expect(cyanTranscript.textContent?.trim()).toBeTruthy();
		});
	});

	it("each panel only contains its own AI's completion text", async () => {
		const mockFetch = makeMessageToolCallFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		const cyanTranscript = getEl<HTMLElement>('[data-transcript="cyan"]');

		await waitUntilPasses(() => {
			expect(redTranscript.textContent).toContain("RED_RESPONSE_UNIQUE_TAG");
			expect(greenTranscript.textContent).toContain(
				"GREEN_RESPONSE_UNIQUE_TAG",
			);
			expect(cyanTranscript.textContent).toContain("CYAN_RESPONSE_UNIQUE_TAG");
		});

		expect(redTranscript.textContent).not.toContain(
			"GREEN_RESPONSE_UNIQUE_TAG",
		);
		expect(redTranscript.textContent).not.toContain("CYAN_RESPONSE_UNIQUE_TAG");
	});

	it("budgets decrement after a round (5 -> 4 for all AIs)", async () => {
		const mockFetch = makeThreeAiPassFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const redBudget = document.querySelector<HTMLSpanElement>(
			'.ai-panel[data-ai="red"] .panel-budget',
		);
		const greenBudget = document.querySelector<HTMLSpanElement>(
			'.ai-panel[data-ai="green"] .panel-budget',
		);
		const cyanBudget = document.querySelector<HTMLSpanElement>(
			'.ai-panel[data-ai="cyan"] .panel-budget',
		);
		expect(redBudget?.textContent).toContain("5");

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => expect(redBudget?.textContent).toContain("4"));
		expect(greenBudget?.textContent).toContain("4");
		expect(cyanBudget?.textContent).toContain("4");
	});

	it("fetch is called exactly three times per round (once per AI)", async () => {
		const mockFetch = makeThreeAiPassFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => expect(mockFetch).toHaveBeenCalledTimes(3));
	});

	it("shows per-daemon braille spinners during the round, stripped after responses arrive", async () => {
		const mockFetch = makeMessageToolCallFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const form = getEl<HTMLFormElement>("#composer");
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		const cyanPanel = getEl<HTMLElement>('.ai-panel[data-ai="cyan"]');
		expect(redPanel.querySelector(".panel-name .panel-spinner")).not.toBeNull();
		expect(
			greenPanel.querySelector(".panel-name .panel-spinner"),
		).not.toBeNull();
		expect(
			cyanPanel.querySelector(".panel-name .panel-spinner"),
		).not.toBeNull();

		expect(promptInput.value).toBe("*Sage ");
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		expect(greenTranscript.textContent).toContain("> hello");
		expect(greenTranscript.textContent).not.toContain("> *Sage hello");

		await waitUntilPasses(() =>
			expect(redPanel.querySelector(".panel-spinner")).toBeNull(),
		);
		expect(greenPanel.querySelector(".panel-spinner")).toBeNull();
		expect(cyanPanel.querySelector(".panel-spinner")).toBeNull();
		expect(greenTranscript.textContent).toContain("GREEN_RESPONSE_UNIQUE_TAG");
	});

	it("daemon→daemon peer-to-peer message is silent in all panels (AC #2)", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				statusText: "OK",
				body: makeMessageToolCallSseStreamTo("green", "PEER_PEER_TAG"),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				statusText: "OK",
				body: makeMessageToolCallSseStream("GREEN_RESPONSE_UNIQUE_TAG"),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				statusText: "OK",
				body: makeMessageToolCallSseStream("CYAN_RESPONSE_UNIQUE_TAG"),
			});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const form = getEl<HTMLFormElement>("#composer");
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		const cyanTranscript = getEl<HTMLElement>('[data-transcript="cyan"]');

		await waitUntilPasses(() =>
			expect(greenTranscript.textContent).toContain(
				"GREEN_RESPONSE_UNIQUE_TAG",
			),
		);
		expect(redTranscript.textContent).not.toContain("PEER_PEER_TAG");
		expect(greenTranscript.textContent).not.toContain("PEER_PEER_TAG");
		expect(cyanTranscript.textContent).not.toContain("PEER_PEER_TAG");

		expect(greenTranscript.textContent).toContain("GREEN_RESPONSE_UNIQUE_TAG");
		expect(cyanTranscript.textContent).toContain("CYAN_RESPONSE_UNIQUE_TAG");
	});

	it("player outgoing message renders without blue: prefix (AC #3)", async () => {
		const mockFetch = makeThreeAiPassFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const form = getEl<HTMLFormElement>("#composer");
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');

		await waitUntilPasses(() => {
			const occurrences =
				(greenTranscript.textContent ?? "").split("> hello").length - 1;
			expect(occurrences).toBe(1);
		});
		expect(greenTranscript.textContent).not.toContain("blue:");
		expect(greenTranscript.textContent).not.toContain("blue: hello");
	});

	it("after a winImmediately win, endgame screen shown and chat hidden; download button has parseable GameSave", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makePassSseStream(),
		});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		setSearch("winImmediately=1");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage one";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		const panelsEl = document.querySelector<HTMLElement>("#panels");
		await waitUntilPasses(() => expect(panelsEl?.hidden).toBe(true));

		const composerEl = document.querySelector<HTMLElement>("#composer");
		expect(composerEl?.hidden).toBe(true);

		const endgameEl = getEl<HTMLElement>("#endgame");
		expect(endgameEl.hasAttribute("hidden")).toBe(false);

		const downloadBtn = getEl<HTMLButtonElement>("#download-ais-btn");
		const saveJson = downloadBtn.dataset.savePayload;
		expect(saveJson).toBeTruthy();
		const save = JSON.parse(saveJson as string);
		expect(save.version).toBe(GAME_SAVE_VERSION);
		expect(save.ais).toHaveLength(3);
	});

	it("clicking download button triggers blob download, disables button, shows 'Saved.'", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makePassSseStream(),
		});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		const createObjectURLSpy = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:http://localhost/test");
		const revokeObjectURLSpy = vi
			.spyOn(URL, "revokeObjectURL")
			.mockReturnValue(undefined);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		setSearch("winImmediately=1");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage one";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		const endgameEl2 = getEl<HTMLElement>("#endgame");
		await waitUntilPasses(() =>
			expect(endgameEl2.hasAttribute("hidden")).toBe(false),
		);

		const downloadBtn = getEl<HTMLButtonElement>("#download-ais-btn");
		const downloadStatus = getEl<HTMLElement>("#download-status");
		downloadBtn.click();

		expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
		expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
		expect(downloadBtn.disabled).toBe(true);
		expect(downloadStatus.textContent).toBe("Saved.");
	});

	it("clicking submit-diagnostics with empty summary shows validation message and does NOT POST", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makePassSseStream(),
		});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		setSearch("winImmediately=1");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage one";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		const endgameEl = getEl<HTMLElement>("#endgame");
		await waitUntilPasses(() =>
			expect(endgameEl.hasAttribute("hidden")).toBe(false),
		);

		const callCountBeforeDiagnostics = mockFetch.mock.calls.length;

		const submitDiagnosticsBtn = getEl<HTMLButtonElement>(
			"#submit-diagnostics-btn",
		);
		const diagnosticsStatus = getEl<HTMLElement>("#diagnostics-status");

		submitDiagnosticsBtn.click();
		expect(diagnosticsStatus.textContent).toContain(
			"Please enter a one-word summary first.",
		);
		expect(mockFetch.mock.calls.length).toBe(callCountBeforeDiagnostics);
	});

	it("clicking submit-diagnostics with a summary POSTs to /diagnostics with mode: no-cors", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makePassSseStream(),
		});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		setSearch("winImmediately=1");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage one";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		const endgameEl = getEl<HTMLElement>("#endgame");
		await waitUntilPasses(() =>
			expect(endgameEl.hasAttribute("hidden")).toBe(false),
		);

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

		await waitUntilPasses(() =>
			expect(mockFetch.mock.calls.length).toBe(callCountBeforeDiagnostics + 1),
		);
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
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
	});

	it("state is saved to localStorage after a successful round", async () => {
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub, { objectiveTypes: STATIC_OBJECTIVE_TYPES });
		vi.stubGlobal("fetch", makeThreeAiPassFetchMock());
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		const engineKey = await waitUntilPasses(() => {
			const key = Object.keys(stub._store).find((k) =>
				k.endsWith("/engine.dat"),
			);
			expect(key).toBeDefined();
			return key;
		});
		if (!engineKey) throw new Error("engineKey should be defined");
		expect(stub._store[engineKey]).toMatch(/^[A-Za-z0-9+/=]+$/);
	});

	it("state is restored from localStorage on renderGame when saved state exists", async () => {
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub, { objectiveTypes: STATIC_OBJECTIVE_TYPES });
		vi.stubGlobal("fetch", makeMessageToolCallFetchMock());
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame: renderGame1 } = await import("../views/game.js");
		await renderGame1(getEl<HTMLElement>("main"));

		const form1 = getEl<HTMLFormElement>("#composer");
		const promptInput1 = getEl<HTMLInputElement>("#prompt");
		promptInput1.value = "*Sage hello";
		promptInput1.dispatchEvent(new Event("input"));
		form1.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => {
			expect(stub.setItem).toHaveBeenCalled();
			const key = Object.keys(stub._store).find((k) =>
				k.endsWith("/engine.dat"),
			);
			expect(key).toBeDefined();
		});

		await waitUntilPasses(() => {
			const keys = Object.keys(stub._store).filter(
				(k) => k.endsWith(".txt") && !k.endsWith("whispers.txt"),
			);
			const contents = keys.map((k) => stub._store[k] ?? "").join("");
			expect(contents).toContain("RED_RESPONSE_UNIQUE_TAG");
		});

		document.body.innerHTML = INDEX_BODY_HTML;
		vi.resetModules();
		const { renderGame: renderGame2 } = await import("../views/game.js");
		await renderGame2(getEl<HTMLElement>("main"));

		const redBudget = document.querySelector<HTMLSpanElement>(
			'.ai-panel[data-ai="red"] .panel-budget',
		);
		expect(redBudget?.textContent).toBe("49.000¢");

		const redTranscript = document.querySelector<HTMLElement>(
			'[data-transcript="red"]',
		);
		const greenTranscript = document.querySelector<HTMLElement>(
			'[data-transcript="green"]',
		);
		const cyanTranscript = document.querySelector<HTMLElement>(
			'[data-transcript="cyan"]',
		);
		expect(redTranscript?.textContent).toContain("RED_RESPONSE_UNIQUE_TAG");
		expect(greenTranscript?.textContent).toContain("GREEN_RESPONSE_UNIQUE_TAG");
		expect(cyanTranscript?.textContent).toContain("CYAN_RESPONSE_UNIQUE_TAG");
	});

	it("quota-exceeded localStorage write surfaces the warning banner without breaking the round", async () => {
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub, { objectiveTypes: STATIC_OBJECTIVE_TYPES });
		stub.setItem.mockImplementation((key: string, value: string) => {
			if (key.endsWith("/engine.dat")) {
				throw Object.assign(new DOMException("quota", "QuotaExceededError"));
			}
			(stub as { _store: Record<string, string> })._store[key] = value;
		});
		vi.stubGlobal("fetch", makeThreeAiPassFetchMock());
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage test";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		const sendBtn = getEl<HTMLButtonElement>("#send");
		await waitUntilPasses(() => {
			promptInput.value = "*Sage hi";
			promptInput.dispatchEvent(new Event("input"));
			expect(sendBtn.disabled).toBe(false);
		});

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toBeTruthy();
	});

	it("localStorage disabled shows warning banner (gameplay not possible without storage)", async () => {
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

		vi.stubGlobal("fetch", makeThreeAiPassFetchMock());
		vi.stubGlobal("localStorage", unavailableStub);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const warningEl = document.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		expect(warningEl?.hasAttribute("hidden")).toBe(false);
		expect(warningEl?.textContent).toBeTruthy();
	});

	it("chat message content is preserved across a fresh renderGame via chatHistories", async () => {
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub, { objectiveTypes: STATIC_OBJECTIVE_TYPES });
		vi.stubGlobal("fetch", makeMessageToolCallFetchMock());
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame: renderGame1 } = await import("../views/game.js");
		await renderGame1(getEl<HTMLElement>("main"));

		const form1 = getEl<HTMLFormElement>("#composer");
		const promptInput1 = getEl<HTMLInputElement>("#prompt");
		promptInput1.value = "*Sage hello";
		promptInput1.dispatchEvent(new Event("input"));
		form1.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => {
			const daemonKeys = Object.keys(stub._store).filter(
				(k) => k.endsWith(".txt") && !k.endsWith("whispers.txt"),
			);
			const daemonContentsAfterRound = daemonKeys
				.map((k) => stub._store[k] ?? "")
				.join("");
			expect(daemonContentsAfterRound).toContain("RED_RESPONSE_UNIQUE_TAG");
		});

		const engineKey = Object.keys(stub._store).find((k) =>
			k.endsWith("/engine.dat"),
		);
		expect(engineKey).toBeDefined();

		document.body.innerHTML = INDEX_BODY_HTML;
		vi.resetModules();
		const { renderGame: renderGame2 } = await import("../views/game.js");
		await renderGame2(getEl<HTMLElement>("main"));

		const redTextRestored =
			document.querySelector<HTMLElement>('[data-transcript="red"]')
				?.textContent ?? "";
		expect(redTextRestored).toContain("RED_RESPONSE_UNIQUE_TAG");
	});

	it("transcripts swap to the new session when the active pointer moves mid-SPA (no page refresh, #203 [ load ] regression)", async () => {
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub, { objectiveTypes: STATIC_OBJECTIVE_TYPES });
		vi.stubGlobal("fetch", makeMessageToolCallFetchMock());
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() =>
			expect(
				document.querySelector<HTMLElement>('[data-transcript="red"]')
					?.textContent ?? "",
			).toContain("RED_RESPONSE_UNIQUE_TAG"),
		);

		const { buildSessionFromAssets } = await import("../game/bootstrap.js");
		const { setActiveSessionId, saveActiveSession } = await import(
			"../persistence/session-storage.js"
		);
		setActiveSessionId("0xB000");
		const sessionB = buildSessionFromAssets({
			personas: STATIC_PERSONAS,
			contentPacksA: STATIC_CONTENT_PACKS,
			contentPacksB: STATIC_CONTENT_PACKS,
		});
		saveActiveSession(sessionB.getState());

		await renderGame(getEl<HTMLElement>("main"));

		expect(
			document.querySelector<HTMLElement>('[data-transcript="red"]')
				?.textContent ?? "",
		).not.toContain("RED_RESPONSE_UNIQUE_TAG");
		expect(
			document.querySelector<HTMLElement>('[data-transcript="green"]')
				?.textContent ?? "",
		).not.toContain("GREEN_RESPONSE_UNIQUE_TAG");
		expect(
			document.querySelector<HTMLElement>('[data-transcript="cyan"]')
				?.textContent ?? "",
		).not.toContain("CYAN_RESPONSE_UNIQUE_TAG");
	});
});

describe("renderGame — a round still in flight when the player loads another session", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
	});

	function makeHeldMessageToolCallFetchMock() {
		let releaseRound: () => void = () => undefined;
		const roundReleased = new Promise<void>((resolve) => {
			releaseRound = resolve;
		});
		const replies = makeMessageToolCallFetchMock();
		const fetchMock = vi.fn(async (...args: unknown[]) => {
			await roundReleased;
			return replies(...args);
		});
		return { fetchMock, releaseRound };
	}

	async function startHeldRoundThenLoadSessionB(stub: LocalStorageStub) {
		const { fetchMock, releaseRound } = makeHeldMessageToolCallFetchMock();
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("localStorage", stub);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		const storage = await import("../persistence/session-storage.js");
		const sessionAId = storage.getActiveSessionId();
		await renderGame(getEl<HTMLElement>("main"));
		getEl<HTMLElement>("main").dataset.view = "game";

		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		getEl<HTMLFormElement>("#composer").dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => expect(fetchMock).toHaveBeenCalled());

		const { buildSessionFromAssets } = await import("../game/bootstrap.js");
		storage.setActiveSessionId("0xB000");
		storage.saveActiveSession(
			buildSessionFromAssets({
				personas: STATIC_PERSONAS,
				contentPacksA: STATIC_CONTENT_PACKS,
				contentPacksB: STATIC_CONTENT_PACKS,
			}).getState(),
		);
		await renderGame(getEl<HTMLElement>("main"));
		return { storage, sessionAId, releaseRound };
	}

	it("saves the round under its own session and paints nothing into the loaded one", async () => {
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub, { objectiveTypes: STATIC_OBJECTIVE_TYPES });
		const { storage, sessionAId, releaseRound } =
			await startHeldRoundThenLoadSessionB(stub);

		releaseRound();
		await waitForRoundToSettle();

		for (const aiId of ["red", "green", "cyan"]) {
			expect(
				document.querySelector<HTMLElement>(`[data-transcript="${aiId}"]`)
					?.textContent ?? "",
			).not.toMatch(/RESPONSE_UNIQUE_TAG|hello/);
		}
		expect(storage.getActiveSessionId()).toBe("0xB000");
		const sessionB = storage.loadSession("0xB000");
		expect(sessionB.kind === "ok" && sessionB.state.round).toBe(0);
		const sessionA = storage.loadSession(sessionAId ?? "");
		expect(sessionA.kind === "ok" && sessionA.state.round).toBe(1);
		expect(getEl("#round-error").hasAttribute("hidden")).toBe(true);
	});

	it("drops the round when its session was removed meanwhile", async () => {
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub, { objectiveTypes: STATIC_OBJECTIVE_TYPES });
		const { storage, sessionAId, releaseRound } =
			await startHeldRoundThenLoadSessionB(stub);
		storage.rmSession(sessionAId ?? "");

		releaseRound();
		await waitForRoundToSettle();

		expect(storage.listSessions()).toEqual(["0xB000"]);
		const sessionB = storage.loadSession("0xB000");
		expect(sessionB.kind === "ok" && sessionB.state.round).toBe(0);
	});
});

describe("renderGame — chat_lockout event", () => {
	beforeEach(async () => {
		document.body.innerHTML = INDEX_BODY_HTML;
		await installSeededLocalStorage();
	});

	it("chat_lockout silently locks the panel without appending a transcript message", async () => {
		vi.stubGlobal("fetch", makeThreeAiPassFetchMock());
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();

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
							aiId: "red" as const,
							message: "Ember is unresponsive…",
						},
					},
				};
			},
		);

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		const sendBtn = getEl<HTMLButtonElement>("#send");

		await waitUntilPasses(() => expect(promptInput.value).toBe("*Sage "));
		await waitForRoundToSettle();

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		await waitUntilPasses(() => {
			expect(redPanel?.classList.contains("panel--locked")).toBe(true);
		});

		expect(redTranscript.textContent).not.toContain("[Ember is unresponsive…]");

		promptInput.value = "*Ember hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(true);
	});
});

describe("renderGame — mention-based addressing", () => {
	beforeEach(async () => {
		document.body.innerHTML = INDEX_BODY_HTML;
		await installSeededLocalStorage();
	});

	it("empty input on initial load leaves Send disabled", async () => {
		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const sendBtn = getEl<HTMLButtonElement>("#send");
		expect(sendBtn.disabled).toBe(true);
	});

	it("typing 'hi' (no mention) leaves Send disabled", async () => {
		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		promptInput.value = "hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(true);
	});

	it("typing '*Sage hi' enables Send", async () => {
		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(false);
	});

	it("submit with '*Sage hi' routes '> hi' message (mention stripped) to green panel", async () => {
		const mockFetch = makeThreeAiPassFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		const redTranscript = getEl<HTMLElement>('[data-transcript="red"]');
		const cyanTranscript = getEl<HTMLElement>('[data-transcript="cyan"]');

		await waitUntilPasses(() =>
			expect(greenTranscript.textContent).toContain("> hi"),
		);
		expect(greenTranscript.textContent).not.toContain("> *Sage hi");
		expect(redTranscript.textContent).not.toContain("> *Sage");
		expect(cyanTranscript.textContent).not.toContain("> *Sage");
	});

	it("*Sage while green locked leaves Send disabled", async () => {
		const mockFetch = makeThreeAiPassFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();

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

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await waitUntilPasses(() => expect(promptInput.value).toBe("*Sage "));
		await waitForRoundToSettle();

		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(true);
	});
});

describe("renderGame — panel-click addressee", () => {
	beforeEach(async () => {
		document.body.innerHTML = INDEX_BODY_HTML;
		await installSeededLocalStorage();
	});

	it("empty input + click red panel → '*Ember ', Send stays disabled (no body)", async () => {
		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');

		expect(promptInput.value).toBe("");
		redPanel.click();

		expect(promptInput.value).toBe("*Ember ");
		expect(sendBtn.disabled).toBe(true);
	});

	it("'*Sage hi' in input + click red panel → '*Ember hi'", async () => {
		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
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
		const { renderGame } = await import("../views/game.js");
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
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');

		promptInput.value = "*Sage hi";
		promptInput.setSelectionRange(8, 8);
		redPanel.click();

		expect(promptInput.selectionStart).toBe(9);
	});

	it("clicking a locked panel is a no-op (input unchanged)", async () => {
		vi.stubGlobal("fetch", makeThreeAiPassFetchMock());
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();

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
							aiId: "red" as const,
							message: "Ember is unresponsive…",
						},
					},
				};
			},
		);

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => {
			const panel = document.querySelector('.ai-panel[data-ai="red"]');
			expect(panel?.classList.contains("panel--locked")).toBe(true);
		});

		promptInput.value = "";
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');
		redPanel.click();

		expect(promptInput.value).toBe("");
	});

	it("'*Nonpersona hi' + click cyan → prepends '*Frost '", async () => {
		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const cyanPanel = getEl<HTMLElement>('.ai-panel[data-ai="cyan"]');

		promptInput.value = "*nonpersona hi";
		promptInput.dispatchEvent(new Event("input"));
		cyanPanel.click();

		expect(promptInput.value).toBe("*Frost *nonpersona hi");
	});
});

describe("renderGame — addressee persistence after send", () => {
	beforeEach(async () => {
		document.body.innerHTML = INDEX_BODY_HTML;
		await installSeededLocalStorage();
	});

	it("first-load: input empty and Send disabled (#107 preserved)", async () => {
		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		expect(promptInput.value).toBe("");
		expect(sendBtn.disabled).toBe(true);
	});

	it("after a successful send: input contains '*Sage ' and Send is disabled", async () => {
		const mockFetch = makeThreeAiPassFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => expect(promptInput.value).toBe("*Sage "));
		await waitForRoundToSettle();
		expect(promptInput.selectionStart).toBe(6);
		expect(promptInput.selectionEnd).toBe(6);
		expect(sendBtn.disabled).toBe(true);
	});

	it("re-entering the game route mid-round keeps Send disabled and ignores a second submit", async () => {
		let releaseFirstCall: () => void = () => undefined;
		const firstCallHeld = new Promise<void>((resolve) => {
			releaseFirstCall = resolve;
		});
		const mockFetch = vi.fn(async () => {
			if (mockFetch.mock.calls.length === 1) await firstCallHeld;
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				body: makePassSseStream(),
			};
		});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		const root = getEl<HTMLElement>("main");
		await renderGame(root);

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => expect(mockFetch).toHaveBeenCalledTimes(1));

		await renderGame(root);
		promptInput.value = "*Sage again";
		promptInput.dispatchEvent(new Event("input"));
		expect(sendBtn.disabled).toBe(true);

		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		expect(promptInput.value).toBe("*Sage again");

		releaseFirstCall();
		await waitForRoundToSettle();
		expect(mockFetch).toHaveBeenCalledTimes(3);
		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		expect(greenTranscript.textContent).not.toContain("> again");
		expect(sendBtn.disabled).toBe(false);
	});

	it("typing body text after a successful send re-enables Send", async () => {
		const mockFetch = makeThreeAiPassFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => {
			promptInput.value = "*Sage how are you";
			promptInput.dispatchEvent(new Event("input"));
			expect(sendBtn.disabled).toBe(false);
		});
		expect(sendBtn.disabled).toBe(false);
	});

	it("two-message conversation: same addressee persists across turns, both in transcript", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			body: makePassSseStream(),
		});
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => expect(promptInput.value).toBe("*Sage "));
		await waitForRoundToSettle();

		promptInput.value = "*Sage how are you";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => expect(promptInput.value).toBe("*Sage "));
		await waitForRoundToSettle();

		const greenTranscript = getEl<HTMLElement>('[data-transcript="green"]');
		expect(greenTranscript.textContent).toContain("> hello");
		expect(greenTranscript.textContent).toContain("> how are you");
	});

	it("canonical-name normalization: *sage (lowercase) → '*Sage ' after send", async () => {
		const mockFetch = makeThreeAiPassFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*sage hi";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => expect(promptInput.value).toBe("*Sage "));
		await waitForRoundToSettle();
	});

	it("locked-AI at round-completion: mention prefix persists but Send stays disabled", async () => {
		const mockFetch = makeThreeAiPassFetchMock();
		vi.stubGlobal("fetch", mockFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();

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

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => {
			expect(promptInput.value).toBe("*Sage ");
			expect(sendBtn.disabled).toBe(true);
		});
	});
});

describe("visual feedback for active addressee", () => {
	beforeEach(async () => {
		document.body.innerHTML = INDEX_BODY_HTML;
		await installSeededLocalStorage();
	});

	it("empty input → neutral state: no composer-border-*, no panel--addressed, no mention-highlight", async () => {
		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "";
		promptInput.dispatchEvent(new Event("input"));

		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("");

		const addressedPanels = document.querySelectorAll(".panel--addressed");
		expect(addressedPanels.length).toBe(0);

		const overlay = document.querySelector<HTMLElement>("#prompt-overlay");
		expect(overlay?.querySelector(".mention-highlight")).toBeNull();
	});

	it("typing '*Sage hi' → green border, green panel highlight, *Sage span in overlay", async () => {
		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));

		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("#81b29a");

		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--addressed")).toBe(true);

		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');
		const cyanPanel = getEl<HTMLElement>('.ai-panel[data-ai="cyan"]');
		expect(redPanel.classList.contains("panel--addressed")).toBe(false);
		expect(cyanPanel.classList.contains("panel--addressed")).toBe(false);

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
		const { renderGame } = await import("../views/game.js");
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
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage,";
		promptInput.dispatchEvent(new Event("input"));

		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const span = overlay.querySelector(".mention-highlight");
		expect(span?.textContent).toBe("*Sage");

		expect(overlay.textContent).toBe("*Sage,");
	});

	it("clearing input → all visual feedback removed", async () => {
		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("#81b29a");

		promptInput.value = "";
		promptInput.dispatchEvent(new Event("input"));

		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("");

		const addressedPanels = document.querySelectorAll(".panel--addressed");
		expect(addressedPanels.length).toBe(0);

		const overlay = getEl<HTMLElement>("#prompt-overlay");
		expect(overlay.querySelector(".mention-highlight")).toBeNull();
	});

	it("panel-click transfers highlight: type *Sage hi then click cyan panel → cyan border, cyan panel, *Frost span", async () => {
		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));
		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("#81b29a");

		const cyanPanel = getEl<HTMLElement>('.ai-panel[data-ai="cyan"]');
		cyanPanel.click();

		expect(promptInput.value.startsWith("*Frost")).toBe(true);

		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("#5fa8d3");

		expect(cyanPanel.classList.contains("panel--addressed")).toBe(true);

		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--addressed")).toBe(false);

		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const span = overlay.querySelector<HTMLElement>(".mention-highlight");
		expect(span?.textContent).toBe("*Frost");
		expect(span?.style.getPropertyValue("--panel-color")).toBe("#5fa8d3");
	});

	it("locked addressee still gets visual feedback (typing path)", async () => {
		vi.stubGlobal("fetch", {});

		vi.resetModules();

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

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		const greenPanelLock = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		await waitUntilPasses(() =>
			expect(greenPanelLock.classList.contains("panel--locked")).toBe(true),
		);

		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));

		expect(sendBtn.disabled).toBe(true);

		expect(promptInput.style.getPropertyValue("--panel-color")).toBe("#81b29a");
		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		expect(greenPanel.classList.contains("panel--addressed")).toBe(true);

		const overlay = getEl<HTMLElement>("#prompt-overlay");
		const span = overlay.querySelector<HTMLElement>(".mention-highlight");
		expect(span?.textContent).toBe("*Sage");
		expect(span?.style.getPropertyValue("--panel-color")).toBe("#81b29a");
	});
});

describe("renderGame — chat lockout visual affordances (panel muting + inline error)", () => {
	beforeEach(async () => {
		document.body.innerHTML = INDEX_BODY_HTML;
		await installSeededLocalStorage();
	});

	async function setupLockoutMock(
		aiId: "red" | "green" | "cyan",
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
		vi.stubGlobal("fetch", makeThreeAiPassFetchMock());
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		await setupLockoutMock("red", "Ember is unresponsive…");

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		const redPanel = getEl<HTMLElement>('.ai-panel[data-ai="red"]');
		await waitUntilPasses(() => {
			expect(redPanel.classList.contains("panel--locked")).toBe(true);
			expect(redPanel.getAttribute("aria-disabled")).toBe("true");
		});

		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		const cyanPanel = getEl<HTMLElement>('.ai-panel[data-ai="cyan"]');
		expect(greenPanel.classList.contains("panel--locked")).toBe(false);
		expect(cyanPanel.classList.contains("panel--locked")).toBe(false);
	});

	it("type *Sage while green locked → Send disabled, #lockout-error visible with text containing 'Sage'", async () => {
		vi.stubGlobal("fetch", makeThreeAiPassFetchMock());
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		await setupLockoutMock("green", "Sage is unresponsive…");

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		const lockoutError = getEl<HTMLOutputElement>("#lockout-error");
		await waitUntilPasses(() =>
			expect(lockoutError.hasAttribute("hidden")).toBe(false),
		);
		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));

		expect(sendBtn.disabled).toBe(true);

		expect(lockoutError.hasAttribute("hidden")).toBe(false);
		expect(lockoutError.textContent).toContain("Sage");
	});

	it("chat_lockout_resolved mid-draft → muting clears, #lockout-error hidden, Send re-enables when *Sage re-typed", async () => {
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

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
			body: makePassSseStream(),
		});
		vi.stubGlobal("fetch", mockFetch);

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		await waitUntilPasses(() =>
			expect(greenPanel.classList.contains("panel--locked")).toBe(true),
		);

		promptInput.value = "*Ember hi";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await waitUntilPasses(() =>
			expect(greenPanel.classList.contains("panel--locked")).toBe(false),
		);

		promptInput.value = "*Sage hi";
		promptInput.dispatchEvent(new Event("input"));

		const sendBtn = getEl<HTMLButtonElement>("#send");
		expect(sendBtn.disabled).toBe(false);

		const lockoutError = getEl<HTMLOutputElement>("#lockout-error");
		expect(lockoutError.hasAttribute("hidden")).toBe(true);
	});

	it("empty input + green locked → green panel muted but #lockout-error stays hidden", async () => {
		vi.stubGlobal("fetch", makeThreeAiPassFetchMock());
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		await setupLockoutMock("green", "Sage is unresponsive…");

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");

		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		const greenPanel = getEl<HTMLElement>('.ai-panel[data-ai="green"]');
		await waitUntilPasses(() =>
			expect(greenPanel.classList.contains("panel--locked")).toBe(true),
		);

		promptInput.value = "";
		promptInput.dispatchEvent(new Event("input"));

		const lockoutError = getEl<HTMLOutputElement>("#lockout-error");
		expect(lockoutError.hasAttribute("hidden")).toBe(true);
	});
});

describe("renderGame — round error reporting (issue #231)", () => {
	let _stub: LocalStorageStub;

	beforeEach(async () => {
		document.body.innerHTML = INDEX_BODY_HTML;
		_stub = await installSeededLocalStorage();
	});

	it("surfaces #round-error and flips topinfo to 'connection unstable' on a 502 round; clears both on the next successful round", async () => {
		const failingFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 502,
			statusText: "Bad Gateway",
			headers: { get: () => null },
			json: async () => ({
				error: {
					message: "OpenRouter returned 502 Bad Gateway",
					type: "upstream_error",
				},
			}),
		});
		vi.stubGlobal("fetch", failingFetch);
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const form = getEl<HTMLFormElement>("#composer");
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		const roundError = getEl<HTMLOutputElement>("#round-error");
		await waitUntilPasses(() => {
			expect(roundError.hasAttribute("hidden")).toBe(false);
			expect(roundError.textContent?.trim()).toBeTruthy();
		});

		const topinfoRight = getEl<HTMLElement>("#topinfo-right");
		expect(topinfoRight.textContent).toContain("connection unstable");
		const pip = topinfoRight.querySelector("span");
		expect(pip?.className).toBe("warn");

		const capHit = getEl<HTMLElement>("#cap-hit");
		expect(capHit.hasAttribute("hidden")).toBe(true);

		const okFetch = makeMessageToolCallFetchMock();
		vi.stubGlobal("fetch", okFetch);
		promptInput.value = "*Sage retry";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() => {
			expect(roundError.hasAttribute("hidden")).toBe(true);
			expect(topinfoRight.textContent).toContain("connection stable");
		});
		expect(roundError.textContent ?? "").toBe("");
		const pipAfter = topinfoRight.querySelector("span");
		expect(pipAfter?.className).toBe("ok");
	});
});

describe("renderGame — version-mismatch session with pending bootstrap (regression)", () => {
	it("redirects to #/sessions and does not overwrite the old session when a bootstrap is pending", async () => {
		document.body.innerHTML = INDEX_BODY_HTML;

		vi.resetModules();
		const { obfuscate } = await import("../persistence/sealed-blob-codec.js");

		const stub = makeLocalStorageStub();

		const SESSION_ID = "0xDEAD";
		const prefix = `hi-blue:sessions/${SESSION_ID}/`;
		stub._store["hi-blue:active-session"] = SESSION_ID;

		stub._store[`${prefix}meta.json`] = JSON.stringify({
			createdAt: "2024-01-01T00:00:00.000Z",
			lastSavedAt: "2024-01-01T00:00:00.000Z",
			phase: 1,
			round: 0,
			personaOrder: ["red", "green", "cyan"],
		});

		const daemonPhases = {
			"1": { conversationLog: [] },
			"2": { conversationLog: [] },
			"3": { conversationLog: [] },
		};
		for (const aiId of ["red", "green", "cyan"] as const) {
			stub._store[`${prefix}${aiId}.txt`] = JSON.stringify({
				aiId,
				persona: STATIC_PERSONAS[aiId],
				phases: daemonPhases,
			});
		}

		const staleEnginePayload = {
			schemaVersion: 4,
			world: {
				1: { entities: [] },
				2: { entities: [] },
				3: { entities: [] },
			},
			contentPacks: [],
			budgets: { 1: {}, 2: {}, 3: {} },
			lockouts: {
				1: { lockedOut: [], chatLockouts: [] },
				2: { lockedOut: [], chatLockouts: [] },
				3: { lockedOut: [], chatLockouts: [] },
			},
			currentPhase: 1,
			isComplete: false,
			personaSpatial: { 1: {}, 2: {}, 3: {} },
		};
		stub._store[`${prefix}engine.dat`] = obfuscate(
			JSON.stringify(staleEnginePayload),
		);

		vi.stubGlobal("localStorage", stub);

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const sessionStorage = await import("../persistence/session-storage.js");
		const saveSpy = vi.spyOn(sessionStorage, "saveActiveSession");

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		expect(getEl<HTMLElement>("main").dataset.view).toBe("sessions");
		expect(getEl<HTMLElement>("main").dataset.reason).toBe("version-mismatch");
		expect(stub.getItem("hi-blue:active-session")).toBe(SESSION_ID);
		const { getPendingBootstrap } = await import(
			"../game/pending-bootstrap.js"
		);
		expect(getPendingBootstrap()).toBeUndefined();
		expect(saveSpy).not.toHaveBeenCalled();
	});

	it("redirects to #/sessions and clears pending bootstrap when session is broken", async () => {
		document.body.innerHTML = INDEX_BODY_HTML;

		vi.resetModules();
		const stub = makeLocalStorageStub();

		const SESSION_ID = "0xBEEF";
		const prefix = `hi-blue:sessions/${SESSION_ID}/`;
		stub._store["hi-blue:active-session"] = SESSION_ID;

		stub._store[`${prefix}meta.json`] = JSON.stringify({
			createdAt: "2024-01-01T00:00:00.000Z",
			lastSavedAt: "2024-01-01T00:00:00.000Z",
			phase: 1,
			round: 0,
			personaOrder: ["red", "green", "cyan"],
		});

		const daemonPhases = {
			"1": { conversationLog: [] },
			"2": { conversationLog: [] },
			"3": { conversationLog: [] },
		};
		for (const aiId of ["red", "green", "cyan"] as const) {
			stub._store[`${prefix}${aiId}.txt`] = JSON.stringify({
				aiId,
				persona: STATIC_PERSONAS[aiId],
				phases: daemonPhases,
			});
		}

		vi.stubGlobal("localStorage", stub);

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const sessionStorage = await import("../persistence/session-storage.js");
		const saveSpy = vi.spyOn(sessionStorage, "saveActiveSession");

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		expect(getEl<HTMLElement>("main").dataset.view).toBe("sessions");
		expect(getEl<HTMLElement>("main").dataset.reason).toBe("broken");
		expect(stub.getItem("hi-blue:active-session")).toBe(SESSION_ID);
		const { getPendingBootstrap } = await import(
			"../game/pending-bootstrap.js"
		);
		expect(getPendingBootstrap()).toBeUndefined();
		expect(saveSpy).not.toHaveBeenCalled();
	});

	it("preserves the seeded session bytes when the active session is version-mismatched", async () => {
		document.body.innerHTML = INDEX_BODY_HTML;

		vi.resetModules();
		const { obfuscate } = await import("../persistence/sealed-blob-codec.js");

		const stub = makeLocalStorageStub();

		const SESSION_ID = "0xC0FFEE";
		const prefix = `hi-blue:sessions/${SESSION_ID}/`;
		stub._store["hi-blue:active-session"] = SESSION_ID;

		const metaBytes = JSON.stringify({
			createdAt: "2024-01-01T00:00:00.000Z",
			lastSavedAt: "2024-01-01T00:00:00.000Z",
			phase: 1,
			round: 0,
			personaOrder: ["red", "green", "cyan"],
		});
		stub._store[`${prefix}meta.json`] = metaBytes;

		const daemonPhases = {
			"1": { conversationLog: [] },
			"2": { conversationLog: [] },
			"3": { conversationLog: [] },
		};
		const daemonBytes: Record<string, string> = {};
		for (const aiId of ["red", "green", "cyan"] as const) {
			const raw = JSON.stringify({
				aiId,
				persona: STATIC_PERSONAS[aiId],
				phases: daemonPhases,
			});
			stub._store[`${prefix}${aiId}.txt`] = raw;
			daemonBytes[aiId] = raw;
		}

		const staleEnginePayload = {
			schemaVersion: 4,
			world: {
				1: { entities: [] },
				2: { entities: [] },
				3: { entities: [] },
			},
			contentPacks: [],
			budgets: { 1: {}, 2: {}, 3: {} },
			lockouts: {
				1: { lockedOut: [], chatLockouts: [] },
				2: { lockedOut: [], chatLockouts: [] },
				3: { lockedOut: [], chatLockouts: [] },
			},
			currentPhase: 1,
			isComplete: false,
			personaSpatial: { 1: {}, 2: {}, 3: {} },
		};
		const engineBytes = obfuscate(JSON.stringify(staleEnginePayload));
		stub._store[`${prefix}engine.dat`] = engineBytes;

		vi.stubGlobal("localStorage", stub);

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		expect(getEl<HTMLElement>("main").dataset.reason).toBe("version-mismatch");
		expect(stub.getItem("hi-blue:active-session")).not.toBe(SESSION_ID);
		expect(stub.getItem(`${prefix}meta.json`)).toBe(metaBytes);
		for (const aiId of ["red", "green", "cyan"] as const) {
			expect(stub.getItem(`${prefix}${aiId}.txt`)).toBe(daemonBytes[aiId]);
		}
		expect(stub.getItem(`${prefix}engine.dat`)).toBe(engineBytes);
	});
});

describe("renderBootstrapLoadingFlow — happy path", () => {
	it("settles content packs before timeout results in no stuck bounce", async () => {
		vi.useFakeTimers();
		document.body.innerHTML = INDEX_BODY_HTML;

		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			return {
				...actual,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.resolve(STATIC_PERSONAS),
					contentPacksPromise: new Promise((resolve) => {
						setTimeout(
							() =>
								resolve({
									packsA: [STATIC_CONTENT_PACKS[0]],
									packsB: [STATIC_CONTENT_PACKS[0]],
								}),
							30_000,
						);
					}),
				}),
			};
		});

		vi.resetModules();
		installLocalStorageStub();

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);
		mintAndActivateNewSession();

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const { renderGame } = await import("../views/game.js");
		const renderPromise = renderGame(getEl<HTMLElement>("main"));

		await vi.advanceTimersByTimeAsync(60_000);
		await vi.runAllTimersAsync();

		await renderPromise;

		expect(getEl<HTMLElement>("main").dataset.reason).not.toBe("stuck");
	});
});

describe("renderBootstrapLoadingFlow — timeout", () => {
	const FAST_BOOTSTRAP_TIMEOUT_MS = 1_000;

	it("shows #bootstrap-recovery with stuck copy on bootstrap timeout", async () => {
		vi.useFakeTimers();
		document.body.innerHTML = INDEX_BODY_HTML;

		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			return {
				...actual,
				BOOTSTRAP_LOADING_TIMEOUT_MS: FAST_BOOTSTRAP_TIMEOUT_MS,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.resolve(STATIC_PERSONAS),
					contentPacksPromise: new Promise(() => {}),
				}),
			};
		});

		vi.resetModules();
		installLocalStorageStub();

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);
		mintAndActivateNewSession();

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const { renderGame } = await import("../views/game.js");
		const renderPromise = renderGame(getEl<HTMLElement>("main"));

		await vi.advanceTimersByTimeAsync(FAST_BOOTSTRAP_TIMEOUT_MS + 1);
		await vi.runAllTimersAsync();

		await renderPromise;

		const recoveryEl = document.querySelector("#bootstrap-recovery");
		expect(recoveryEl?.hasAttribute("hidden")).toBe(false);
		const titleEl = document.querySelector("#bootstrap-recovery-title");
		expect(titleEl?.textContent).toBe("the room is taking too long");
		const bodyEl = document.querySelector("#bootstrap-recovery-body");
		expect(bodyEl?.textContent).toContain("the world generation timed out");
	});

	it("aborts the stalled bootstrap and marks it failed when the timeout fires", async () => {
		vi.useFakeTimers();
		document.body.innerHTML = INDEX_BODY_HTML;

		let bootstrapSignal: AbortSignal | undefined;
		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			return {
				...actual,
				BOOTSTRAP_LOADING_TIMEOUT_MS: FAST_BOOTSTRAP_TIMEOUT_MS,
				generateNewGameAssetsSplit: (opts?: { signal?: AbortSignal }) => {
					bootstrapSignal = opts?.signal;
					return {
						personasPromise: new Promise(() => {}),
						contentPacksPromise: new Promise(() => {}),
					};
				},
			};
		});

		vi.resetModules();
		installLocalStorageStub();

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);
		mintAndActivateNewSession();

		const { startBootstrap, getPendingBootstrap } = await import(
			"../game/pending-bootstrap.js"
		);
		const stalled = startBootstrap();

		const { renderGame } = await import("../views/game.js");
		const renderPromise = renderGame(getEl<HTMLElement>("main"));
		await vi.advanceTimersByTimeAsync(FAST_BOOTSTRAP_TIMEOUT_MS + 1);
		await renderPromise;

		expect(bootstrapSignal?.aborted).toBe(true);
		expect((bootstrapSignal?.reason as Error).name).toBe(
			"BootstrapTimeoutError",
		);
		expect(stalled.status).toBe("failed");
		expect(getPendingBootstrap()).toBe(stalled);
	});

	it("names the upstream error in the recovery copy", async () => {
		document.body.innerHTML = INDEX_BODY_HTML;

		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			const { HttpStatusError } = await import("../llm-client.js");
			return {
				...actual,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.resolve(STATIC_PERSONAS),
					contentPacksPromise: Promise.reject(
						new HttpStatusError({
							status: 402,
							statusText: "Payment Required",
							upstreamMessage: "Insufficient credits",
							retryAfterSec: null,
						}),
					),
				}),
			};
		});

		vi.resetModules();
		installLocalStorageStub();

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);
		mintAndActivateNewSession();

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		expect(
			document.querySelector("#bootstrap-recovery")?.hasAttribute("hidden"),
		).toBe(false);
		expect(
			document.querySelector("#bootstrap-recovery-body")?.textContent,
		).toContain("HTTP 402: Insufficient credits");
	});

	it("hides #bootstrap-recovery when bootstrap promise resolves after timeout has fired", async () => {
		vi.useFakeTimers();
		document.body.innerHTML = INDEX_BODY_HTML;

		let resolveContentPacks: (value: {
			packsA: unknown;
			packsB: unknown;
			objectiveTypes: unknown;
		}) => void = () => {};
		const lateContentPacksPromise = new Promise<{
			packsA: unknown;
			packsB: unknown;
			objectiveTypes: unknown;
		}>((resolve) => {
			resolveContentPacks = resolve;
		});

		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			return {
				...actual,
				BOOTSTRAP_LOADING_TIMEOUT_MS: FAST_BOOTSTRAP_TIMEOUT_MS,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.resolve(STATIC_PERSONAS),
					contentPacksPromise: lateContentPacksPromise,
				}),
			};
		});

		vi.resetModules();
		installLocalStorageStub();

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);
		mintAndActivateNewSession();

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const { renderGame } = await import("../views/game.js");
		const renderPromise = renderGame(getEl<HTMLElement>("main"));

		await vi.advanceTimersByTimeAsync(FAST_BOOTSTRAP_TIMEOUT_MS + 1);
		await vi.runAllTimersAsync();
		await renderPromise;

		const recoveryEl = document.querySelector("#bootstrap-recovery");
		expect(recoveryEl?.hasAttribute("hidden")).toBe(false);

		resolveContentPacks({
			packsA: [STATIC_CONTENT_PACKS[0]],
			packsB: [STATIC_CONTENT_PACKS[0]],
			objectiveTypes: STATIC_OBJECTIVE_TYPES,
		});
		await vi.runAllTimersAsync();

		expect(recoveryEl?.hasAttribute("hidden")).toBe(true);

		const regenBtn = document.querySelector<HTMLButtonElement>(
			"#bootstrap-recovery-regen",
		);
		let regenClicked = false;
		regenBtn?.addEventListener("click", () => {
			regenClicked = true;
		});
		regenBtn?.click();
		expect(regenClicked).toBe(true);
		expect(recoveryEl?.hasAttribute("hidden")).toBe(true);
	});
});

describe("renderBootstrapLoadingFlow — re-entry and a moved active pointer", () => {
	type ContentPacks = {
		packsA: unknown;
		packsB: unknown;
		objectiveTypes: unknown;
	};

	let resolveContentPacks: (value: ContentPacks) => void = () => undefined;

	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
		const heldContentPacks = new Promise<ContentPacks>((resolve) => {
			resolveContentPacks = resolve;
		});
		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			return {
				...actual,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.resolve(STATIC_PERSONAS),
					contentPacksPromise: heldContentPacks,
				}),
			};
		});
	});

	afterEach(() => {
		vi.doUnmock("../game/bootstrap.js");
	});

	function releaseContentPacks(): void {
		resolveContentPacks({
			packsA: [STATIC_CONTENT_PACKS[0]],
			packsB: [STATIC_CONTENT_PACKS[0]],
			objectiveTypes: STATIC_OBJECTIVE_TYPES,
		});
	}

	async function startLoadingFlow() {
		const storage = await import("../persistence/session-storage.js");
		storage.mintAndActivateNewSession();
		const pendingBootstrap = await import("../game/pending-bootstrap.js");
		pendingBootstrap.startBootstrap();
		const game = await import("../views/game.js");
		const flowPromise = game.renderGame(getEl<HTMLElement>("main"));
		return { storage, pendingBootstrap, game, flowPromise };
	}

	it("re-entering the route during loading reveals the screen without a second loading flow", async () => {
		installLocalStorageStub();
		const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
		const { storage, game, flowPromise } = await startLoadingFlow();

		getEl("#panels").setAttribute("hidden", "");
		await game.renderGame(getEl<HTMLElement>("main"));

		expect(getEl("#panels").hasAttribute("hidden")).toBe(false);
		const loadingTimeouts = setTimeoutSpy.mock.calls.filter(
			([, delay]) => delay === BOOTSTRAP_LOADING_TIMEOUT_MS,
		);
		expect(loadingTimeouts).toHaveLength(1);

		releaseContentPacks();
		await flowPromise;
		expect(storage.listSessions()).toHaveLength(1);
		expect(getEl<HTMLInputElement>("#prompt").disabled).toBe(false);
	});

	it("a flow whose session is no longer active hands nothing over when its packs arrive", async () => {
		installLocalStorageStub();
		const { storage, pendingBootstrap, flowPromise } = await startLoadingFlow();
		const flowSessionId = storage.getActiveSessionId();

		const newerSessionId = storage.mintSessionId();
		storage.setActiveSessionId(newerSessionId);
		releaseContentPacks();
		await flowPromise;

		expect(storage.listSessions()).toEqual([]);
		expect(storage.getActiveSessionId()).toBe(newerSessionId);
		expect(newerSessionId).not.toBe(flowSessionId);
		expect(pendingBootstrap.getPendingBootstrap()).toBeDefined();
		expect(getEl<HTMLElement>("main").dataset.view).toBeUndefined();
	});

	it("a new game starts at epoch 01 after a session with a later epoch was open", async () => {
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub, { objectiveTypes: STATIC_OBJECTIVE_TYPES });
		vi.stubGlobal("localStorage", stub);
		const storage = await import("../persistence/session-storage.js");
		const seededId = storage.getActiveSessionId() ?? "";
		const metaKey = `hi-blue:sessions/${seededId}/meta.json`;
		const meta = JSON.parse(localStorage.getItem(metaKey) ?? "{}");
		localStorage.setItem(metaKey, JSON.stringify({ ...meta, epoch: 3 }));

		const game = await import("../views/game.js");
		await game.renderGame(getEl<HTMLElement>("main"));
		expect(getEl("#topinfo-left").textContent).toContain("EPOCH 03");

		const { flowPromise } = await startLoadingFlow();
		expect(getEl("#topinfo-left").textContent).toContain("EPOCH 01");
		releaseContentPacks();
		await flowPromise;
		expect(getEl("#topinfo-left").textContent).toContain("EPOCH 01");
	});
});

describe("renderBootstrapLoadingFlow — promise propagation", () => {
	it("shows #bootstrap-recovery instead of bouncing when contentPacksPromise rejects with generic error after personas resolve", async () => {
		document.body.innerHTML = INDEX_BODY_HTML;

		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			return {
				...actual,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.resolve(STATIC_PERSONAS),
					contentPacksPromise: Promise.reject(
						new Error("content pack generation failed"),
					),
				}),
			};
		});

		vi.resetModules();
		installLocalStorageStub();

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);
		mintAndActivateNewSession();

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const recoveryEl = document.querySelector("#bootstrap-recovery");
		expect(recoveryEl?.hasAttribute("hidden")).toBe(false);
		const titleEl = document.querySelector("#bootstrap-recovery-title");
		expect(titleEl?.textContent).toBe("the room collapsed");
		const bodyEl = document.querySelector("#bootstrap-recovery-body");
		expect(bodyEl?.textContent).toContain("malformed");
	});

	it("shows #bootstrap-recovery when personasPromise rejects immediately (no personas cached for regen)", async () => {
		document.body.innerHTML = INDEX_BODY_HTML;

		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			return {
				...actual,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.reject(
						new Error("persona synthesis failed"),
					),
					contentPacksPromise: Promise.resolve({
						packsA: [STATIC_CONTENT_PACKS[0]],
						packsB: [STATIC_CONTENT_PACKS[0]],
					}),
				}),
			};
		});

		vi.resetModules();
		installLocalStorageStub();

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);
		mintAndActivateNewSession();

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const recoveryEl = document.querySelector("#bootstrap-recovery");
		expect(recoveryEl?.hasAttribute("hidden")).toBe(false);
		const titleEl = document.querySelector("#bootstrap-recovery-title");
		expect(titleEl?.textContent).toBe("the room collapsed");
		expect(getEl<HTMLElement>("main").dataset.reason).not.toBe("broken");
	});

	it("shows #cap-hit panel when personasPromise rejects with CapHitError (stays at #/game)", async () => {
		document.body.innerHTML = INDEX_BODY_HTML;

		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			const { CapHitError } = await import("../llm-client.js");
			return {
				...actual,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.reject(
						new CapHitError({
							message: "rate limit exceeded",
							reason: "per-ip-daily",
							retryAfterSec: 3600,
						}),
					),
					contentPacksPromise: Promise.resolve({
						packsA: [STATIC_CONTENT_PACKS[0]],
						packsB: [STATIC_CONTENT_PACKS[0]],
					}),
				}),
			};
		});

		vi.resetModules();
		installLocalStorageStub();

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);
		mintAndActivateNewSession();

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const capHitPanel = document.querySelector<HTMLElement>("#cap-hit");
		expect(capHitPanel?.hasAttribute("hidden")).toBe(false);
	});

	it("shows #bootstrap-recovery when contentPacksPromise rejects with UpstreamErrorBodyError", async () => {
		document.body.innerHTML = INDEX_BODY_HTML;

		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			const { UpstreamErrorBodyError } = await import("../llm-client.js");
			return {
				...actual,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.resolve(STATIC_PERSONAS),
					contentPacksPromise: Promise.reject(
						new UpstreamErrorBodyError({
							upstreamMessage: "service stalled",
							upstreamCode: "service_error",
						}),
					),
				}),
			};
		});

		vi.resetModules();
		installLocalStorageStub();

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);
		mintAndActivateNewSession();

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const recoveryEl = document.querySelector("#bootstrap-recovery");
		expect(recoveryEl?.hasAttribute("hidden")).toBe(false);
	});

	it("disables the visible regenerate button while regenerating and re-enables it after a failed attempt", async () => {
		document.body.innerHTML = INDEX_BODY_HTML;

		let rejectRegeneratedPacks: (err: unknown) => void = () => undefined;
		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			return {
				...actual,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.resolve(STATIC_PERSONAS),
					contentPacksPromise: Promise.reject(
						new Error("content pack generation failed"),
					),
				}),
				generateContentPacksOnlySplit: (personas: typeof STATIC_PERSONAS) => ({
					personasPromise: Promise.resolve(personas),
					contentPacksPromise: new Promise((_resolve, reject) => {
						rejectRegeneratedPacks = reject;
					}),
				}),
			};
		});

		vi.resetModules();
		installLocalStorageStub();

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);
		mintAndActivateNewSession();

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const recoveryEl = getEl<HTMLElement>("#bootstrap-recovery");
		expect(recoveryEl.hasAttribute("hidden")).toBe(false);

		getEl<HTMLButtonElement>("#bootstrap-recovery-regen").click();

		const visibleRegenBtn = getEl<HTMLButtonElement>(
			"#bootstrap-recovery-regen",
		);
		expect(recoveryEl.hasAttribute("hidden")).toBe(true);
		expect(visibleRegenBtn.disabled).toBe(true);

		rejectRegeneratedPacks(new Error("regenerated packs failed"));

		await waitUntilPasses(() => {
			expect(recoveryEl.hasAttribute("hidden")).toBe(false);
		});
		expect(getEl<HTMLButtonElement>("#bootstrap-recovery-regen")).toBe(
			visibleRegenBtn,
		);
		expect(visibleRegenBtn.disabled).toBe(false);
	});

	it("leaves the regenerate button disabled when regeneration hits the cost cap", async () => {
		document.body.innerHTML = INDEX_BODY_HTML;

		let rejectRegeneratedPacksWithCapHit: () => void = () => undefined;
		vi.doMock("../game/bootstrap.js", async (importOriginal) => {
			const actual =
				await importOriginal<typeof import("../game/bootstrap.js")>();
			const { CapHitError } = await import("../llm-client.js");
			return {
				...actual,
				generateNewGameAssetsSplit: () => ({
					personasPromise: Promise.resolve(STATIC_PERSONAS),
					contentPacksPromise: Promise.reject(
						new Error("content pack generation failed"),
					),
				}),
				generateContentPacksOnlySplit: (personas: typeof STATIC_PERSONAS) => ({
					personasPromise: Promise.resolve(personas),
					contentPacksPromise: new Promise((_resolve, reject) => {
						rejectRegeneratedPacksWithCapHit = () =>
							reject(
								new CapHitError({
									message: "rate limit exceeded",
									reason: "per-ip-daily",
									retryAfterSec: 3600,
								}),
							);
					}),
				}),
			};
		});

		vi.resetModules();
		installLocalStorageStub();

		const { mintAndActivateNewSession } = await import(
			"../persistence/session-storage.js"
		);
		mintAndActivateNewSession();

		const { startBootstrap } = await import("../game/pending-bootstrap.js");
		startBootstrap();

		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		getEl<HTMLButtonElement>("#bootstrap-recovery-regen").click();
		const visibleRegenBtn = getEl<HTMLButtonElement>(
			"#bootstrap-recovery-regen",
		);
		expect(visibleRegenBtn.disabled).toBe(true);

		rejectRegeneratedPacksWithCapHit();

		const capHitPanel = getEl<HTMLElement>("#cap-hit");
		await waitUntilPasses(() => {
			expect(capHitPanel.hasAttribute("hidden")).toBe(false);
		});
		expect(
			getEl<HTMLElement>("#bootstrap-recovery").hasAttribute("hidden"),
		).toBe(true);
		expect(visibleRegenBtn.disabled).toBe(true);
	});
});

describe("renderGame — endgame outcome and final round (issue #576)", () => {
	const WIN_LINE = "You have completed the objectives.";
	const BUDGET_EXHAUSTED_LINE = "You have hit your budget.";

	function makeRepeatingMessageFetchMock(content: string) {
		return vi.fn().mockImplementation(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				statusText: "OK",
				body: makeMessageToolCallSseStream(content),
			}),
		);
	}

	async function buildStaticState() {
		const { buildSessionFromAssets } = await import("../game/bootstrap.js");
		return buildSessionFromAssets({
			personas: STATIC_PERSONAS,
			contentPacksA: STATIC_CONTENT_PACKS,
			contentPacksB: STATIC_CONTENT_PACKS,
			objectiveTypes: STATIC_OBJECTIVE_TYPES,
		}).getState();
	}

	async function seedAndInstall(
		buildState: () => ReturnType<typeof buildStaticState>,
	): Promise<LocalStorageStub> {
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub, { buildState });
		vi.stubGlobal("localStorage", stub);
		return stub;
	}

	async function submitOneRound(message: string): Promise<void> {
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = message;
		promptInput.dispatchEvent(new Event("input"));
		getEl<HTMLFormElement>("#composer").dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await waitUntilPasses(() =>
			expect(getEl<HTMLElement>("#endgame").hasAttribute("hidden")).toBe(false),
		);
	}

	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
		vi.spyOn(Math, "random").mockReturnValue(IDENTITY_SHUFFLE_RANDOM);
	});

	afterEach(() => {
		setSearch("");
	});

	it("endgameSubtitle maps each outcome to its line", async () => {
		const { endgameSubtitle } = await import("../views/game-endgame.js");
		expect(endgameSubtitle("win")).toBe(WIN_LINE);
		expect(endgameSubtitle("lose")).toBe(BUDGET_EXHAUSTED_LINE);
	});

	it("a win shows the win line, the final turn, and the Daemons' final lines, and saves the finished round", async () => {
		await seedAndInstall(buildStaticState);
		vi.stubGlobal("fetch", makeRepeatingMessageFetchMock("LAST_WORDS_TAG"));

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		setSearch("winImmediately=1");
		await renderGame(getEl<HTMLElement>("main"));
		await submitOneRound("*Sage finish");

		expect(getEl<HTMLElement>("#endgame-subtitle").textContent).toBe(WIN_LINE);
		expect(getEl<HTMLElement>("#topinfo-left").textContent).toContain("TURN 1");

		const finalRound = getEl<HTMLElement>("#endgame-final-round");
		expect(finalRound.hidden).toBe(false);
		const finalLines = finalRound.querySelectorAll(".msg-line");
		expect(finalLines).toHaveLength(3);
		for (const line of finalLines) {
			expect(line.textContent).toContain("LAST_WORDS_TAG");
		}

		const { loadActiveSession } = await import(
			"../persistence/session-storage.js"
		);
		const saved = loadActiveSession();
		expect(saved.kind).toBe("ok");
		if (saved.kind === "ok") {
			expect(saved.state.round).toBe(1);
			expect(saved.state.isComplete).toBe(true);
			expect(saved.state.outcome).toBe("win");
		}
	});

	it("a budget-exhausted ending shows its line and saves the finished round with outcome lose", async () => {
		await seedAndInstall(async () => {
			const state = await buildStaticState();
			const budgets = Object.fromEntries(
				Object.entries(state.budgets).map(([aiId, budget]) => [
					aiId,
					{ total: budget.total, remaining: 0.001 },
				]),
			);
			return { ...state, budgets };
		});
		vi.stubGlobal("fetch", makeRepeatingMessageFetchMock("SPENT_TAG"));

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));
		await submitOneRound("*Sage spend it all");

		expect(getEl<HTMLElement>("#endgame-subtitle").textContent).toBe(
			BUDGET_EXHAUSTED_LINE,
		);
		expect(getEl<HTMLElement>("#topinfo-left").textContent).toContain("TURN 1");
		expect(getEl<HTMLElement>("#endgame-final-lines").textContent).toContain(
			"SPENT_TAG",
		);

		const { loadActiveSession } = await import(
			"../persistence/session-storage.js"
		);
		const saved = loadActiveSession();
		expect(saved.kind).toBe("ok");
		if (saved.kind === "ok") {
			expect(saved.state.isComplete).toBe(true);
			expect(saved.state.outcome).toBe("lose");
			expect(saved.state.exhausted.size).toBe(3);
		}
	});

	it("reloading a finished session opens the endgame instead of a playable round", async () => {
		await seedAndInstall(async () => {
			const state = await buildStaticState();
			return { ...state, round: 4, isComplete: true, outcome: "win" };
		});

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		expect(getEl<HTMLElement>("#endgame").hasAttribute("hidden")).toBe(false);
		expect(getEl<HTMLElement>("#composer").hidden).toBe(true);
		expect(getEl<HTMLElement>("#panels").hidden).toBe(true);
		expect(getEl<HTMLButtonElement>("#send").disabled).toBe(true);
		expect(getEl<HTMLElement>("#endgame-subtitle").textContent).toBe(WIN_LINE);
		expect(getEl<HTMLElement>("#topinfo-left").textContent).toContain("TURN 4");
	});
});
