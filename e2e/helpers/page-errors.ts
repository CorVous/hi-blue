import { expect, type Page } from "@playwright/test";

const LATE_PAGE_ERROR_SETTLE_MS = 100;

export function collectPageErrors(page: Page): Error[] {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));
	return pageErrors;
}

export async function expectNoPageErrors(
	page: Page,
	pageErrors: Error[],
): Promise<void> {
	await page.waitForTimeout(LATE_PAGE_ERROR_SETTLE_MS);
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
}
