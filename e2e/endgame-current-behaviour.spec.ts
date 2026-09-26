import { expect, test } from "@playwright/test";
import { expectNoPageErrors, goToGame } from "./helpers";

test("game_ended disables the composer, shows endgame choices, and keeps the session pointer and URL", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { names } = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["hello"],
	});

	await expect(page.locator("#composer")).toBeVisible();

	const urlBefore = page.url();

	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	await expect(page.locator("#send")).toBeDisabled({ timeout: 30_000 });
	await expect(page.locator("#prompt")).toBeDisabled();

	await expect(page.locator("#endgame")).toBeVisible();
	await expect(page.locator("#endgame-new-daemons-btn")).toBeVisible();
	await expect(page.locator("#endgame-same-daemons-btn")).toBeVisible();

	const stored = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(
		stored,
		"active-session pointer must be kept after game_ended",
	).not.toBeNull();

	expect(page.url(), "URL must not change after game_ended").toBe(urlBefore);

	await expectNoPageErrors(page, pageErrors);
});
