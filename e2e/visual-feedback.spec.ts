import { expect, test } from "@playwright/test";

/**
 * Issue #109 — Visual feedback for the active addressee.
 *
 * Tests that typing a @mention or clicking a panel applies the correct
 * CSS classes and overlay content.  No LLM stubs needed (no submit fired).
 */

test("typing @Sage hi → composer-border--green; green panel highlighted; overlay has @Sage span", async ({
	page,
}) => {
	await page.goto("/");

	const prompt = page.locator("#prompt");
	await prompt.fill("@Sage hi");
	// Dispatch an input event so the listener fires.
	await prompt.dispatchEvent("input");

	// Composer border
	await expect(prompt).toHaveClass(/composer-border--green/);

	// Green panel highlighted
	const greenPanel = page.locator('.ai-panel[data-ai="green"]');
	await expect(greenPanel).toHaveClass(/panel--addressed/);
	await expect(greenPanel).toHaveClass(/panel--addressed-green/);

	// Other panels not highlighted
	await expect(page.locator('.ai-panel[data-ai="red"]')).not.toHaveClass(
		/panel--addressed\b/,
	);
	await expect(page.locator('.ai-panel[data-ai="blue"]')).not.toHaveClass(
		/panel--addressed\b/,
	);

	// Overlay highlight span
	const span = page.locator("#prompt-overlay .mention-highlight");
	await expect(span).toHaveCount(1);
	await expect(span).toHaveText("@Sage");
	await expect(span).toHaveClass(/mention--green/);
});

test("clicking blue panel when input has '@Sage hi' rewrites to @Frost and switches highlight to blue", async ({
	page,
}) => {
	await page.goto("/");

	const prompt = page.locator("#prompt");
	await prompt.fill("@Sage hi");
	await prompt.dispatchEvent("input");

	// Click blue panel to rewrite mention.
	await page.locator('.ai-panel[data-ai="blue"]').click();

	// Input value starts with @Frost
	const value = await prompt.inputValue();
	expect(value.startsWith("@Frost")).toBe(true);

	// Border flipped to blue
	await expect(prompt).toHaveClass(/composer-border--blue/);
	await expect(prompt).not.toHaveClass(/composer-border--green/);

	// Blue panel highlighted
	const bluePanel = page.locator('.ai-panel[data-ai="blue"]');
	await expect(bluePanel).toHaveClass(/panel--addressed/);
	await expect(bluePanel).toHaveClass(/panel--addressed-blue/);

	// Green panel no longer highlighted
	await expect(page.locator('.ai-panel[data-ai="green"]')).not.toHaveClass(
		/panel--addressed\b/,
	);

	// Overlay highlight span is @Frost
	const span = page.locator("#prompt-overlay .mention-highlight");
	await expect(span).toHaveCount(1);
	await expect(span).toHaveText("@Frost");
	await expect(span).toHaveClass(/mention--blue/);
});

test("clearing input removes all visual classes and overlay highlights", async ({
	page,
}) => {
	await page.goto("/");

	const prompt = page.locator("#prompt");
	await prompt.fill("@Sage hi");
	await prompt.dispatchEvent("input");

	// Confirm highlights are active
	await expect(prompt).toHaveClass(/composer-border--green/);

	// Clear input
	await prompt.fill("");
	await prompt.dispatchEvent("input");

	// No composer-border classes
	await expect(prompt).not.toHaveClass(/composer-border--/);

	// No panel--addressed on any panel
	for (const ai of ["red", "green", "blue"]) {
		await expect(page.locator(`.ai-panel[data-ai="${ai}"]`)).not.toHaveClass(
			/panel--addressed\b/,
		);
	}

	// No overlay highlight spans
	await expect(
		page.locator("#prompt-overlay .mention-highlight"),
	).toHaveCount(0);
});
