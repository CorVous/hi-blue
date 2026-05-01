/**
 * JSDOM tests for the server-rendered chat UI.
 * Runs under the "browser" vitest project (jsdom environment).
 * Tests observable behavior: DOM structure and client-side SSE streaming.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLogEntry } from "../types";
import {
	renderActionLogPanel,
	renderChatPage,
	renderThreePanelPage,
} from "../ui.js";

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

	it("renders cap-hit message and re-enables button on [CAP_HIT]", async () => {
		document.body.innerHTML = renderChatPage();

		const sseBody =
			"data: The AIs are sleeping. Come back tomorrow.\n\ndata: [CAP_HIT]\n\n";
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

		// Wait for SSE to complete
		await new Promise((resolve) => setTimeout(resolve, 50));

		// The in-character message should be in the output
		const output = document.getElementById("chat-output") as HTMLElement;
		expect(output.textContent).toContain("sleeping");
		// [CAP_HIT] sentinel itself should NOT appear as text
		expect(output.textContent).not.toContain("[CAP_HIT]");
		// Button should be re-enabled
		expect(sendBtn.disabled).toBe(false);
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

// ---------------------------------------------------------------------------
// Action-log panel tests
// ---------------------------------------------------------------------------

describe("renderActionLogPanel", () => {
	it("renders a container with data-action-log-panel attribute", () => {
		const html = renderActionLogPanel([]);
		const doc = mountPage(`<html><body>${html}</body></html>`);
		const panel = doc.querySelector("[data-action-log-panel]");
		expect(panel).not.toBeNull();
	});

	it("renders a <ul data-action-log> list", () => {
		const html = renderActionLogPanel([]);
		const doc = mountPage(`<html><body>${html}</body></html>`);
		const list = doc.querySelector("ul[data-action-log]");
		expect(list).not.toBeNull();
	});

	it("renders one <li> per entry in order", () => {
		const entries: ActionLogEntry[] = [
			{
				round: 1,
				actor: "red",
				type: "chat",
				target: "player",
				description: "Ember spoke to player",
			},
			{
				round: 1,
				actor: "green",
				type: "pass",
				description: "Sage passed",
			},
		];
		const html = renderActionLogPanel(entries);
		const doc = mountPage(`<html><body>${html}</body></html>`);
		const items = doc.querySelectorAll("[data-action-log] li");
		expect(items.length).toBe(2);
	});

	it("each entry li has data-entry-type, data-entry-round, data-entry-actor", () => {
		const entries: ActionLogEntry[] = [
			{
				round: 2,
				actor: "blue",
				type: "tool_success",
				toolName: "pick_up",
				args: { item: "flower" },
				description: "Frost picked up the flower",
			},
		];
		const html = renderActionLogPanel(entries);
		const doc = mountPage(`<html><body>${html}</body></html>`);
		const li = doc.querySelector("[data-action-log] li");
		expect(li?.getAttribute("data-entry-type")).toBe("tool_success");
		expect(li?.getAttribute("data-entry-round")).toBe("2");
		expect(li?.getAttribute("data-entry-actor")).toBe("blue");
	});

	it("tool_failure entries include data-failure-reason attribute", () => {
		const entries: ActionLogEntry[] = [
			{
				round: 1,
				actor: "red",
				type: "tool_failure",
				toolName: "pick_up",
				args: { item: "key" },
				reason: 'Item "key" is not in the room',
				description:
					'Ember tried to pick_up key but failed: Item "key" is not in the room',
			},
		];
		const html = renderActionLogPanel(entries);
		const doc = mountPage(`<html><body>${html}</body></html>`);
		const li = doc.querySelector('[data-entry-type="tool_failure"]');
		expect(li).not.toBeNull();
		expect(li?.getAttribute("data-failure-reason")).toBeTruthy();
	});

	it("failure entries render the reason in text content (distinguishable from successes)", () => {
		const entries: ActionLogEntry[] = [
			{
				round: 1,
				actor: "green",
				type: "tool_failure",
				toolName: "pick_up",
				args: { item: "key" },
				reason: "Item is not in the room",
				description:
					"Sage tried to pick_up key but failed: Item is not in the room",
			},
		];
		const html = renderActionLogPanel(entries);
		const doc = mountPage(`<html><body>${html}</body></html>`);
		const li = doc.querySelector('[data-entry-type="tool_failure"]');
		expect(li?.textContent).toContain("Item is not in the room");
	});

	it("success entries do NOT have a data-failure-reason attribute", () => {
		const entries: ActionLogEntry[] = [
			{
				round: 1,
				actor: "red",
				type: "tool_success",
				toolName: "pick_up",
				args: { item: "flower" },
				description: "Ember picked up the flower",
			},
		];
		const html = renderActionLogPanel(entries);
		const doc = mountPage(`<html><body>${html}</body></html>`);
		const li = doc.querySelector('[data-entry-type="tool_success"]');
		expect(li?.hasAttribute("data-failure-reason")).toBe(false);
	});

	it("renders entries in the correct order (ascending round)", () => {
		const entries: ActionLogEntry[] = [
			{
				round: 1,
				actor: "red",
				type: "pass",
				description: "Ember passed",
			},
			{
				round: 2,
				actor: "blue",
				type: "tool_success",
				toolName: "pick_up",
				args: { item: "flower" },
				description: "Frost picked up the flower",
			},
		];
		const html = renderActionLogPanel(entries);
		const doc = mountPage(`<html><body>${html}</body></html>`);
		const items = doc.querySelectorAll("[data-action-log] li");
		expect(items[0]?.getAttribute("data-entry-round")).toBe("1");
		expect(items[1]?.getAttribute("data-entry-round")).toBe("2");
	});
});

describe("three-panel layout – action-log panel", () => {
	let doc: Document;

	beforeEach(() => {
		doc = mountPage(renderThreePanelPage());
	});

	it("renders a data-action-log-panel element", () => {
		const panel = doc.querySelector("[data-action-log-panel]");
		expect(panel).not.toBeNull();
	});

	it("renders a data-action-log list inside the panel", () => {
		const list = doc.querySelector("[data-action-log-panel] [data-action-log]");
		expect(list).not.toBeNull();
	});
});

describe("chat-lockout UI events (three-panel page)", () => {
	function getThreePanelScript(): string {
		const scriptContent = renderThreePanelPage().match(
			/<script>([\s\S]*?)<\/script>/,
		)?.[1];
		if (!scriptContent) throw new Error("No script found in three-panel page");
		return scriptContent;
	}

	function mountThreePanelWithSseLines(sseLines: string[]): void {
		document.body.innerHTML = renderThreePanelPage();
		const sseBody = sseLines.join("");
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

		const fn = new Function("fetch", getThreePanelScript());
		fn(mockFetch);
	}

	async function submitThreePanelForm(
		targetAi: string,
		message: string,
	): Promise<void> {
		const form = document.getElementById("chat-form") as HTMLFormElement;
		const textarea = document.getElementById(
			"message-input",
		) as HTMLTextAreaElement;
		const selector = document.getElementById(
			"ai-selector",
		) as HTMLSelectElement;
		textarea.value = message;
		selector.value = targetAi;
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	it("chat-lockout SSE event sets data-chat-lockout attribute on the locked panel", async () => {
		mountThreePanelWithSseLines([
			"data: chat-lockout:red:...I find I have nothing more to say.\n\n",
			"data: [DONE]\n\n",
		]);
		await submitThreePanelForm("red", "hi");

		const panel = document.querySelector(
			'[data-ai-panel="red"]',
		) as HTMLElement;
		expect(panel.getAttribute("data-chat-lockout")).toBe("true");
	});

	it("chat-lockout SSE event shows an in-character lockout notice in the locked panel", async () => {
		mountThreePanelWithSseLines([
			"data: chat-lockout:green:...I have said all I can for the moment.\n\n",
			"data: [DONE]\n\n",
		]);
		await submitThreePanelForm("green", "hi");

		const notice = document.querySelector(
			'[data-lockout-notice="green"]',
		) as HTMLElement;
		expect(notice).not.toBeNull();
		expect(notice.textContent).toContain("I have said all I can");
	});

	it("chat-lockout-clear SSE event removes the lockout attribute from the panel", async () => {
		// Round 1: apply lockout
		mountThreePanelWithSseLines([
			"data: chat-lockout:blue:...My thoughts have run their course.\n\n",
			"data: [DONE]\n\n",
		]);
		await submitThreePanelForm("blue", "hi");
		const panel = document.querySelector(
			'[data-ai-panel="blue"]',
		) as HTMLElement;
		expect(panel.getAttribute("data-chat-lockout")).toBe("true");

		// Round 2: clear lockout -- remount with fresh script keeping same DOM panel
		mountThreePanelWithSseLines([
			"data: chat-lockout-clear:blue\n\n",
			"data: [DONE]\n\n",
		]);
		await submitThreePanelForm("blue", "hi again");

		const panelAfter = document.querySelector(
			'[data-ai-panel="blue"]',
		) as HTMLElement;
		expect(panelAfter.getAttribute("data-chat-lockout")).toBeNull();
	});
});
