import { expect, test } from "@playwright/test";
import { expectNoPageErrors, goToGame } from "./helpers";

test("SPA root renders three AI panels and composer", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page, { sse: ["hi"] });

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

	await expectNoPageErrors(page, pageErrors);
});

test("expectNoPageErrors catches late-fired microtask errors (regression)", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page, { sse: ["hi"] });

	// Fire a late error via queueMicrotask — this runs after the current
	// task unwinds but before the next macrotask, simulating errors that
	// arrive asynchronously after the last `await` in a test body.
	await page.evaluate(() => {
		queueMicrotask(() => {
			throw new Error("late pageerror from microtask");
		});
	});

	// expectNoPageErrors must catch this; the test asserts the helper works.
	await expect(expectNoPageErrors(page, pageErrors)).rejects.toThrow(
		"late pageerror from microtask",
	);
});
