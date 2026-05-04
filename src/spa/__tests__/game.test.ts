import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Provide globals before importing the module
vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");

// Matches the body content of src/spa/index.html (three-panel layout)
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
    <article class="ai-panel" data-ai="blue">
      <header class="panel-header">
        <span class="panel-name"></span>
        <span class="panel-budget" data-budget=""></span>
      </header>
      <div class="transcript" data-transcript="blue"></div>
    </article>
  </div>
  <form id="composer">
    <select id="address" aria-label="Address AI">
      <option value="red">Ember (red)</option>
      <option value="green">Sage (green)</option>
      <option value="blue">Frost (blue)</option>
    </select>
    <input id="prompt" type="text" placeholder="Enter a message…" autocomplete="off" />
    <button id="send" type="submit">Send</button>
  </form>
  <section id="cap-hit" hidden></section>
  <aside id="action-log" hidden>
    <h3>Action Log (debug)</h3>
    <ul id="action-log-list"></ul>
  </aside>
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
		document.body.innerHTML = INDEX_BODY_HTML;
	});

	afterEach(() => {
		vi.restoreAllMocks();
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
		vi.stubGlobal("localStorage", { getItem: () => null });
		// Math.random=0.9 produces identity shuffle: ["red","green","blue"]
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const form = getEl<HTMLFormElement>("#composer");
		promptInput.value = "hello world";
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
		promptInput.value = "hi";
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
		promptInput.value = "test";
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
		promptInput.value = "test";
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
		promptInput.value = "test";
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
		// Address the green panel
		const addressSelect = getEl<HTMLSelectElement>("#address");
		addressSelect.value = "green";

		promptInput.value = "hello";
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
});
