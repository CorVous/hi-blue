import { expect, test } from "@playwright/test";
import { expectNoPageErrors, goToGame } from "./helpers";

test("SPA root renders three AI panels and composer", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page, { sse: ["hi"] });

	await expect(page.locator("article.ai-panel")).toHaveCount(3);

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

	await expectNoPageErrors(page, pageErrors);
});

test("expectNoPageErrors catches late-fired microtask errors (regression)", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page, { sse: ["hi"] });

	await page.evaluate(() => {
		queueMicrotask(() => {
			throw new Error("late pageerror from microtask");
		});
	});

	await expect(expectNoPageErrors(page, pageErrors)).rejects.toThrow(
		"late pageerror from microtask",
	);
});
