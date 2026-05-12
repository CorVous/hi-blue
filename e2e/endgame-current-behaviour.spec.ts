import { expect, test } from "@playwright/test";
import { goToGame } from "./helpers";

/**
 * E2E Slice 4 — game_ended current behaviour (issue #80, simplified by #101)
 *
 * Proves that when game_ended fires the SPA:
 *   - disables #send and #prompt
 *   - shows #endgame screen with choice buttons
 *   - keeps active-session pointer in localStorage (cleared only on user choice)
 *   - keeps the URL stable (no navigation)
 *   - emits no pageerror events
 *
 * Strategy (post-#101 + post-#107)
 * --------------------------------
 * `?winImmediately=1` (#101) recursively patches the real PHASE_1 → PHASE_2 →
 * PHASE_3 config chain, injecting `winCondition: () => true` at every level.
 * A cold-start `goto("/?winImmediately=1")` followed by three *<name>-addressed
 * messages (one per phase) reliably reaches `game_ended` without any
 * localStorage pre-seeding.
 *
 * Note (post-#107): Send no longer re-enables after a round because the prompt
 * is cleared on submit and the *mention parser sees an empty string. We wait
 * on `#phase-banner` (set by the encoder's `phase_advanced` event) instead.
 *
 * Note (post-#307): clearActiveSession() is no longer called immediately on
 * game_ended — the session pointer stays until the user selects a choice
 * (New Daemons / Same Daemons / Continue). The active-session key is therefore
 * non-null immediately after game_ended fires.
 */

test("game_ended disables composer and shows endgame choices", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// 1. Navigate through the start screen with ?winImmediately=1.
	//    applyTestAffordances recursively patches the real PHASE_1 → PHASE_2 →
	//    PHASE_3 chain so every phase has winCondition: () => true.
	const { names } = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["hello"],
	});

	// Wait for SPA mount.
	await expect(page.locator("#composer")).toBeVisible();

	// 2. Capture URL before submitting (proves URL stability below).
	const urlBefore = page.url();

	// 3. Submit one message — ?winImmediately=1 wraps submitMessage so the next
	//    call ends the game immediately (gameEnded: true, isComplete: true).
	//    There are no phase transitions in the flat single-game loop.
	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	// game_ended fires → #send permanently disabled.
	await expect(page.locator("#send")).toBeDisabled({ timeout: 30_000 });

	// Assert all acceptance criteria.

	// #send disabled
	await expect(page.locator("#send")).toBeDisabled();

	// #prompt disabled
	await expect(page.locator("#prompt")).toBeDisabled();

	// #endgame screen visible with choice buttons
	await expect(page.locator("#endgame")).toBeVisible();
	await expect(page.locator("#endgame-new-daemons-btn")).toBeVisible();
	await expect(page.locator("#endgame-same-daemons-btn")).toBeVisible();

	// Post-#307: active-session pointer is retained (not cleared immediately).
	// clearActiveSession() runs only when the user picks a choice.
	const stored = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(
		stored,
		"active-session pointer must be kept after game_ended",
	).not.toBeNull();

	// URL stable — no navigation or hash change occurred
	expect(page.url(), "URL must not change after game_ended").toBe(urlBefore);

	// No page errors
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
