import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Provide __WORKER_BASE_URL__ global before importing home module
vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");

// Matches the body content of src/spa/index.html
const INDEX_BODY_HTML = `
<header>
  <button id="byok-cog" type="button" aria-label="Settings" title="Settings">⚙</button>
</header>
<main>
  <form id="composer">
    <input id="prompt" type="text" placeholder="Enter a message…" autocomplete="off" />
    <button id="send" type="submit">Send</button>
  </form>
  <pre id="output"></pre>
  <section id="cap-hit" hidden>
    <h2>the AIs are sleeping</h2>
    <pre class="cap-hit-body">the AIs are sleeping.
come back tomorrow — they wake at midnight UTC.</pre>
    <p class="cap-hit-byok"><a href="#/byok" data-byok-placeholder>or paste your own OpenRouter key to keep playing — coming soon.</a></p>
  </section>
</main>
<dialog id="byok-dialog" aria-labelledby="byok-title">
  <form method="dialog" id="byok-form">
    <h2 id="byok-title">OpenRouter API Key</h2>
    <p id="byok-mode-line"></p>
    <label for="byok-key-input">API key</label>
    <input id="byok-key-input" type="password" autocomplete="off" spellcheck="false" />
    <p id="byok-status" role="status" aria-live="polite"></p>
    <div id="byok-buttons">
      <button id="byok-validate-save" type="button">Validate &amp; save</button>
      <button id="byok-save-unverified" type="button" hidden>Save unverified</button>
      <button id="byok-revalidate" type="button" hidden>Re-validate</button>
      <button id="byok-replace" type="button" hidden>Replace key</button>
      <button id="byok-clear" type="button" hidden>Clear key &amp; use free tier</button>
    </div>
    <p id="byok-clear-helper" hidden>Returns to the daily-capped free tier. Your key isn't sent anywhere on clear — just removed from this browser.</p>
    <button id="byok-close" type="button" aria-label="Close">Close</button>
  </form>
</dialog>
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

	it("reveals #cap-hit section when fetch returns 429", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 429,
				statusText: "Too Many Requests",
				headers: {
					get: (name: string) =>
						name.toLowerCase() === "retry-after" ? "86400" : null,
				},
				json: () =>
					Promise.resolve({
						error: {
							message: "per-ip cap hit",
							type: "rate_limit_exceeded",
							code: "per-ip-daily",
						},
					}),
			}),
		);

		vi.resetModules();
		const { renderHome } = await import("../routes/home.js");
		renderHome(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "hello";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 50));

		const capHitEl = getEl<HTMLElement>("#cap-hit");
		expect(capHitEl.hidden).toBe(false);
	});

	it("re-enables send button after 429", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 429,
				statusText: "Too Many Requests",
				headers: { get: () => null },
				json: () =>
					Promise.resolve({
						error: {
							message: "cap hit",
							type: "rate_limit_exceeded",
							code: "per-ip-daily",
						},
					}),
			}),
		);

		vi.resetModules();
		const { renderHome } = await import("../routes/home.js");
		renderHome(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const sendBtn = getEl<HTMLButtonElement>("#send");
		promptInput.value = "hello";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(sendBtn.disabled).toBe(false);
	});

	it("hides #cap-hit and resumes normal play on next submit after cap resets", async () => {
		const encoder = new TextEncoder();
		const sseData = `data: ${JSON.stringify({ choices: [{ delta: { content: "recovered!" } }] })}\n\ndata: [DONE]\n\n`;

		const fetchMock = vi
			.fn()
			// First call: 429
			.mockResolvedValueOnce({
				ok: false,
				status: 429,
				statusText: "Too Many Requests",
				headers: { get: () => null },
				json: () =>
					Promise.resolve({
						error: {
							message: "cap hit",
							type: "rate_limit_exceeded",
							code: "per-ip-daily",
						},
					}),
			})
			// Second call: 200 OK with normal SSE stream
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				statusText: "OK",
				body: new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(encoder.encode(sseData));
						controller.close();
					},
				}),
			});

		vi.stubGlobal("fetch", fetchMock);

		vi.resetModules();
		const { renderHome } = await import("../routes/home.js");
		renderHome(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		const capHitEl = getEl<HTMLElement>("#cap-hit");
		const outputEl = getEl<HTMLPreElement>("#output");

		// First submit — triggers 429 cap-hit screen
		promptInput.value = "first message";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(capHitEl.hidden).toBe(false);

		// Second submit — cap has reset, normal 200 response
		promptInput.value = "second message";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(capHitEl.hidden).toBe(true);
		expect(outputEl.textContent).toBe("recovered!");
	});

	it("BYOK placeholder anchor points at #/byok", () => {
		vi.resetModules();

		const anchor = document.querySelector<HTMLAnchorElement>(
			"[data-byok-placeholder]",
		);
		expect(anchor).not.toBeNull();
		expect(anchor?.getAttribute("href")).toBe("#/byok");
	});
});
