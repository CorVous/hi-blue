import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Provide globals before importing the module
vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");

// Matches the body content of src/spa/index.html
const INDEX_BODY_HTML = `
<main>
  <form id="composer">
    <input id="prompt" type="text" placeholder="Enter a message…" autocomplete="off" />
    <button id="send" type="submit">Send</button>
  </form>
  <pre id="output"></pre>
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

function makeSseChunk(content: string): string {
	return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

describe("renderGame (game route)", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("accumulates transcript across two messages with streamed AI tokens", async () => {
		const sseData1 = makeSseChunk("reply one") + "data: [DONE]\n\n";
		const sseData2 = makeSseChunk("reply two") + "data: [DONE]\n\n";

		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				statusText: "OK",
				body: makeSSEStream([sseData1]),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				statusText: "OK",
				body: makeSSEStream([sseData2]),
			});
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", { getItem: () => null });

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");

		renderGame(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const form = getEl<HTMLFormElement>("#composer");

		// Submit first message
		promptInput.value = "first message";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		// Submit second message
		promptInput.value = "second message";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		const output = getEl<HTMLPreElement>("#output");
		expect(output.textContent).toContain("[you] first message");
		expect(output.textContent).toContain("[you] second message");
		expect(output.textContent).toContain("reply one");
		expect(output.textContent).toContain("reply two");
	});
});
