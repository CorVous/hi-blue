import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Provide __WORKER_BASE_URL__ global before importing home module
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

describe("renderHome (home route)", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("appends streamed deltas to #output on submit", async () => {
		const sseData = [
			`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
			`data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n`,
			`data: [DONE]\n\n`,
		].join("");

		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sseData));
				controller.close();
			},
		});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				body: stream,
			}),
		);

		vi.resetModules();
		const { renderHome } = await import("../routes/home.js");

		renderHome(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		const form = getEl<HTMLFormElement>("#composer");

		promptInput.value = "test message";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		// Wait for streaming to complete
		await new Promise((resolve) => setTimeout(resolve, 50));

		const output = getEl<HTMLPreElement>("#output");
		expect(output.textContent).toBe("Hello world");
		expect(sendBtn.disabled).toBe(false);
	});

	it("disables send button during streaming and re-enables after", async () => {
		const encoder = new TextEncoder();
		// Use a wrapper to capture the controller reference with correct typing
		const captured: {
			controller: ReadableStreamDefaultController<Uint8Array> | null;
		} = { controller: null };

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				captured.controller = controller;
			},
		});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				body: stream,
			}),
		);

		vi.resetModules();
		const { renderHome } = await import("../routes/home.js");

		renderHome(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		const form = getEl<HTMLFormElement>("#composer");

		promptInput.value = "test";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		// Give a tick for the fetch call
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Button should be disabled while streaming is in flight
		expect(sendBtn.disabled).toBe(true);

		// Finish the stream
		const sseData = `data: [DONE]\n\n`;
		captured.controller?.enqueue(encoder.encode(sseData));
		captured.controller?.close();

		// Wait for stream to complete
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(sendBtn.disabled).toBe(false);
	});

	it("clears prompt and output on new submit", async () => {
		const sseData = `data: [DONE]\n\n`;
		const encoder = new TextEncoder();

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				body: new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(encoder.encode(sseData));
						controller.close();
					},
				}),
			}),
		);

		vi.resetModules();
		const { renderHome } = await import("../routes/home.js");
		renderHome(getEl<HTMLElement>("main"));

		const promptInput = getEl<HTMLInputElement>("#prompt");
		const outputEl = getEl<HTMLPreElement>("#output");
		const form = getEl<HTMLFormElement>("#composer");

		outputEl.textContent = "previous content";
		promptInput.value = "hello";

		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(promptInput.value).toBe("");
		expect(outputEl.textContent).toBe("");
	});
});
