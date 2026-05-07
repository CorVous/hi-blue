import { expect, test } from "@playwright/test";
import { stubChatCompletions } from "./helpers";

/**
 * E2E spec for #107: @mention-based addressing replaces the address dropdown.
 *
 * Verifies:
 * 1. The #address dropdown is gone.
 * 2. On first load, prompt is empty and Send is disabled.
 * 3. Typing "hi" (no mention) leaves Send disabled.
 * 4. Typing "@Sage hi" enables Send and submits to green panel.
 */

test("address dropdown is gone (#address count === 0)", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#composer")).toBeVisible();
	await expect(page.locator("#address")).toHaveCount(0);
});

test("on first load, prompt empty and Send disabled", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#composer")).toBeVisible();
	await expect(page.locator("#prompt")).toHaveValue("");
	await expect(page.locator("#send")).toBeDisabled();
});

test("typing 'hi' leaves Send disabled", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#composer")).toBeVisible();
	await page.fill("#prompt", "hi");
	await expect(page.locator("#send")).toBeDisabled();
});

test("typing '@Sage hi' enables Send and submits to green transcript only", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await stubChatCompletions(page, ["greetings"]);
	await page.goto("/");
	await expect(page.locator("#composer")).toBeVisible();

	// Typing "@Sage hi" should enable Send.
	await page.fill("#prompt", "@Sage hi");
	await expect(page.locator("#send")).toBeEnabled();

	// Click send and wait for the round to complete.
	await page.click("#send");

	// Wait until the green panel shows a response.
	await page.waitForFunction(
		() => {
			const el = document.querySelector('[data-transcript="green"]');
			return (el?.textContent ?? "").includes("greetings");
		},
		{ timeout: 30_000 },
	);

	const greenTranscript = await page
		.locator('[data-transcript="green"]')
		.textContent();
	const redTranscript = await page
		.locator('[data-transcript="red"]')
		.textContent();
	const blueTranscript = await page
		.locator('[data-transcript="blue"]')
		.textContent();

	// > you message appears only in green.
	expect(greenTranscript ?? "").toContain("> you @Sage hi");
	expect(redTranscript ?? "").not.toContain("> you");
	expect(blueTranscript ?? "").not.toContain("> you");

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
