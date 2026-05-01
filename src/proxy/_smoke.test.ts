import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("proxy worker smoke", () => {
	it("returns 404 for unknown routes", async () => {
		const response = await SELF.fetch("https://example.com/unknown");
		expect(response.status).toBe(404);
	});

	it("POST /chat streams SSE tokens", async () => {
		const response = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "hello" }),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/event-stream");

		const text = await response.text();
		// SSE format: each event is "data: <token>\n\n"
		expect(text).toContain("data:");
		// Should end with a [DONE] sentinel
		expect(text).toContain("data: [DONE]");
	});

	it("POST /chat rejects missing message body", async () => {
		const response = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(400);
	});

	it("GET / serves HTML with a chat form", async () => {
		const response = await SELF.fetch("https://example.com/");
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/html");

		const html = await response.text();
		expect(html).toContain("<form");
		expect(html).toContain("<textarea");
		expect(html).toContain("<output");
	});
});
