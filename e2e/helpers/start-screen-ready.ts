import type { Page } from "@playwright/test";

export const START_SCREEN_BOOT_TIMEOUT_MS = 30_000;

async function isShowingCapHit(page: Page): Promise<boolean> {
	return page
		.locator("#cap-hit")
		.isVisible()
		.catch(() => false);
}

export async function waitForStartScreenReady(
	page: Page,
	timeoutMs: number = START_SCREEN_BOOT_TIMEOUT_MS,
): Promise<ReturnType<Page["locator"]>> {
	const beginBtn = page.locator("#begin");

	try {
		await page.waitForFunction(
			() => {
				const begin = document.querySelector<HTMLButtonElement>("#begin");
				const root = document.querySelector<HTMLElement>("main");
				const routerPublishedAView =
					root !== null && root.dataset.view !== undefined;
				const loginRevealed = begin !== null && !begin.disabled;
				return loginRevealed && routerPublishedAView;
			},
			undefined,
			{ timeout: timeoutMs },
		);
	} catch (err) {
		if (await isShowingCapHit(page)) {
			throw new Error(
				`waitForStartScreenReady: app is showing #cap-hit, so #begin never enables. ` +
					`Check the generation stub, not the timeout. ` +
					`(underlying: ${(err as Error).message})`,
			);
		}
		throw err;
	}

	return beginBtn;
}
