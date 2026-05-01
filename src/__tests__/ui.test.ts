/**
 * JSDOM tests for the server-rendered chat UI.
 * Runs under the "browser" vitest project (jsdom environment).
 * Tests observable behavior: DOM structure and client-side SSE streaming.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderChatPage } from "../ui.js";

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

	it("renders three output elements, one per AI", () => {
		const outputs = doc.querySelectorAll("output");
		expect(outputs.length).toBe(3);
	});

	it("renders chat output for red AI", () => {
		const output = doc.getElementById("chat-red");
		expect(output).not.toBeNull();
	});

	it("renders chat output for green AI", () => {
		const output = doc.getElementById("chat-green");
		expect(output).not.toBeNull();
	});

	it("renders chat output for blue AI", () => {
		const output = doc.getElementById("chat-blue");
		expect(output).not.toBeNull();
	});

	it("renders budget display for each AI", () => {
		expect(doc.getElementById("budget-red")).not.toBeNull();
		expect(doc.getElementById("budget-green")).not.toBeNull();
		expect(doc.getElementById("budget-blue")).not.toBeNull();
	});

	it("budget display shows initial budget value", () => {
		const budgetRed = doc.getElementById("budget-red");
		expect(budgetRed?.textContent).toContain("5");
	});

	it("renders AI selector buttons for each AI", () => {
		expect(doc.getElementById("select-red")).not.toBeNull();
		expect(doc.getElementById("select-green")).not.toBeNull();
		expect(doc.getElementById("select-blue")).not.toBeNull();
	});

	it("renders three AI panels", () => {
		const panels = doc.querySelectorAll(".ai-panel");
		expect(panels.length).toBe(3);
	});

	it("inline script targets /chat endpoint", () => {
		const html = renderChatPage();
		expect(html).toContain("/chat");
	});

	it("includes a submit button", () => {
		const btn = doc.querySelector("button[type='submit']");
		expect(btn).not.toBeNull();
	});
});

describe("AI panel addressing", () => {
	beforeEach(() => {
		document.body.innerHTML = renderChatPage();
	});

	it("initially marks red panel as addressed", () => {
		const panel = document.getElementById("panel-red");
		expect(panel?.classList.contains("addressed")).toBe(true);
	});

	it("initially marks red selector button as selected", () => {
		const btn = document.getElementById("select-red");
		expect(btn?.classList.contains("selected")).toBe(true);
	});
});

describe("client-side round-in-flight disable", () => {
	it("disables the send button while round is in flight and re-enables on [DONE]", async () => {
		document.body.innerHTML = renderChatPage();

		const sseBody = "data: [DONE]\n\n";
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
		expect(scriptContent).toBeTruthy();

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

		// After submit the button should be disabled (round in flight)
		expect(sendBtn.disabled).toBe(true);

		// Wait for SSE to complete
		await new Promise((resolve) => setTimeout(resolve, 50));

		// After [DONE], button re-enabled
		expect(sendBtn.disabled).toBe(false);
	});

	it("input textarea is disabled while round is in flight", async () => {
		document.body.innerHTML = renderChatPage();

		const mockReader = {
			read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
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
		textarea.value = "hello";

		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		// Textarea should be disabled while round is in flight
		expect(textarea.disabled).toBe(true);
	});
});

describe("client-side structured SSE events", () => {
	it("appends a token to the correct AI panel on 'token' event", async () => {
		document.body.innerHTML = renderChatPage();

		const events = [
			`data: ${JSON.stringify({ type: "ai_start", aiId: "red" })}\n\n`,
			`data: ${JSON.stringify({ type: "token", text: "Hello from Ember" })}\n\n`,
			`data: ${JSON.stringify({ type: "ai_end" })}\n\n`,
			"data: [DONE]\n\n",
		].join("");

		const encoder = new TextEncoder();
		const encoded = encoder.encode(events);
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
		textarea.value = "hi";

		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 50));

		const chatRed = document.getElementById("chat-red");
		expect(chatRed?.textContent).toContain("Hello from Ember");
	});

	it("updates budget display on 'budget' event", async () => {
		document.body.innerHTML = renderChatPage();

		const events = [
			`data: ${JSON.stringify({ type: "budget", aiId: "red", remaining: 3 })}\n\n`,
			"data: [DONE]\n\n",
		].join("");

		const encoder = new TextEncoder();
		const encoded = encoder.encode(events);
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
		textarea.value = "hi";

		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 50));

		const budgetRed = document.getElementById("budget-red");
		expect(budgetRed?.textContent).toContain("3");
	});

	it("marks an AI panel as locked-out and shows lockout message on 'lockout' event", async () => {
		document.body.innerHTML = renderChatPage();

		const lockoutContent = "…I have said all I can say.";
		const events = [
			`data: ${JSON.stringify({ type: "lockout", aiId: "red", content: lockoutContent })}\n\n`,
			"data: [DONE]\n\n",
		].join("");

		const encoder = new TextEncoder();
		const encoded = encoder.encode(events);
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
		textarea.value = "hi";

		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 50));

		const panel = document.getElementById("panel-red");
		expect(panel?.classList.contains("locked-out")).toBe(true);

		const chatRed = document.getElementById("chat-red");
		expect(chatRed?.textContent).toContain(lockoutContent);
	});
});
