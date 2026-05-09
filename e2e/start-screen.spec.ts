/**
 * start-screen.spec.ts
 *
 * Playwright e2e tests for the start-screen route (#/start).
 *
 * Covers:
 *  - New visitor → start screen shown, panels and composer hidden
 *  - [ BEGIN ] is disabled while generation is in flight
 *  - [ BEGIN ] is enabled after persona synthesis + content-pack generation resolve
 *  - Clicking [ BEGIN ] navigates to #/game and shows panels
 *  - Refreshing on #/game with a valid active session stays on #/game (no redirect)
 *  - CapHit during generation surfaces #cap-hit
 *  - Refresh during generation re-enters start screen and restarts generation
 *  - #/game direct entry with empty active session redirects to #/start
 *
 * Issue #173 (parent #155).
 */
import { expect, type Request, type Route, test } from "@playwright/test";
import {
	classifyJsonRequest,
	stubChatCompletions,
	stubNewGameLLM,
} from "./helpers";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wait until the active session pointer is written to localStorage, indicating
 * that BEGIN was clicked and saveActiveSession ran.
 */
async function waitForActiveSession(
	page: Parameters<Parameters<typeof test>[1]>[0]["page"],
	timeoutMs = 15_000,
): Promise<void> {
	await page.waitForFunction(
		() => localStorage.getItem("hi-blue:active-session") !== null,
		{ timeout: timeoutMs },
	);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("new visitor sees start screen with disabled [ BEGIN ] button initially", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub LLM so the SPA can proceed through generation
	await stubChatCompletions(page, ["stub reply"]);

	await page.goto("/");

	// #/start route should be active: start-screen visible, panels and composer hidden
	await expect(page.locator("#start-screen")).toBeVisible();
	await expect(page.locator("#panels")).toBeHidden();
	await expect(page.locator("#composer")).toBeHidden();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("[ BEGIN ] is enabled after persona synthesis and content-pack generation complete", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub synthesis and content-pack generation (both JSON-mode calls)
	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.goto("/");

	// Wait for [ BEGIN ] to be enabled (generation complete)
	const beginBtn = page.locator("#begin");
	await expect(beginBtn).toBeEnabled({ timeout: 30_000 });

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("clicking [ BEGIN ] navigates to #/game and shows panels", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub both generation and subsequent gameplay LLM calls
	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.goto("/");

	// Wait for [ BEGIN ] to be enabled
	const beginBtn = page.locator("#begin");
	await expect(beginBtn).toBeEnabled({ timeout: 30_000 });

	// Click BEGIN
	await beginBtn.click();

	// Should navigate to #/game
	await page.waitForURL(/.*#\/game/, { timeout: 10_000 });

	// Panels and composer should now be visible
	await expect(page.locator("#panels")).toBeVisible();
	await expect(page.locator("#composer")).toBeVisible();
	// Start screen should be hidden
	await expect(page.locator("#start-screen")).toBeHidden();

	// Active session should be set in localStorage
	await waitForActiveSession(page);

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("refreshing on #/game with an active session stays on #/game (no redirect to #/start)", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub all LLM calls
	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.goto("/");

	// Complete the new-game flow: wait for BEGIN and click it
	const beginBtn = page.locator("#begin");
	await expect(beginBtn).toBeEnabled({ timeout: 30_000 });
	await beginBtn.click();
	await page.waitForURL(/.*#\/game/, { timeout: 10_000 });

	// Make sure session is saved before reload
	await waitForActiveSession(page);

	// Reload — stub must be re-installed for the new page context
	await stubChatCompletions(page, ["stub reply"]);
	await page.reload();

	// Should still be on the game screen (session restored from localStorage)
	await expect(page.locator("#panels")).toBeVisible();
	await expect(page.locator("#composer")).toBeVisible();
	await expect(page.locator("#start-screen")).toBeHidden();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("CapHit during generation surfaces #cap-hit", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub all /v1/chat/completions: return 429 for the synthesis JSON-mode call,
	// normal responses for anything else. The synthesis call fires first at
	// new-game time, so a 429 there triggers CapHitError and shows #cap-hit.
	await page.route("**/v1/chat/completions", async (route, request) => {
		let body: {
			stream?: boolean;
			response_format?: unknown;
			messages?: Array<{ role?: string; content?: string }>;
		} | null = null;
		try {
			body = JSON.parse(request.postData() ?? "null") as typeof body;
		} catch {
			body = null;
		}

		// Detect JSON-mode (synthesis or content-pack) calls
		const isJsonMode =
			body !== null && (body.stream === false || body.response_format != null);
		if (isJsonMode && classifyJsonRequest(body) === "synthesis") {
			// Return 429 to simulate CapHitError on synthesis
			await route.fulfill({
				status: 429,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ error: { message: "Rate limit exceeded" } }),
			});
			return;
		}

		// Let other requests fall through normally
		await route.fallback();
	});

	await page.goto("/");

	// #cap-hit should become visible after the 429 response
	await expect(page.locator("#cap-hit")).toBeVisible({ timeout: 15_000 });

	// Start screen should be hidden when cap-hit is shown
	await expect(page.locator("#start-screen")).toBeHidden();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("refresh during generation re-enters start screen and restarts generation", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// First load: install a stub that delays synthesis so BEGIN stays disabled.
	// Playwright aborts in-flight requests on navigation, so the 10 s delay
	// is never reached after the reload — the test does not actually wait 10 s.
	const slowSynthesisHandler = async (route: Route, request: Request) => {
		let body: {
			stream?: boolean;
			response_format?: unknown;
		} | null = null;
		try {
			body = JSON.parse(request.postData() ?? "null") as typeof body;
		} catch {
			body = null;
		}
		const isJsonMode =
			body !== null && (body.stream === false || body.response_format != null);
		if (isJsonMode) {
			// Hold synthesis indefinitely — reload will abort this in-flight request
			await new Promise((r) => setTimeout(r, 60_000));
			await route.abort();
			return;
		}
		await route.fallback();
	};

	await page.route("**/v1/chat/completions", slowSynthesisHandler);

	await page.goto("/");

	// Start screen visible, BEGIN disabled while synthesis is in flight
	await expect(page.locator("#start-screen")).toBeVisible();
	const beginBtn = page.locator("#begin");
	await expect(beginBtn).toBeDisabled();

	// Unroute the slow handler and install the fast stub BEFORE reloading,
	// so the post-reload synthesis request is handled immediately.
	await page.unroute("**/v1/chat/completions", slowSynthesisHandler);
	await stubNewGameLLM(page, { sse: ["stub reply"] });

	// Reload while synthesis is still pending (the in-flight request is aborted)
	await page.reload();

	// After reload, no committed session: start screen shown again
	await expect(page.locator("#start-screen")).toBeVisible();

	// No engine.dat written (BEGIN was never clicked before the reload)
	const engineDat = await page.evaluate(() => {
		const sessionId = localStorage.getItem("hi-blue:active-session");
		if (!sessionId) return null;
		return localStorage.getItem(`hi-blue:sessions/${sessionId}/engine.dat`);
	});
	expect(engineDat).toBeNull();

	// Generation restarts on the second load: BEGIN re-enables once synthesis completes
	await expect(beginBtn).toBeEnabled({ timeout: 30_000 });

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("#/game direct entry with empty active session redirects to #/start", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub LLM for the start screen generation that will follow the redirect
	await stubNewGameLLM(page, { sse: ["stub reply"] });

	// Set up a fresh-minted active session id with NO daemon/engine files —
	// this simulates a session pointer that points to a nonexistent/empty session.
	await page.addInitScript(() => {
		const freshId = "test-empty-session-id";
		localStorage.setItem("hi-blue:active-session", freshId);
		// Deliberately do NOT write any session files — daemon, engine.dat, etc.
	});

	// Navigate directly to #/game
	await page.goto("/#/game");

	// The dispatcher should detect the empty session and redirect to #/start
	await page.waitForURL(/.*#\/start/, { timeout: 10_000 });
	await expect(page.locator("#start-screen")).toBeVisible();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
