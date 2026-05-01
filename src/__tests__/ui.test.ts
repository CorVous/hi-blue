/**
 * JSDOM tests for the server-rendered chat UI.
 * Runs under the "browser" vitest project (jsdom environment).
 * Tests observable behavior: DOM structure and client-side SSE streaming.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderChatPage, renderEndgamePage } from "../ui.js";

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

// ----------------------------------------------------------------------------
// Action log panel (issue #15)
// ----------------------------------------------------------------------------
describe("action log panel HTML structure", () => {
	let doc: Document;

	beforeEach(() => {
		doc = mountPage(renderChatPage());
	});

	it("renders an action log panel element", () => {
		const panel = doc.getElementById("action-log");
		expect(panel).not.toBeNull();
	});

	it("action log panel has a heading or label", () => {
		const heading = doc.querySelector(
			"[aria-label='Action log'], #action-log-heading, #action-log",
		);
		expect(heading).not.toBeNull();
	});

	it("renders an action log output element for appending entries", () => {
		const output = doc.getElementById("action-log-output");
		expect(output).not.toBeNull();
	});
});

describe("client-side action_log SSE event", () => {
	it("appends a tool_success entry to the action log panel", async () => {
		document.body.innerHTML = renderChatPage();

		const entry = {
			round: 1,
			actor: "red",
			type: "tool_success",
			toolName: "pick_up",
			args: { item: "flower" },
			description: "Ember picked up the flower",
		};

		const events = [
			`data: ${JSON.stringify({ type: "action_log", entry })}\n\n`,
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

		const actionLogOutput = document.getElementById("action-log-output");
		expect(actionLogOutput?.textContent).toContain(
			"Ember picked up the flower",
		);
	});

	it("appends a tool_failure entry to the action log panel", async () => {
		document.body.innerHTML = renderChatPage();

		const entry = {
			round: 1,
			actor: "green",
			type: "tool_failure",
			toolName: "pick_up",
			args: { item: "ghost" },
			reason: 'Item "ghost" does not exist',
			description:
				'Sage tried to pick_up ghost but failed: Item "ghost" does not exist',
		};

		const events = [
			`data: ${JSON.stringify({ type: "action_log", entry })}\n\n`,
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

		const actionLogOutput = document.getElementById("action-log-output");
		expect(actionLogOutput?.textContent).toContain(
			"Sage tried to pick_up ghost",
		);
	});
});

// ----------------------------------------------------------------------------
// Chat-lockout SSE events (issue #16)
// ----------------------------------------------------------------------------
describe("client-side chat_lockout SSE event", () => {
	it("disables the selector button for the locked AI on chat_lockout event", async () => {
		document.body.innerHTML = renderChatPage();

		const lockoutMessage = "…Ember withdraws — you cannot reach her right now.";
		const events = [
			`data: ${JSON.stringify({ type: "chat_lockout", aiId: "red", message: lockoutMessage })}\n\n`,
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

		const selectRedBtn = document.getElementById(
			"select-red",
		) as HTMLButtonElement;
		expect(selectRedBtn?.disabled).toBe(true);
	});

	it("shows the lockout message in the locked AI's chat panel on chat_lockout event", async () => {
		document.body.innerHTML = renderChatPage();

		const lockoutMessage = "…Ember withdraws — you cannot reach her right now.";
		const events = [
			`data: ${JSON.stringify({ type: "chat_lockout", aiId: "red", message: lockoutMessage })}\n\n`,
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
		expect(chatRed?.textContent).toContain(lockoutMessage);
	});

	it("re-enables the selector button on chat_lockout_resolved event", async () => {
		document.body.innerHTML = renderChatPage();

		// First, lock red, then resolve it
		const lockoutMessage = "…Ember withdraws.";
		const events = [
			`data: ${JSON.stringify({ type: "chat_lockout", aiId: "red", message: lockoutMessage })}\n\n`,
			`data: ${JSON.stringify({ type: "chat_lockout_resolved", aiId: "red" })}\n\n`,
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

		const selectRedBtn = document.getElementById(
			"select-red",
		) as HTMLButtonElement;
		// After resolution the button must be re-enabled
		expect(selectRedBtn?.disabled).toBe(false);
	});
});

// ----------------------------------------------------------------------------
// Endgame screen (issue #19)
// ----------------------------------------------------------------------------

describe("endgame page HTML structure", () => {
	let doc: Document;

	beforeEach(() => {
		doc = mountPage(renderEndgamePage());
	});

	it("renders an endgame heading or title", () => {
		const html = renderEndgamePage();
		expect(html).toContain("endgame");
	});

	it("renders a 'Download AIs' button", () => {
		const btn = doc.getElementById("download-ais-btn");
		expect(btn).not.toBeNull();
	});

	it("renders a 'Submit diagnostics' button", () => {
		const btn = doc.getElementById("submit-diagnostics-btn");
		expect(btn).not.toBeNull();
	});

	it("renders a diagnostics summary input field", () => {
		const input = doc.getElementById("diagnostics-summary");
		expect(input).not.toBeNull();
	});

	it("endgame page does not render the game chat panels", () => {
		const panels = doc.querySelectorAll(".ai-panel");
		expect(panels.length).toBe(0);
	});

	it("endgame page does not render the chat form", () => {
		const form = doc.querySelector("#chat-form");
		expect(form).toBeNull();
	});
});

describe("renderChatPage does not render endgame elements", () => {
	it("chat page does not have the download-ais button", () => {
		const doc = mountPage(renderChatPage());
		expect(doc.getElementById("download-ais-btn")).toBeNull();
	});
});

describe("endgame client-side: download-ais action", () => {
	it("clicking Download AIs triggers a blob download", async () => {
		document.body.innerHTML = renderEndgamePage();

		// Patch URL.createObjectURL and document.createElement to intercept download
		const revokeObjectURL = vi.fn();
		const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
		globalThis.URL.createObjectURL = createObjectURL;
		globalThis.URL.revokeObjectURL = revokeObjectURL;

		const origCreateElement = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
			return origCreateElement(tag);
		});

		const scriptContent = renderEndgamePage().match(
			/<script>([\s\S]*?)<\/script>/,
		)?.[1];
		expect(scriptContent).toBeTruthy();
		const fn = new Function("fetch", scriptContent as string);
		fn(vi.fn());

		const btn = document.getElementById(
			"download-ais-btn",
		) as HTMLButtonElement;
		btn.click();

		// A blob URL should have been created
		expect(createObjectURL).toHaveBeenCalled();

		vi.restoreAllMocks();
	});
});

describe("endgame client-side: submit diagnostics action", () => {
	it("clicking Submit diagnostics POSTs to /diagnostics", async () => {
		document.body.innerHTML = renderEndgamePage();

		const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

		const scriptContent = renderEndgamePage().match(
			/<script>([\s\S]*?)<\/script>/,
		)?.[1];
		expect(scriptContent).toBeTruthy();
		const fn = new Function("fetch", scriptContent as string);
		fn(mockFetch);

		const summaryInput = document.getElementById(
			"diagnostics-summary",
		) as HTMLInputElement;
		summaryInput.value = "curious";

		const btn = document.getElementById(
			"submit-diagnostics-btn",
		) as HTMLButtonElement;
		btn.click();

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(mockFetch).toHaveBeenCalledWith(
			"/diagnostics",
			expect.objectContaining({ method: "POST" }),
		);

		const callArgs = mockFetch.mock.calls[0];
		expect(callArgs).toBeDefined();
		const callBody = JSON.parse(
			(callArgs as [string, { body: string }])[1].body,
		) as {
			downloaded: boolean;
			summary: string;
		};
		expect(callBody.summary).toBe("curious");
		expect(typeof callBody.downloaded).toBe("boolean");
	});

	it("the diagnostics payload includes downloaded=true after Download AIs was clicked", async () => {
		document.body.innerHTML = renderEndgamePage();

		const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
		const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
		const revokeObjectURL = vi.fn();
		globalThis.URL.createObjectURL = createObjectURL;
		globalThis.URL.revokeObjectURL = revokeObjectURL;

		const origCreateElement = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
			return origCreateElement(tag);
		});

		const scriptContent = renderEndgamePage().match(
			/<script>([\s\S]*?)<\/script>/,
		)?.[1];
		const fn = new Function("fetch", scriptContent as string);
		fn(mockFetch);

		// Click download first
		const downloadBtn = document.getElementById(
			"download-ais-btn",
		) as HTMLButtonElement;
		downloadBtn.click();

		// Now submit diagnostics
		const summaryInput = document.getElementById(
			"diagnostics-summary",
		) as HTMLInputElement;
		summaryInput.value = "hopeful";

		const submitBtn = document.getElementById(
			"submit-diagnostics-btn",
		) as HTMLButtonElement;
		submitBtn.click();

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(mockFetch).toHaveBeenCalledWith(
			"/diagnostics",
			expect.objectContaining({ method: "POST" }),
		);

		const callArgs2 = mockFetch.mock.calls[0];
		expect(callArgs2).toBeDefined();
		const callBody = JSON.parse(
			(callArgs2 as [string, { body: string }])[1].body,
		) as {
			downloaded: boolean;
			summary: string;
		};
		expect(callBody.downloaded).toBe(true);

		vi.restoreAllMocks();
	});
});
