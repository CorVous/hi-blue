import { reset, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

afterEach(async () => {
	// Clear all KV state so rate-guard tests don't interfere with each other.
	await reset();
});

describe("proxy worker smoke", () => {
	it("returns 404 for unknown routes", async () => {
		const response = await SELF.fetch("https://example.com/unknown");
		expect(response.status).toBe(404);
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

describe("GET /endgame dev route (issue #30)", () => {
	it("returns 200 with Content-Type text/html", async () => {
		const response = await SELF.fetch("https://example.com/endgame");
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/html");
	});

	it("body contains endgame markers: download button and diagnostics button", async () => {
		const response = await SELF.fetch("https://example.com/endgame");
		const html = await response.text();
		expect(html).toContain("download-ais-btn");
		expect(html).toContain("submit-diagnostics-btn");
	});

	it("body contains endgame section headings", async () => {
		const response = await SELF.fetch("https://example.com/endgame");
		const html = await response.text();
		expect(html).toContain("Save the AIs");
		expect(html).toContain("diagnostics");
	});

	it("body carries the data-save-payload attribute slot", async () => {
		const response = await SELF.fetch("https://example.com/endgame");
		const html = await response.text();
		expect(html).toContain("data-save-payload");
	});
});

describe("POST /diagnostics endpoint (issue #19)", () => {
	it("accepts a valid diagnostics payload and returns 200", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true, summary: "curious" }),
		});

		expect(response.status).toBe(200);
	});

	it("accepts downloaded=false and a different summary word", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: false, summary: "confused" }),
		});

		expect(response.status).toBe(200);
	});

	it("returns 400 when the body is not valid JSON", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json",
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when 'downloaded' field is missing", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ summary: "curious" }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when 'summary' field is missing", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when 'summary' is not a string", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true, summary: 42 }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 405 for non-POST methods on /diagnostics", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "GET",
		});

		expect(response.status).toBe(405);
	});
});
