import { expect, test } from "@playwright/test";
import {
	expectNoPageErrors,
	goToGame,
	isJsonModeRequest,
	parseRequestBody,
} from "./helpers";

test("a failed round puts the typed message back and drops its transcript line", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { ids, names } = await goToGame(page);
	await page.route("**/v1/chat/completions", async (route, request) => {
		if (isJsonModeRequest(parseRequestBody(request))) {
			await route.fallback();
			return;
		}
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ error: { message: "upstream exploded" } }),
		});
	});

	const typed = `*${names[0]} please keep this message`;
	await page.fill("#prompt", typed);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	await expect(page.locator("#round-error")).toBeVisible({ timeout: 30_000 });
	await expect(page.locator("#stage")).not.toHaveAttribute(
		"data-round-in-flight",
		"true",
	);
	await expect(page.locator("#prompt")).toHaveValue(typed);
	await expect(page.locator("#send")).toBeEnabled();
	await expect(page.locator(`[data-transcript="${ids[0]}"]`)).not.toContainText(
		"please keep this message",
	);
	await expect(page.locator(".msg-you")).toHaveCount(0);

	await expectNoPageErrors(page, pageErrors);
});
