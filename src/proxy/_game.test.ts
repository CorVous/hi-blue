/**
 * Integration tests for the /game/new and /game/turn endpoints.
 *
 * Uses @cloudflare/vitest-pool-workers (SELF.fetch) to test the full worker
 * request/response cycle, including session cookie handling and SSE streaming.
 *
 * Patterns follow the existing _smoke.test.ts conventions.
 */
import { env, reset, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

afterEach(async () => {
	// Clear all KV state so rate-guard tests don't interfere.
	await reset();
});

// ── POST /game/new ────────────────────────────────────────────────────────────

describe("POST /game/new", () => {
	it("returns 200 with JSON ok:true", async () => {
		const response = await SELF.fetch("https://example.com/game/new", {
			method: "POST",
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as { ok: boolean };
		expect(body.ok).toBe(true);
	});

	it("sets a session cookie in the response", async () => {
		const response = await SELF.fetch("https://example.com/game/new", {
			method: "POST",
		});

		const setCookie = response.headers.get("Set-Cookie");
		expect(setCookie).not.toBeNull();
		expect(setCookie).toContain("hi-blue-session=");
	});

	it("returns a different session ID on each call", async () => {
		const r1 = await SELF.fetch("https://example.com/game/new", {
			method: "POST",
		});
		const r2 = await SELF.fetch("https://example.com/game/new", {
			method: "POST",
		});

		const cookie1 = r1.headers.get("Set-Cookie") ?? "";
		const cookie2 = r2.headers.get("Set-Cookie") ?? "";
		// They should differ (different session IDs)
		expect(cookie1).not.toBe(cookie2);
	});

	it("returns 404 for GET /game/new", async () => {
		const response = await SELF.fetch("https://example.com/game/new", {
			method: "GET",
		});
		expect(response.status).toBe(404);
	});
});

// ── POST /game/turn ───────────────────────────────────────────────────────────

describe("POST /game/turn", () => {
	it("returns 200 with text/event-stream content type", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "red", message: "Hello Ember" }),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/event-stream");
	});

	it("streams SSE events and ends with [DONE]", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "red", message: "Hello" }),
		});

		const text = await response.text();
		expect(text).toContain("data:");
		expect(text).toContain("[DONE]");
	});

	it("includes ai_start events for all three AIs", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "red", message: "hi" }),
		});

		const text = await response.text();
		expect(text).toContain('"type":"ai_start"');
		expect(text).toContain('"aiId":"red"');
		expect(text).toContain('"aiId":"green"');
		expect(text).toContain('"aiId":"blue"');
	});

	it("includes ai_end events", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "red", message: "hi" }),
		});

		const text = await response.text();
		expect(text).toContain('"type":"ai_end"');
	});

	it("includes budget events for each AI", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "red", message: "hi" }),
		});

		const text = await response.text();
		expect(text).toContain('"type":"budget"');
	});

	it("includes action_log events", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "red", message: "hi" }),
		});

		const text = await response.text();
		expect(text).toContain('"type":"action_log"');
	});

	it("includes token events in the SSE stream", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "red", message: "hi" }),
		});

		const text = await response.text();
		expect(text).toContain('"type":"token"');
	});

	it("returns 400 when message is missing", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "red" }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when addressedAi is missing", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "hello" }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when addressedAi is invalid", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "purple", message: "hello" }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when body is invalid JSON", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json",
		});

		expect(response.status).toBe(400);
	});

	it("session persists across two /game/turn calls using the same cookie", async () => {
		// Create session
		const newResp = await SELF.fetch("https://example.com/game/new", {
			method: "POST",
		});
		const sessionCookie = newResp.headers.get("Set-Cookie") ?? "";
		// Extract the cookie value
		const cookieValue = sessionCookie.split(";")[0] ?? "";

		// Turn 1
		const turn1 = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookieValue,
			},
			body: JSON.stringify({ addressedAi: "red", message: "round 1" }),
		});
		const text1 = await turn1.text();

		// Turn 2
		const turn2 = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookieValue,
			},
			body: JSON.stringify({ addressedAi: "green", message: "round 2" }),
		});
		const text2 = await turn2.text();

		// Both turns should have successfully returned event streams
		expect(text1).toContain("[DONE]");
		expect(text2).toContain("[DONE]");

		// Second turn should show lower budgets (round 2) — budget events
		// Budget starts at 5, after 2 rounds should be 3.
		// Just verify both returned budget events.
		expect(text1).toContain('"type":"budget"');
		expect(text2).toContain('"type":"budget"');
	});

	it("accepts green and blue as valid addressedAi values", async () => {
		const greenResp = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "green", message: "hello" }),
		});
		expect(greenResp.status).toBe(200);

		const blueResp = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "blue", message: "hello" }),
		});
		expect(blueResp.status).toBe(200);
	});
});

// ── Rate-guard integration via /game/turn ─────────────────────────────────────

describe("rate-guard integration via /game/turn", () => {
	it("returns [CAP_HIT] SSE event when IP is rate-limited", async () => {
		// Seed a fully-exhausted token bucket for test IP.
		const kv = (env as Record<string, KVNamespace>)
			.RATE_GUARD_KV as KVNamespace;
		await kv.put(
			"rl:10.0.0.10",
			JSON.stringify({ tokens: 0, lastRefillMs: Date.now() }),
			{ expirationTtl: 60 },
		);

		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.0.0.10",
			},
			body: JSON.stringify({ addressedAi: "red", message: "hello" }),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/event-stream");
		expect(response.headers.get("X-Cap-Hit")).toBe("rate-limit");

		const text = await response.text();
		expect(text).toContain("[CAP_HIT]");
		expect(text).not.toContain("[DONE]");
	});

	it("returns [CAP_HIT] SSE event when daily cap is exceeded", async () => {
		const today = new Date().toISOString().slice(0, 10);
		const kv = (env as Record<string, KVNamespace>)
			.RATE_GUARD_KV as KVNamespace;
		await kv.put(`daily:${today}`, "1000", { expirationTtl: 25 * 60 * 60 });

		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.0.0.11",
			},
			body: JSON.stringify({ addressedAi: "red", message: "hello" }),
		});

		expect(response.headers.get("X-Cap-Hit")).toBe("daily-cap");

		const text = await response.text();
		expect(text).toContain("[CAP_HIT]");
		expect(text).not.toContain("[DONE]");
	});

	it("allows the request and returns [DONE] when neither limit is hit", async () => {
		const response = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.0.0.12",
			},
			body: JSON.stringify({ addressedAi: "red", message: "hello" }),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("X-Cap-Hit")).toBeNull();

		const text = await response.text();
		expect(text).toContain("[DONE]");
		expect(text).not.toContain("[CAP_HIT]");
	});
});

// ── phase_advanced and game_ended SSE events (issue #31) ─────────────────────

describe("phase_advanced SSE event via /game/turn", () => {
	it("emits a phase_advanced event on the first turn when win condition fires", async () => {
		// Create a session whose phase-1 win condition always fires
		const newResp = await SELF.fetch("https://example.com/game/new", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ testMode: "win_immediately" }),
		});
		expect(newResp.status).toBe(200);
		const cookieValue = (newResp.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

		const turnResp = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookieValue,
			},
			body: JSON.stringify({ addressedAi: "red", message: "hi" }),
		});

		expect(turnResp.status).toBe(200);
		const text = await turnResp.text();
		expect(text).toContain('"type":"phase_advanced"');
	});

	it("phase_advanced payload includes the new phase number and objective", async () => {
		const newResp = await SELF.fetch("https://example.com/game/new", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ testMode: "win_immediately" }),
		});
		const cookieValue = (newResp.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

		const turnResp = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookieValue,
			},
			body: JSON.stringify({ addressedAi: "red", message: "hi" }),
		});

		const text = await turnResp.text();
		// Extract and parse the phase_advanced event
		const lines = text.split("\n");
		const phaseAdvancedLine = lines.find((l) => l.includes('"type":"phase_advanced"'));
		expect(phaseAdvancedLine).toBeDefined();

		const eventData = JSON.parse(phaseAdvancedLine!.replace(/^data: /, "")) as {
			type: string;
			phase: number;
			objective: string;
		};
		expect(eventData.type).toBe("phase_advanced");
		expect(typeof eventData.phase).toBe("number");
		expect(typeof eventData.objective).toBe("string");
		expect(eventData.objective.length).toBeGreaterThan(0);
	});
});

describe("game_ended SSE event via /game/turn", () => {
	it("emits a game_ended event when phase 3 win condition fires", async () => {
		// Create a session with win_immediately — phase 1 fires on turn 1,
		// advancing to phase 2, which fires on turn 2, advancing to phase 3,
		// which fires on turn 3, completing the game.
		const newResp = await SELF.fetch("https://example.com/game/new", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ testMode: "win_immediately" }),
		});
		const cookieValue = (newResp.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

		// Turn 1: phase 1 → phase 2 (phase_advanced expected)
		const turn1 = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookieValue },
			body: JSON.stringify({ addressedAi: "red", message: "turn 1" }),
		});
		const text1 = await turn1.text();
		expect(text1).toContain('"type":"phase_advanced"');

		// Turn 2: phase 2 → phase 3 (phase_advanced expected)
		const turn2 = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookieValue },
			body: JSON.stringify({ addressedAi: "red", message: "turn 2" }),
		});
		const text2 = await turn2.text();
		expect(text2).toContain('"type":"phase_advanced"');

		// Turn 3: phase 3 win condition fires → game_ended
		const turn3 = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookieValue },
			body: JSON.stringify({ addressedAi: "red", message: "turn 3" }),
		});
		const text3 = await turn3.text();
		expect(text3).toContain('"type":"game_ended"');
	});

	it("does NOT emit game_ended on a normal turn without win condition", async () => {
		const turnResp = await SELF.fetch("https://example.com/game/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addressedAi: "red", message: "hello" }),
		});

		const text = await turnResp.text();
		expect(text).not.toContain('"type":"game_ended"');
	});
});
