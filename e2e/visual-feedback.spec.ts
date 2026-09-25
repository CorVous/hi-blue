import { expect, test } from "@playwright/test";
import { goToGame } from "./helpers";

test("typing '*<ai1> hi' → second panel highlighted, overlay mention-highlight span", async ({
	page,
}) => {
	const { ids, names } = await goToGame(page, { sse: ["hi"] });
	await expect(page.locator("#composer")).toBeVisible();

	await page.fill("#prompt", `*${names[1]} hi`);

	await expect(page.locator(`.ai-panel[data-ai="${ids[1]}"]`)).toHaveClass(
		/panel--addressed/,
	);

	await expect(page.locator(`.ai-panel[data-ai="${ids[0]}"]`)).not.toHaveClass(
		/panel--addressed/,
	);
	await expect(page.locator(`.ai-panel[data-ai="${ids[2]}"]`)).not.toHaveClass(
		/panel--addressed/,
	);

	const highlightSpan = page.locator("#prompt-overlay .mention-highlight");
	await expect(highlightSpan).toHaveCount(1);
	await expect(highlightSpan).toHaveText(`*${names[1]}`);
});

test("after typing '*<ai1> hi', clicking third panel transfers highlight to third panel", async ({
	page,
}) => {
	const { ids, names } = await goToGame(page, { sse: ["hi"] });
	await expect(page.locator("#composer")).toBeVisible();

	await page.fill("#prompt", `*${names[1]} hi`);
	await expect(page.locator(`.ai-panel[data-ai="${ids[1]}"]`)).toHaveClass(
		/panel--addressed/,
	);

	await page.locator(`.ai-panel[data-ai="${ids[2]}"]`).click();

	const value = await page.locator("#prompt").inputValue();
	expect(value.startsWith(`*${names[2]}`)).toBe(true);

	await expect(page.locator(`.ai-panel[data-ai="${ids[2]}"]`)).toHaveClass(
		/panel--addressed/,
	);

	await expect(page.locator(`.ai-panel[data-ai="${ids[1]}"]`)).not.toHaveClass(
		/panel--addressed/,
	);

	const highlightSpan = page.locator("#prompt-overlay .mention-highlight");
	await expect(highlightSpan).toHaveCount(1);
	await expect(highlightSpan).toHaveText(`*${names[2]}`);
});

test("clearing input removes all visual feedback", async ({ page }) => {
	const { names } = await goToGame(page, { sse: ["hi"] });
	await expect(page.locator("#composer")).toBeVisible();

	await page.fill("#prompt", `*${names[1]} hi`);
	await expect(page.locator(".panel--addressed")).toHaveCount(1);

	await page.fill("#prompt", "");
	await page.locator("#prompt").dispatchEvent("input");

	await expect(page.locator(".panel--addressed")).toHaveCount(0);

	await expect(page.locator("#prompt-overlay .mention-highlight")).toHaveCount(
		0,
	);
});
