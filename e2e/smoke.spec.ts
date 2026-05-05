import { expect, test } from "@playwright/test";

test("SPA root renders three AI panels and composer", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await page.goto("/");

	await expect(page.locator("article.ai-panel")).toHaveCount(3);

	await expect(page.locator('article.ai-panel[data-ai="red"]')).toBeVisible();
	await expect(page.locator('article.ai-panel[data-ai="green"]')).toBeVisible();
	await expect(page.locator('article.ai-panel[data-ai="blue"]')).toBeVisible();

	await expect(page.locator("#composer")).toBeVisible();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
