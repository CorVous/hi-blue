import { expect, type Page, test } from "@playwright/test";
import {
	collectPageErrors,
	expectNoPageErrors,
	holdChatCompletions,
	isDualContentPackRequest,
	reachEndgame,
} from "./helpers";

async function togglePickerOpenAndClosed(page: Page): Promise<void> {
	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#endgame")).toBeVisible();
}

test("toggling the picker during a Same daemons generation keeps the choices locked and the status shown", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	await reachEndgame(page);
	const generation = await holdChatCompletions(page, isDualContentPackRequest);

	await page.locator("#endgame-same-daemons-btn").click();
	await expect.poll(generation.requestCount).toBeGreaterThan(0);
	await expect(page.locator("#endgame-choice-status")).toContainText(
		"spinning up a new room",
	);

	await togglePickerOpenAndClosed(page);

	await expect(page.locator("#endgame-same-daemons-btn")).toBeDisabled();
	await expect(page.locator("#endgame-new-daemons-btn")).toBeDisabled();
	await expect(page.locator("#endgame-choice-status")).toContainText(
		"spinning up a new room",
	);
	expect(generation.requestCount()).toBe(1);

	generation.release();
	await expect(page.locator("#endgame")).toBeHidden({ timeout: 15_000 });
	await expect(page.locator("#composer")).toBeVisible();
	expect(generation.requestCount()).toBe(1);

	await expectNoPageErrors(page, pageErrors);
});

test("a triple-clicked diagnostics submit sends one request", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	await reachEndgame(page);
	let posts = 0;
	await page.route("**/diagnostics", async (route) => {
		posts++;
		await route.fulfill({ status: 204, body: "" });
	});

	await page.locator("#diagnostics-summary").fill("great");
	await page.locator("#submit-diagnostics-btn").click({ clickCount: 3 });

	await expect(page.locator("#diagnostics-status")).toHaveText(
		"Diagnostics submitted.",
	);
	await expect(page.locator("#submit-diagnostics-btn")).toBeDisabled();
	await expect(page.locator("#diagnostics-summary")).toBeDisabled();
	expect(posts).toBe(1);

	await expectNoPageErrors(page, pageErrors);
});

test("Continue hides again once the stored OpenRouter key is cleared", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	await reachEndgame(page);
	await page.evaluate(() => {
		localStorage.setItem("openrouter_key", "sk-or-test-key");
	});
	await togglePickerOpenAndClosed(page);
	await expect(page.locator("#endgame-continue-btn")).toBeVisible();

	await page.locator("#byok-cog").click();
	await page.locator("#byok-clear").click();
	await expect(page.locator("#byok-dialog")).not.toBeVisible();
	await togglePickerOpenAndClosed(page);
	await expect(page.locator("#endgame-continue-btn")).toBeHidden();

	await expectNoPageErrors(page, pageErrors);
});
