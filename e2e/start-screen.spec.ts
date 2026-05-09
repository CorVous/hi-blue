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
 *
 * Issue #173 (parent #155).
 */
import { expect, test } from "@playwright/test";
import { stubChatCompletions, stubNewGameLLM } from "./helpers";

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
