/**
 * Diagnostics endpoint tests (issue #19).
 *
 * POST /diagnostics accepts { downloaded: boolean, summary: string } and
 * returns 200 on valid input.  Rejects malformed payloads with 400.
 * Rejects summary strings longer than 32 characters with 400.
 *
 * Runs in @cloudflare/vitest-pool-workers environment (Miniflare).
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("POST /diagnostics endpoint", () => {
	it("returns 200 for a valid payload", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true, summary: "curious" }),
		});
		expect(response.status).toBe(200);
	});

	it("returns 200 when downloaded is false", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: false, summary: "engaged" }),
		});
		expect(response.status).toBe(200);
	});

	it("response body confirms receipt", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true, summary: "fascinated" }),
		});
		const text = await response.text();
		expect(text.length).toBeGreaterThan(0);
	});

	it("returns 405 for GET requests", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics");
		expect(response.status).toBe(405);
	});

	it("returns 400 for invalid JSON body", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json",
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when downloaded field is missing", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ summary: "curious" }),
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when summary field is missing", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true }),
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when downloaded is not a boolean", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: "yes", summary: "curious" }),
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when summary is not a string", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true, summary: 42 }),
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when summary exceeds 32 characters", async () => {
		const longSummary = "a".repeat(33); // 33 chars — over limit
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true, summary: longSummary }),
		});
		expect(response.status).toBe(400);
	});

	it("accepts a summary of exactly 32 characters", async () => {
		const summary = "a".repeat(32); // exactly at limit
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: false, summary }),
		});
		expect(response.status).toBe(200);
	});

	it("returns 400 when summary is empty string", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true, summary: "" }),
		});
		expect(response.status).toBe(400);
	});
});
