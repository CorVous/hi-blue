import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountChatPanel } from "../client.js";

describe("chat panel", () => {
	let container: HTMLElement;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		document.body.removeChild(container);
		vi.restoreAllMocks();
	});

	it("renders a message form and a streamed output area", () => {
		mountChatPanel(container);

		const form = container.querySelector("form");
		const input = container.querySelector("input[type=text]");
		const button = container.querySelector("button[type=submit]");
		const output = container.querySelector("[data-output]");

		expect(form).not.toBeNull();
		expect(input).not.toBeNull();
		expect(button).not.toBeNull();
		expect(output).not.toBeNull();
	});

	it("streams tokens into the output area when a message is submitted", async () => {
		// Stub fetch to return a canned SSE stream
		const sseBody = "data: Hello\n\ndata:  world\n\ndata: [DONE]\n\n";
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(sseBody));
				controller.close();
			},
		});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(stream, {
					headers: { "Content-Type": "text/event-stream" },
				}),
			),
		);

		mountChatPanel(container);

		const input = container.querySelector(
			"input[type=text]",
		) as HTMLInputElement;
		const form = container.querySelector("form") as HTMLFormElement;

		input.value = "ping";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		// Wait for the async streaming to settle
		await new Promise((resolve) => setTimeout(resolve, 50));

		const output = container.querySelector("[data-output]") as HTMLElement;
		expect(output.textContent).toContain("Hello");
		expect(output.textContent).toContain(" world");
		expect(output.textContent).not.toContain("[DONE]");
	});

	it("POSTs the message to /chat as JSON", async () => {
		const sseBody = "data: [DONE]\n\n";
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(sseBody));
				controller.close();
			},
		});

		const fetchMock = vi.fn().mockResolvedValue(
			new Response(stream, {
				headers: { "Content-Type": "text/event-stream" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		mountChatPanel(container);

		const input = container.querySelector(
			"input[type=text]",
		) as HTMLInputElement;
		const form = container.querySelector("form") as HTMLFormElement;

		input.value = "hello there";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(fetchMock).toHaveBeenCalledWith(
			"/chat",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"Content-Type": "application/json",
				}),
				body: JSON.stringify({ message: "hello there" }),
			}),
		);
	});
});
