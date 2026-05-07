import { expect, test } from "@playwright/test";

/**
 * E2E spec for #109: visual feedback for the active addressee.
 *
 * Three tests — no LLM stub needed (no submits):
 * 1. Type "@Sage hi": green border on #prompt, green panel highlight, @Sage overlay span.
 * 2. After step-1 setup, click blue panel: highlight transfers to blue, overlay shows @Frost.
 * 3. Clear input: all visual feedback removed.
 */

test("typing '@Sage hi' → green border, green panel highlight, @Sage overlay span", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.locator("#composer")).toBeVisible();

	await page.fill("#prompt", "@Sage hi");

	// Composer border has composer-border--green
	await expect(page.locator("#prompt")).toHaveClass(/composer-border--green/);

	// Green panel has panel--addressed and panel--addressed-green
	await expect(page.locator('.ai-panel[data-ai="green"]')).toHaveClass(
		/panel--addressed/,
	);
	await expect(page.locator('.ai-panel[data-ai="green"]')).toHaveClass(
		/panel--addressed-green/,
	);

	// Other panels do NOT have panel--addressed
	await expect(page.locator('.ai-panel[data-ai="red"]')).not.toHaveClass(
		/panel--addressed/,
	);
	await expect(page.locator('.ai-panel[data-ai="blue"]')).not.toHaveClass(
		/panel--addressed/,
	);

	// Overlay has exactly one mention-highlight span with @Sage text and mention--green
	const highlightSpan = page.locator(
		"#prompt-overlay .mention-highlight.mention--green",
	);
	await expect(highlightSpan).toHaveCount(1);
	await expect(highlightSpan).toHaveText("@Sage");
});

test("after typing '@Sage hi', clicking blue panel transfers highlight to blue", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.locator("#composer")).toBeVisible();

	// Set up green mention first
	await page.fill("#prompt", "@Sage hi");
	await expect(page.locator("#prompt")).toHaveClass(/composer-border--green/);

	// Click the blue panel
	await page.locator('.ai-panel[data-ai="blue"]').click();

	// Input value should start with @Frost
	const value = await page.locator("#prompt").inputValue();
	expect(value.startsWith("@Frost")).toBe(true);

	// Border flips to blue
	await expect(page.locator("#prompt")).toHaveClass(/composer-border--blue/);
	await expect(page.locator("#prompt")).not.toHaveClass(
		/composer-border--green/,
	);

	// Blue panel now has highlight
	await expect(page.locator('.ai-panel[data-ai="blue"]')).toHaveClass(
		/panel--addressed/,
	);
	await expect(page.locator('.ai-panel[data-ai="blue"]')).toHaveClass(
		/panel--addressed-blue/,
	);

	// Green panel no longer highlighted
	await expect(page.locator('.ai-panel[data-ai="green"]')).not.toHaveClass(
		/panel--addressed/,
	);

	// Overlay highlight is @Frost with mention--blue
	const highlightSpan = page.locator(
		"#prompt-overlay .mention-highlight.mention--blue",
	);
	await expect(highlightSpan).toHaveCount(1);
	await expect(highlightSpan).toHaveText("@Frost");
});

test("clearing input removes all visual feedback", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("#composer")).toBeVisible();

	// First set a mention to create visual state
	await page.fill("#prompt", "@Sage hi");
	await expect(page.locator("#prompt")).toHaveClass(/composer-border--green/);

	// Clear the input
	await page.fill("#prompt", "");
	await page.locator("#prompt").dispatchEvent("input");

	// No composer-border-- class on #prompt
	const classList = await page.locator("#prompt").getAttribute("class");
	expect(classList ?? "").not.toMatch(/composer-border--/);

	// No panel--addressed on any panel
	await expect(page.locator(".panel--addressed")).toHaveCount(0);

	// No .mention-highlight in overlay
	await expect(page.locator("#prompt-overlay .mention-highlight")).toHaveCount(
		0,
	);
});
