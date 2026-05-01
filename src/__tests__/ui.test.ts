/**
 * JSDOM tests for the server-rendered chat UI.
 * Runs under the "browser" vitest project (jsdom environment).
 * Tests observable behavior: DOM structure and client-side SSE streaming.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderChatPage, renderThreePanelPage } from "../ui.js";

function mountPage(html: string): Document {
	const parser = new DOMParser();
	return parser.parseFromString(html, "text/html");
}

describe("chat page HTML structure", () => {
	let doc: Document;

	beforeEach(() => {
		doc = mountPage(renderChatPage());
	});

	it("renders a form element for message submission", () => {
		const form = doc.querySelector("form");
		expect(form).not.toBeNull();
	});

	it("renders a textarea for user input", () => {
		const textarea = doc.querySelector("textarea");
		expect(textarea).not.toBeNull();
	});

	it("renders an output element for streamed tokens", () => {
		const output = doc.querySelector("output");
		expect(output).not.toBeNull();
	});

	it("form action posts to /chat", () => {
		// The form uses fetch('/chat') in the script, verified by script presence
		const html = renderChatPage();
		expect(html).toContain("/chat");
	});

	it("includes a submit button", () => {
		const btn = doc.querySelector("button[type='submit']");
		expect(btn).not.toBeNull();
	});
});

describe("three-panel layout", () => {
	let doc: Document;

	beforeEach(() => {
		doc = mountPage(renderThreePanelPage());
	});

	it("renders three chat panel sections, one per AI", () => {
		const panels = doc.querySelectorAll("[data-ai-panel]");
		expect(panels.length).toBe(3);
	});

	it("each panel is labeled with an AI color (red, green, blue)", () => {
		const html = renderThreePanelPage();
		expect(html).toContain('data-ai-panel="red"');
		expect(html).toContain('data-ai-panel="green"');
		expect(html).toContain('data-ai-panel="blue"');
	});

	it("renders an AI selector so the player can pick which AI to address", () => {
		const selector = doc.querySelector("[data-ai-selector]");
		expect(selector).not.toBeNull();
	});

	it("the AI selector has options for red, green, and blue", () => {
		const html = renderThreePanelPage();
		expect(html).toContain('value="red"');
		expect(html).toContain('value="green"');
		expect(html).toContain('value="blue"');
	});

	it("each panel shows a budget counter element", () => {
		const budgetEls = doc.querySelectorAll("[data-budget]");
		expect(budgetEls.length).toBe(3);
	});

	it("each panel has an output area for AI messages", () => {
		const outputs = doc.querySelectorAll("[data-chat-output]");
		expect(outputs.length).toBe(3);
	});

	it("renders a single shared send button", () => {
		const btns = doc.querySelectorAll("button[type='submit']");
		expect(btns.length).toBe(1);
	});

	it("renders a shared message textarea", () => {
		const textarea = doc.querySelector("textarea");
		expect(textarea).not.toBeNull();
	});

	it("send button starts enabled", () => {
		const btn = doc.querySelector("button[type='submit']") as HTMLButtonElement;
		expect(btn?.disabled).toBe(false);
	});
});

describe("client-side SSE streaming", () => {
	it("appends SSE tokens to the output area as they arrive", async () => {
		// Set up a real DOM via jsdom global document
		document.body.innerHTML = renderChatPage();

		// The inline script doesn't run automatically in jsdom — we simulate
		// the behavior by calling the client logic directly via the script.
		// We wire a fake fetch that returns SSE lines.
		const sseBody = [
			"data: Hello\n\n",
			"data: world\n\n",
			"data: [DONE]\n\n",
		].join("");

		const encoder = new TextEncoder();
		const encoded = encoder.encode(sseBody);

		let offset = 0;
		const mockReader = {
			read: vi.fn().mockImplementation(async () => {
				if (offset < encoded.length) {
					const chunk = encoded.slice(offset, offset + 7);
					offset += 7;
					return { done: false, value: chunk };
				}
				return { done: true, value: undefined };
			}),
			releaseLock: vi.fn(),
		};

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			body: { getReader: () => mockReader },
		});

		// Evaluate the page script in jsdom context with the mock fetch
		const scriptContent = renderChatPage().match(
			/<script>([\s\S]*?)<\/script>/,
		)?.[1];
		expect(scriptContent).toBeTruthy();

		// Execute the IIFE with our mock fetch bound in the window scope
		const fn = new Function("fetch", scriptContent as string);
		fn(mockFetch);

		// Trigger form submit
		const form = document.getElementById("chat-form") as HTMLFormElement;
		const textarea = document.getElementById(
			"message-input",
		) as HTMLTextAreaElement;
		textarea.value = "hi there";

		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		// Wait for async fetch + stream pump to complete
		await new Promise((resolve) => setTimeout(resolve, 50));

		const output = document.getElementById("chat-output") as HTMLElement;
		expect(output.textContent).toContain("Hello");
		expect(output.textContent).toContain("world");
	});

	it("disables the send button while streaming and re-enables on [DONE]", async () => {
		document.body.innerHTML = renderChatPage();

		const sseBody = "data: token\n\ndata: [DONE]\n\n";
		const encoder = new TextEncoder();
		const encoded = encoder.encode(sseBody);
		let offset = 0;

		const mockReader = {
			read: vi.fn().mockImplementation(async () => {
				if (offset < encoded.length) {
					const chunk = encoded.slice(offset, offset + encoded.length);
					offset = encoded.length;
					return { done: false, value: chunk };
				}
				return { done: true, value: undefined };
			}),
			releaseLock: vi.fn(),
		};

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			body: { getReader: () => mockReader },
		});

		const scriptContent = renderChatPage().match(
			/<script>([\s\S]*?)<\/script>/,
		)?.[1];
		const fn = new Function("fetch", scriptContent as string);
		fn(mockFetch);

		const form = document.getElementById("chat-form") as HTMLFormElement;
		const textarea = document.getElementById(
			"message-input",
		) as HTMLTextAreaElement;
		const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
		textarea.value = "test message";

		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		// After submit the button should be disabled
		expect(sendBtn.disabled).toBe(true);

		// Wait for SSE to complete
		await new Promise((resolve) => setTimeout(resolve, 50));

		// After [DONE], button re-enabled
		expect(sendBtn.disabled).toBe(false);
	});
});
