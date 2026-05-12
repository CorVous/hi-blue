import { expect, test } from "@playwright/test";
import { goToGame } from "./helpers";

/**
 * E2E — end-game choice screen (issue #307)
 *
 * Verifies the three choice buttons that appear after game_ended:
 *   1. New Daemons    — archives current session, navigates to #/start
 *   2. Same Daemons New Room — archives, mints new session, navigates to #/game
 *   3. Continue       — shown only when openrouter_key is present in localStorage
 *
 * Tests that depend on full content-pack generation (Same Daemons, Continue)
 * are covered via the stub route, which already handles JSON-mode calls from
 * buildSameDaemonsSession (dual-content-pack classifier).
 */

/**
 * Helper: navigate into the game, fire a message that immediately ends the game,
 * and wait for the #endgame screen to become visible.
 */
async function reachEndgame(page: Parameters<typeof goToGame>[0]) {
	const { names } = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["hello"],
	});
	await expect(page.locator("#composer")).toBeVisible();
	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");
	await expect(page.locator("#endgame")).toBeVisible({ timeout: 30_000 });
}

test("endgame shows choice buttons; Continue hidden without openrouter_key", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await reachEndgame(page);

	// All three buttons present in DOM
	await expect(page.locator("#endgame-new-daemons-btn")).toBeVisible();
	await expect(page.locator("#endgame-same-daemons-btn")).toBeVisible();

	// Continue hidden when no openrouter_key
	const continueBtn = page.locator("#endgame-continue-btn");
	await expect(continueBtn).toBeHidden();

	// No page errors
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("Continue button visible when openrouter_key is set in localStorage", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Seed the key before navigation so the game_ended handler sees it
	await page.addInitScript(() => {
		localStorage.setItem("openrouter_key", "sk-or-test-key");
	});

	await reachEndgame(page);

	// Continue button should now be visible
	await expect(page.locator("#endgame-continue-btn")).toBeVisible();

	// No page errors
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("New Daemons click archives session and navigates to #/start", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await reachEndgame(page);

	// Verify active-session is set (i.e. session was kept for choice)
	const sessionBefore = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(sessionBefore).not.toBeNull();

	// Click New Daemons
	await page.locator("#endgame-new-daemons-btn").click();

	// Should navigate to #/start
	await page.waitForURL(/.*#\/start/, { timeout: 15_000 });

	// Active session pointer cleared after the choice
	const sessionAfter = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(
		sessionAfter,
		"active-session pointer must be cleared after New Daemons",
	).toBeNull();

	// No page errors
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
