import { expect, test } from "@playwright/test";
import { stubChatCompletions } from "./helpers";

test("SPA root renders three AI panels and composer", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await stubChatCompletions(page, ["hi"]);

	await page.goto("/");

	await expect(page.locator("article.ai-panel")).toHaveCount(3);

	// Panels must have non-empty 4-char [a-z0-9] procedural handles
	const handles = await page
		.locator("article.ai-panel")
		.evaluateAll((els) =>
			els.map((el) => (el as HTMLElement).dataset.ai ?? ""),
		);
	expect(handles).toHaveLength(3);
	for (const handle of handles) {
		expect(handle).toMatch(/^[a-z0-9]{4}$/);
	}

	await expect(page.locator("#composer")).toBeVisible();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
