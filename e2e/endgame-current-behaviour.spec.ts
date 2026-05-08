import { expect, test } from "@playwright/test";
import { getAiHandles, stubChatCompletions } from "./helpers";

/**
 * E2E Slice 4 — game_ended current behaviour (issue #80, simplified by #101)
 *
 * Proves that when game_ended fires the SPA:
 *   - disables #send and #prompt
 *   - clears localStorage (clearGame() ran)
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
 */

test("game_ended disables composer and clears storage", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// 1. Stub every /v1/chat/completions call — one per AI per turn.
	await stubChatCompletions(page, ["hello"]);

	// 2. Cold-start: navigate directly to /?winImmediately=1.
	//    applyTestAffordances recursively patches the real PHASE_1 → PHASE_2 →
	//    PHASE_3 chain so every phase has winCondition: () => true.
	await page.goto("/?winImmediately=1");

	// Wait for SPA mount.
	await expect(page.locator("#composer")).toBeVisible();

	// 3. Read AI handles dynamically (set after synthesis completes).
	const { names } = await getAiHandles(page);

	// 4. Capture URL before submitting (proves URL stability below).
	const urlBefore = page.url();

	// Helper: fill prompt with a mention of ids[0], wait for Send to enable, click.
	async function submitMessage(text: string): Promise<void> {
		await page.fill("#prompt", text);
		await expect(page.locator("#send")).toBeEnabled();
		await page.click("#send");
	}

	// 5. Round 1 — phase 1 ends; wait for phase banner to advance to Phase 2.
	await submitMessage(`*${names[0]} hello`);
	await expect(page.locator("#phase-banner")).toContainText("Phase 2", {
		timeout: 30_000,
	});

	// 6. Round 2 — phase 2 ends; wait for phase banner to advance to Phase 3.
	await submitMessage(`*${names[0]} hello`);
	await expect(page.locator("#phase-banner")).toContainText("Phase 3", {
		timeout: 30_000,
	});

	// 7. Round 3 — phase 3 ends; game_ended fires → #send permanently disabled.
	await submitMessage(`*${names[0]} hello`);
	await expect(page.locator("#send")).toBeDisabled({ timeout: 30_000 });

	// 8. Assert all acceptance criteria.

	// #send disabled
	await expect(page.locator("#send")).toBeDisabled();

	// #prompt disabled
	await expect(page.locator("#prompt")).toBeDisabled();

	// localStorage cleared (clearGame() ran inside game_ended handler)
	const stored = await page.evaluate(() =>
		localStorage.getItem("hi-blue-game-state"),
	);
	expect(stored, "localStorage must be null after game_ended").toBeNull();

	// URL stable — no navigation or hash change occurred
	expect(page.url(), "URL must not change after game_ended").toBe(urlBefore);

	// No page errors
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
