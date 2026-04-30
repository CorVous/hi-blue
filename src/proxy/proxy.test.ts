import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("proxy /chat endpoint", () => {
	it("streams SSE tokens for a POST to /chat", async () => {
		const response = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "hello" }),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);

		const text = await response.text();
		// SSE format: "data: <token>\n\n" per token, then "data: [DONE]\n\n"
		expect(text).toContain("data:");
		expect(text).toContain("[DONE]");
	});

	it("returns 405 for non-POST requests to /chat", async () => {
		const response = await SELF.fetch("https://example.com/chat");
		expect(response.status).toBe(405);
	});

	it("returns 400 when message body is missing", async () => {
		const response = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(response.status).toBe(400);
	});
});
