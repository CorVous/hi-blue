/**
 * Regression test for the bento layout at <=720px.
 *
 * Bug history: `.ai-panel { flex: 1 1 0; width: 0 }` from the desktop flex
 * row leaked into the bento grid context, collapsing every panel to 0px
 * wide even though the grid cells were sized correctly. Fix overrides
 * `flex` / `width` inside the `@media (max-width: 720px)` block.
 */
import { expect, test } from "@playwright/test";
import { getAiHandles, stubChatCompletions } from "./helpers";

test.use({ viewport: { width: 375, height: 667 } });

test("bento layout: panels have non-zero geometry inside their grid cells", async ({
	page,
}) => {
	await stubChatCompletions(page, ["hi"]);
	await page.goto("/");

	const handles = await getAiHandles(page);

	// No-address: first panel should be the main, others strip cards.
	const noAddress = await page.evaluate(() => {
		const panels = Array.from(
			document.querySelectorAll<HTMLElement>("article.ai-panel"),
		);
		return panels.map((p) => {
			const r = p.getBoundingClientRect();
			return { w: r.width, h: r.height, gridRow: getComputedStyle(p).gridRow };
		});
	});
	// Main panel (first child) spans both columns → ~viewport width.
	expect(noAddress[0]?.gridRow).toBe("1");
	expect(noAddress[0]?.w).toBeGreaterThan(300);
	expect(noAddress[0]?.h).toBeGreaterThan(200);
	// Strip cards must not be zero-width.
	expect(noAddress[1]?.gridRow).toBe("2");
	expect(noAddress[1]?.w).toBeGreaterThan(100);
	expect(noAddress[2]?.gridRow).toBe("2");
	expect(noAddress[2]?.w).toBeGreaterThan(100);

	// @-address middle panel → it becomes the main, others demote to strip.
	await page.locator("#prompt").fill(`${handles.mention(1)} hello`);
	await page.waitForFunction(
		() => document.querySelectorAll(".panel--addressed").length === 1,
	);
	const addressed = await page.evaluate(() => {
		const panels = Array.from(
			document.querySelectorAll<HTMLElement>("article.ai-panel"),
		);
		return panels.map((p) => {
			const r = p.getBoundingClientRect();
			return {
				w: r.width,
				h: r.height,
				gridRow: getComputedStyle(p).gridRow,
				addressed: p.classList.contains("panel--addressed"),
			};
		});
	});
	expect(addressed[1]?.addressed).toBe(true);
	expect(addressed[1]?.gridRow).toBe("1");
	expect(addressed[1]?.w).toBeGreaterThan(300);
	expect(addressed[1]?.h).toBeGreaterThan(200);
	expect(addressed[0]?.gridRow).toBe("2");
	expect(addressed[0]?.w).toBeGreaterThan(100);
	expect(addressed[2]?.gridRow).toBe("2");
	expect(addressed[2]?.w).toBeGreaterThan(100);
});
