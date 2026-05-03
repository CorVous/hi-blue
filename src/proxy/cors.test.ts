/**
 * Unit tests for the CORS helper module (cors.ts).
 *
 * Pure unit tests — no SELF.fetch / miniflare. Covers:
 *   - parseAllowedOrigins
 *   - isOriginAllowed
 *   - buildPreflightResponse (allowed / disallowed, ACAH echo)
 *   - withCorsHeaders (status/body/content-type preserved, ACAO suppressed,
 *     streaming preserved)
 */
import { describe, expect, it } from "vitest";
import {
	buildPreflightResponse,
	isOriginAllowed,
	parseAllowedOrigins,
	withCorsHeaders,
} from "./cors";

// ── parseAllowedOrigins ───────────────────────────────────────────────────────

describe("parseAllowedOrigins", () => {
	it("returns empty array when env key is absent", () => {
		expect(parseAllowedOrigins({})).toEqual([]);
	});

	it("returns empty array for empty string", () => {
		expect(parseAllowedOrigins({ ALLOWED_ORIGINS: "" })).toEqual([]);
	});

	it("returns single origin from single value", () => {
		expect(
			parseAllowedOrigins({ ALLOWED_ORIGINS: "https://example.com" }),
		).toEqual(["https://example.com"]);
	});

	it("splits on comma and trims whitespace", () => {
		expect(
			parseAllowedOrigins({
				ALLOWED_ORIGINS: "https://a.com , https://b.com",
			}),
		).toEqual(["https://a.com", "https://b.com"]);
	});

	it("drops empty entries produced by trailing commas", () => {
		expect(
			parseAllowedOrigins({ ALLOWED_ORIGINS: "https://a.com,,https://b.com," }),
		).toEqual(["https://a.com", "https://b.com"]);
	});
});

// ── isOriginAllowed ───────────────────────────────────────────────────────────

describe("isOriginAllowed", () => {
	const allowed = ["https://app.example", "http://localhost:5173"] as const;

	it("returns true for exact match (first in list)", () => {
		expect(isOriginAllowed("https://app.example", allowed)).toBe(true);
	});

	it("returns true for exact match (second in list)", () => {
		expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(true);
	});

	it("returns false for unlisted origin", () => {
		expect(isOriginAllowed("https://evil.com", allowed)).toBe(false);
	});

	it("returns false for null origin", () => {
		expect(isOriginAllowed(null, allowed)).toBe(false);
	});

	it("returns false when allowed list is empty", () => {
		expect(isOriginAllowed("https://app.example", [])).toBe(false);
	});

	it("is case-sensitive (no normalisation)", () => {
		expect(isOriginAllowed("https://App.Example", allowed)).toBe(false);
	});
});

// ── buildPreflightResponse ────────────────────────────────────────────────────

describe("buildPreflightResponse — allowed origin", () => {
	const allowed = ["https://app.example"] as const;

	it("returns 204 status", async () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: { Origin: "https://app.example" },
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.status).toBe(204);
	});

	it("sets Access-Control-Allow-Origin to the request origin", () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: { Origin: "https://app.example" },
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example",
		);
	});

	it("sets Access-Control-Allow-Methods to POST, OPTIONS", () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: { Origin: "https://app.example" },
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.headers.get("Access-Control-Allow-Methods")).toBe(
			"POST, OPTIONS",
		);
	});

	it("echoes Access-Control-Request-Headers when present", () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: {
				Origin: "https://app.example",
				"Access-Control-Request-Headers": "X-Test, Content-Type",
			},
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.headers.get("Access-Control-Allow-Headers")).toBe(
			"X-Test, Content-Type",
		);
	});

	it("falls back to Content-Type when Access-Control-Request-Headers is absent", () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: { Origin: "https://app.example" },
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.headers.get("Access-Control-Allow-Headers")).toBe(
			"Content-Type",
		);
	});

	it("sets Access-Control-Max-Age to 86400", () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: { Origin: "https://app.example" },
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.headers.get("Access-Control-Max-Age")).toBe("86400");
	});

	it("sets Vary: Origin", () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: { Origin: "https://app.example" },
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.headers.get("Vary")).toBe("Origin");
	});
});

describe("buildPreflightResponse — disallowed origin", () => {
	const allowed = ["https://app.example"] as const;

	it("returns 204 status even for disallowed origin", () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: { Origin: "https://evil.com" },
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.status).toBe(204);
	});

	it("does NOT set Access-Control-Allow-Origin for disallowed origin", () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: { Origin: "https://evil.com" },
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("does NOT set Access-Control-Allow-Methods for disallowed origin", () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: { Origin: "https://evil.com" },
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.headers.get("Access-Control-Allow-Methods")).toBeNull();
	});

	it("does NOT set Access-Control-Allow-Headers for disallowed origin", () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: { Origin: "https://evil.com" },
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.headers.get("Access-Control-Allow-Headers")).toBeNull();
	});

	it("still sets Vary: Origin for disallowed origin", () => {
		const req = new Request("https://worker/v1/chat/completions", {
			method: "OPTIONS",
			headers: { Origin: "https://evil.com" },
		});
		const resp = buildPreflightResponse(req, allowed);
		expect(resp.headers.get("Vary")).toBe("Origin");
	});
});

// ── withCorsHeaders ───────────────────────────────────────────────────────────

describe("withCorsHeaders — allowed origin", () => {
	const allowed = ["https://app.example"] as const;

	it("adds Access-Control-Allow-Origin to the response", async () => {
		const upstream = new Response("hello", {
			status: 200,
			headers: { "Content-Type": "text/plain" },
		});
		const req = new Request("https://worker/v1/chat/completions", {
			headers: { Origin: "https://app.example" },
		});
		const resp = await withCorsHeaders(upstream, req, allowed);
		expect(resp.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example",
		);
	});

	it("adds Vary: Origin to the response", async () => {
		const upstream = new Response("hello", {
			status: 200,
			headers: { "Content-Type": "text/plain" },
		});
		const req = new Request("https://worker/v1/chat/completions", {
			headers: { Origin: "https://app.example" },
		});
		const resp = await withCorsHeaders(upstream, req, allowed);
		expect(resp.headers.get("Vary")).toBe("Origin");
	});

	it("preserves original status code", async () => {
		const upstream = new Response(null, { status: 201 });
		const req = new Request("https://worker/v1/chat/completions", {
			headers: { Origin: "https://app.example" },
		});
		const resp = await withCorsHeaders(upstream, req, allowed);
		expect(resp.status).toBe(201);
	});

	it("preserves Content-Type header", async () => {
		const upstream = new Response("{}", {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
		const req = new Request("https://worker/v1/chat/completions", {
			headers: { Origin: "https://app.example" },
		});
		const resp = await withCorsHeaders(upstream, req, allowed);
		expect(resp.headers.get("Content-Type")).toBe("application/json");
	});

	it("preserves response body (streaming — reads as text)", async () => {
		const upstream = new Response("data: hello\n\n", {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		});
		const req = new Request("https://worker/v1/chat/completions", {
			headers: { Origin: "https://app.example" },
		});
		const resp = await withCorsHeaders(upstream, req, allowed);
		expect(await resp.text()).toBe("data: hello\n\n");
	});
});

describe("withCorsHeaders — disallowed origin", () => {
	const allowed = ["https://app.example"] as const;

	it("does NOT add Access-Control-Allow-Origin for disallowed origin", async () => {
		const upstream = new Response("hello", { status: 200 });
		const req = new Request("https://worker/v1/chat/completions", {
			headers: { Origin: "https://evil.com" },
		});
		const resp = await withCorsHeaders(upstream, req, allowed);
		expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("still adds Vary: Origin for disallowed origin", async () => {
		const upstream = new Response("hello", { status: 200 });
		const req = new Request("https://worker/v1/chat/completions", {
			headers: { Origin: "https://evil.com" },
		});
		const resp = await withCorsHeaders(upstream, req, allowed);
		expect(resp.headers.get("Vary")).toBe("Origin");
	});
});

describe("withCorsHeaders — no origin header", () => {
	const allowed = ["https://app.example"] as const;

	it("does NOT add Access-Control-Allow-Origin when Origin header absent", async () => {
		const upstream = new Response("hello", { status: 200 });
		const req = new Request("https://worker/v1/chat/completions");
		const resp = await withCorsHeaders(upstream, req, allowed);
		expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("still adds Vary: Origin when Origin header absent", async () => {
		const upstream = new Response("hello", { status: 200 });
		const req = new Request("https://worker/v1/chat/completions");
		const resp = await withCorsHeaders(upstream, req, allowed);
		expect(resp.headers.get("Vary")).toBe("Origin");
	});
});
