import { expect, test } from "@playwright/test";
import { getAiHandles, stubChatCompletions } from "./helpers";

/**
 * E2E spec for #109: visual feedback for the active addressee.
 *
 * Tests read AI handles dynamically from data-ai; no spec hard-codes handle
 * names (replaces obsolete red/green/blue/Ember/Sage/Frost fixed handles).
 *
 * Visual feedback in the new BBS UI:
 *  - The addressed panel receives the `panel--addressed` CSS class.
 *  - Non-addressed panels do NOT have `panel--addressed`.
 *  - The overlay mention span has `--panel-color` set (not a color class name).
 *  - Clicking a different panel rewrites the mention and transfers the highlight.
 *  - Clearing the input removes all feedback.
 */

test("typing '*<ai1> hi' → second panel highlighted, overlay mention-highlight span", async ({
	page,
}) => {
	await stubChatCompletions(page, ["hi"]);
	await page.goto("/");
	await expect(page.locator("#composer")).toBeVisible();

	const { ids, names } = await getAiHandles(page);

	await page.fill("#prompt", `*${names[1]} hi`);

	// Second panel has panel--addressed
	await expect(page.locator(`.ai-panel[data-ai="${ids[1]}"]`)).toHaveClass(
		/panel--addressed/,
	);

	// First and third panels do NOT have panel--addressed
	await expect(page.locator(`.ai-panel[data-ai="${ids[0]}"]`)).not.toHaveClass(
		/panel--addressed/,
	);
	await expect(page.locator(`.ai-panel[data-ai="${ids[2]}"]`)).not.toHaveClass(
		/panel--addressed/,
	);

	// Overlay has exactly one mention-highlight span with the correct name
	const highlightSpan = page.locator("#prompt-overlay .mention-highlight");
	await expect(highlightSpan).toHaveCount(1);
	await expect(highlightSpan).toHaveText(`*${names[1]}`);
});

test("after typing '*<ai1> hi', clicking third panel transfers highlight to third panel", async ({
	page,
}) => {
	await stubChatCompletions(page, ["hi"]);
	await page.goto("/");
	await expect(page.locator("#composer")).toBeVisible();

	const { ids, names } = await getAiHandles(page);

	// Set up second AI mention first
	await page.fill("#prompt", `*${names[1]} hi`);
	await expect(page.locator(`.ai-panel[data-ai="${ids[1]}"]`)).toHaveClass(
		/panel--addressed/,
	);

	// Click the third panel
	await page.locator(`.ai-panel[data-ai="${ids[2]}"]`).click();

	// Input value should start with *<name of ids[2]>
	const value = await page.locator("#prompt").inputValue();
	expect(value.startsWith(`*${names[2]}`)).toBe(true);

	// Third panel now has highlight
	await expect(page.locator(`.ai-panel[data-ai="${ids[2]}"]`)).toHaveClass(
		/panel--addressed/,
	);

	// Second panel no longer highlighted
	await expect(page.locator(`.ai-panel[data-ai="${ids[1]}"]`)).not.toHaveClass(
		/panel--addressed/,
	);

	// Overlay highlight is *<name of ids[2]>
	const highlightSpan = page.locator("#prompt-overlay .mention-highlight");
	await expect(highlightSpan).toHaveCount(1);
	await expect(highlightSpan).toHaveText(`*${names[2]}`);
});

test("clearing input removes all visual feedback", async ({ page }) => {
	await stubChatCompletions(page, ["hi"]);
	await page.goto("/");
	await expect(page.locator("#composer")).toBeVisible();

	const { names } = await getAiHandles(page);

	// First set a mention to create visual state
	await page.fill("#prompt", `*${names[1]} hi`);
	await expect(page.locator(".panel--addressed")).toHaveCount(1);

	// Clear the input
	await page.fill("#prompt", "");
	await page.locator("#prompt").dispatchEvent("input");

	// No panel--addressed on any panel
	await expect(page.locator(".panel--addressed")).toHaveCount(0);

	// No .mention-highlight in overlay
	await expect(page.locator("#prompt-overlay .mention-highlight")).toHaveCount(
		0,
	);
});
