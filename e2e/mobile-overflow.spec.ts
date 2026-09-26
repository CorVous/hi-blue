import { expect, type Page, test } from "@playwright/test";
import { expectNoPageErrors, goToGame } from "./helpers";

const MOBILE_WIDTHS = [320, 360, 375, 390, 414] as const;

const SUBPIXEL_TOLERANCE_PX = 1;

const STAGE_TRACK_AT_375PX_MINUS_12PX_GUTTERS = "351px";

async function forceWideDevStripContent(page: Page): Promise<void> {
	await page.evaluate(() => {
		const set = (field: string, text: string) => {
			const el = document.querySelector<HTMLElement>(`[data-field="${field}"]`);
			if (el) el.textContent = text;
		};
		set(
			"setting",
			"an abandoned municipal library overflowing with waterlogged books",
		);
		set("weather", "A fine, gritty dust hangs suspended in the air.");
		set("time-of-day", "an overcast, starless night");
	});
}

async function overflowProbe(page: Page) {
	return page.evaluate(() => {
		const stage = document.querySelector<HTMLElement>("#stage");
		const strip = document.querySelector<HTMLElement>("#dev-game-strip");
		return {
			bodyScrollWidth: document.body.scrollWidth,
			docScrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
			stageGridColumns: stage
				? getComputedStyle(stage).gridTemplateColumns
				: null,
			stageScrollWidth: stage?.scrollWidth ?? 0,
			stageClientWidth: stage?.clientWidth ?? 0,
			stripScrollWidth: strip?.scrollWidth ?? 0,
			stripClientWidth: strip?.clientWidth ?? 0,
			firstStripLineFlexWrap: (() => {
				const line = document.querySelector<HTMLElement>(".dev-strip-line");
				return line ? getComputedStyle(line).flexWrap : null;
			})(),
		};
	});
}

test.describe("mobile shell overflow (#554)", () => {
	test.use({ viewport: { width: 375, height: 667 } });

	test("the booted shell does not overflow at 375px", async ({ page }) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });
		const probe = await overflowProbe(page);

		expect(probe.innerWidth).toBe(375);
		expect(probe.bodyScrollWidth).toBeLessThanOrEqual(
			probe.innerWidth + SUBPIXEL_TOLERANCE_PX,
		);
		expect(probe.docScrollWidth).toBeLessThanOrEqual(
			probe.innerWidth + SUBPIXEL_TOLERANCE_PX,
		);
		expect(probe.stageScrollWidth).toBeLessThanOrEqual(
			probe.stageClientWidth + SUBPIXEL_TOLERANCE_PX,
		);
		expect(probe.stripScrollWidth).toBeLessThanOrEqual(
			probe.stripClientWidth + SUBPIXEL_TOLERANCE_PX,
		);

		await expectNoPageErrors(page, pageErrors);
	});

	test("a wide dev-strip row cannot blow out the stage track", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });

		await expect(page.locator(".dev-strip-line").first()).toBeAttached();

		expect((await overflowProbe(page)).firstStripLineFlexWrap).toBe("wrap");

		await forceWideDevStripContent(page);

		const probe = await overflowProbe(page);
		expect(probe.innerWidth).toBe(375);
		expect(probe.bodyScrollWidth).toBeLessThanOrEqual(
			probe.innerWidth + SUBPIXEL_TOLERANCE_PX,
		);
		expect(probe.docScrollWidth).toBeLessThanOrEqual(
			probe.innerWidth + SUBPIXEL_TOLERANCE_PX,
		);
		expect(probe.stageGridColumns).toBe(
			STAGE_TRACK_AT_375PX_MINUS_12PX_GUTTERS,
		);
		expect(probe.stripScrollWidth).toBeLessThanOrEqual(
			probe.stripClientWidth + SUBPIXEL_TOLERANCE_PX,
		);

		await expectNoPageErrors(page, pageErrors);
	});

	test("no horizontal overflow at any supported mobile width", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });

		for (const width of MOBILE_WIDTHS) {
			await page.setViewportSize({ width, height: 800 });
			await forceWideDevStripContent(page);
			const probe = await overflowProbe(page);
			expect(
				probe.bodyScrollWidth,
				`body.scrollWidth at ${width}px`,
			).toBeLessThanOrEqual(probe.innerWidth + SUBPIXEL_TOLERANCE_PX);
			expect(
				probe.docScrollWidth,
				`documentElement.scrollWidth at ${width}px`,
			).toBeLessThanOrEqual(probe.innerWidth + SUBPIXEL_TOLERANCE_PX);
		}

		await expectNoPageErrors(page, pageErrors);
	});
});
