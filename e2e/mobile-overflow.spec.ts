/**
 * E2E — the app shell must not overflow horizontally at phone widths (#554).
 *
 * The bug: at 375px the shell produced `document.body.scrollWidth` of 379 /
 * 385 / 396 against a 375px `window.innerWidth`. It was reported as flaky
 * (roughly 1 run in 4 under full-suite load, and it passed in isolation), and
 * that is exactly what the cause predicts.
 *
 * Root cause (measured, see the PR for the numbers):
 *
 *   `#stage` is a grid with a single implicit `auto` column track, and grid
 *   items default to `min-width: auto` — so the track is sized by the widest
 *   row's *min-content* width, and every other row is stretched onto that
 *   track. One of those rows is `#dev-game-strip`, whose `.dev-strip-line`
 *   children were nowrap flex containers: a nowrap flex row's min-content
 *   width is the SUM of its items, so it cannot shrink below its content.
 *   Line 1 carries the randomized `setting` / `weather` / `time-of-day`
 *   strings, whose combined width varies per session and sometimes exceeds
 *   the ~351px the stage offers at 375px. When it does, the track grows,
 *   `HEADER`, `.topinfo`, `#panels` and `#composer` are dragged onto the
 *   wider track, and the page overflows. The content-dependence is the
 *   flakiness.
 *
 * The fix is `flex-wrap: wrap` on `.dev-strip-line`.
 *
 * These specs assert the acceptance criterion — `body.scrollWidth <=
 * window.innerWidth + 1` — rather than a DOM shape, so they cannot be
 * satisfied by a cosmetic change. Both a natural boot (the real randomized
 * content, catching the exact flake) and a forced wide-strip state (the
 * deterministic reproduction, catching the mechanism) are covered: the
 * natural case alone is probabilistic and could pass by luck.
 */
import { expect, test } from "@playwright/test";
import { expectNoPageErrors, goToGame } from "./helpers";

/** Every width the app claims to support on mobile. */
const MOBILE_WIDTHS = [320, 360, 375, 390, 414] as const;

/**
 * Read the page-level overflow probe. `docScrollWidth` is reported alongside
 * `bodyScrollWidth` so a failure shows whether the overflow escaped the
 * document box or is contained by `html`/`body` (`overflow: hidden`).
 */
async function overflowProbe(page: import("@playwright/test").Page) {
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
			line1FlexWrap: (() => {
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
		// The acceptance criterion from the ticket.
		expect(probe.bodyScrollWidth).toBeLessThanOrEqual(probe.innerWidth + 1);
		// Nothing escapes the document box either.
		expect(probe.docScrollWidth).toBeLessThanOrEqual(probe.innerWidth + 1);
		// The shell occupies exactly one stage track: no row may exceed it.
		expect(probe.stageScrollWidth).toBeLessThanOrEqual(
			probe.stageClientWidth + 1,
		);
		// The strip's own content fits its box — this is what the fix buys.
		expect(probe.stripScrollWidth).toBeLessThanOrEqual(
			probe.stripClientWidth + 1,
		);

		await expectNoPageErrors(page, pageErrors);
	});

	test("a wide dev-strip row cannot blow out the stage track", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });

		// `.dev-strip-line` is a dev-build affordance (`__DEV__` is true under
		// the Playwright webServer's `WORKER_BASE_URL`), so it is present here.
		await expect(page.locator(".dev-strip-line").first()).toBeAttached();

		// Assert the property the fix establishes, before forcing content: a
		// nowrap flex row reports min-content = sum of its items and cannot
		// shrink, which is what expanded the stage track.
		expect((await overflowProbe(page)).line1FlexWrap).toBe("wrap");

		// Force the deterministic reproduction. These are realistic values for
		// the randomized fields — the natural flake is this, with content the
		// generator happened to pick. Without `flex-wrap: wrap` the track grows
		// to ~372px, HEADER/.topinfo are stretched past the viewport, and
		// `body.scrollWidth` reads ~385 against innerWidth 375.
		await page.evaluate(() => {
			const set = (field: string, text: string) => {
				const el = document.querySelector<HTMLElement>(
					`[data-field="${field}"]`,
				);
				if (el) el.textContent = text;
			};
			set(
				"setting",
				"an abandoned municipal library overflowing with waterlogged books",
			);
			set("weather", "A fine, gritty dust hangs suspended in the air.");
			set("time-of-day", "an overcast, starless night");
		});

		const probe = await overflowProbe(page);
		expect(probe.innerWidth).toBe(375);
		expect(probe.bodyScrollWidth).toBeLessThanOrEqual(probe.innerWidth + 1);
		expect(probe.docScrollWidth).toBeLessThanOrEqual(probe.innerWidth + 1);
		// The stage track must stay pinned to the stage's own inline size, so
		// the sibling rows are not stretched: 375 - 12 - 12 = 351.
		expect(probe.stageGridColumns).toBe("351px");
		expect(probe.stripScrollWidth).toBeLessThanOrEqual(
			probe.stripClientWidth + 1,
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
			// A wide strip forces the condition the fix must hold under at
			// every width, not just the one in the ticket.
			await page.evaluate(() => {
				const set = (field: string, text: string) => {
					const el = document.querySelector<HTMLElement>(
						`[data-field="${field}"]`,
					);
					if (el) el.textContent = text;
				};
				set(
					"setting",
					"an abandoned municipal library overflowing with waterlogged books",
				);
				set("weather", "A fine, gritty dust hangs suspended in the air.");
				set("time-of-day", "an overcast, starless night");
			});
			const probe = await overflowProbe(page);
			expect(
				probe.bodyScrollWidth,
				`body.scrollWidth at ${width}px`,
			).toBeLessThanOrEqual(probe.innerWidth + 1);
			expect(
				probe.docScrollWidth,
				`documentElement.scrollWidth at ${width}px`,
			).toBeLessThanOrEqual(probe.innerWidth + 1);
		}

		await expectNoPageErrors(page, pageErrors);
	});
});
