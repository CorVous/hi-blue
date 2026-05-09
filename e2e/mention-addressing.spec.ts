import { expect, test } from "@playwright/test";
import { goToGame } from "./helpers";

/**
 * E2E spec for #107: *mention-based addressing replaces the address dropdown.
 *
 * Verifies:
 * 1. The #address dropdown is gone.
 * 2. On first load, prompt is empty and Send is disabled.
 * 3. Typing "hi" (no mention) leaves Send disabled.
 * 4. Typing "*<name> hi" (using second AI's display name) enables Send and
 *    submits to that panel only.
 */

test("address dropdown is gone (#address count === 0)", async ({ page }) => {
	await goToGame(page);
	await expect(page.locator("#composer")).toBeVisible();
	await expect(page.locator("#address")).toHaveCount(0);
});

test("on first load, prompt empty and Send disabled", async ({ page }) => {
	await goToGame(page);
	await expect(page.locator("#composer")).toBeVisible();
	await expect(page.locator("#prompt")).toHaveValue("");
	await expect(page.locator("#send")).toBeDisabled();
});

test("typing 'hi' leaves Send disabled", async ({ page }) => {
	await goToGame(page);
	await expect(page.locator("#composer")).toBeVisible();
	await page.fill("#prompt", "hi");
	await expect(page.locator("#send")).toBeDisabled();
});

test("typing '*<ai1> hi' enables Send and submits to that transcript only", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// goToGame stubs synthesis + content-pack + SSE with "greetings" reply
	const { ids, names } = await goToGame(page, { sse: ["greetings"] });
	await expect(page.locator("#composer")).toBeVisible();

	// Typing "*<name> hi" should enable Send.
	await page.fill("#prompt", `*${names[1]} hi`);
	await expect(page.locator("#send")).toBeEnabled();

	// Click send and wait for the round to complete.
	await page.click("#send");

	// Wait until the addressed panel shows a response.
	await page.waitForFunction(
		(selector: string) => {
			const el = document.querySelector(selector);
			return (el?.textContent ?? "").includes("greetings");
		},
		`[data-transcript="${ids[1]}"]`,
		{ timeout: 30_000 },
	);

	const addressedTranscript = await page
		.locator(`[data-transcript="${ids[1]}"]`)
		.textContent();
	const otherTranscript0 = await page
		.locator(`[data-transcript="${ids[0]}"]`)
		.textContent();
	const otherTranscript2 = await page
		.locator(`[data-transcript="${ids[2]}"]`)
		.textContent();

	// player message appears only in addressed panel. The SPA strips the
	// leading `*<name>` mention from the rendered player line (see
	// src/spa/routes/game.ts), so the displayed form is `> hi`.
	expect(addressedTranscript ?? "").toContain("> hi");
	expect(otherTranscript0 ?? "").not.toContain("> hi");
	expect(otherTranscript2 ?? "").not.toContain("> hi");

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
