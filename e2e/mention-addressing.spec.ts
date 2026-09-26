import { expect, test } from "@playwright/test";
import { expectNoPageErrors, goToGame, renderedPlayerLine } from "./helpers";

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

	const { ids, names } = await goToGame(page, { sse: ["greetings"] });
	await expect(page.locator("#composer")).toBeVisible();

	await page.fill("#prompt", `*${names[1]} hi`);
	await expect(page.locator("#send")).toBeEnabled();

	await page.click("#send");

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

	const playerLine = renderedPlayerLine("hi");
	expect(addressedTranscript ?? "").toContain(playerLine);
	expect(otherTranscript0 ?? "").not.toContain(playerLine);
	expect(otherTranscript2 ?? "").not.toContain(playerLine);

	await expectNoPageErrors(page, pageErrors);
});
