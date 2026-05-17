import { expect, type Page } from "@playwright/test";

/**
 * Drain in-flight `pageerror` events and then assert none were collected.
 *
 * Browser `pageerror` events are dispatched asynchronously — errors thrown
 * inside `queueMicrotask`, `setTimeout(fn, 0)`, or during teardown may fire
 * after the last `await` in a test body but before the page is torn down.
 * A bare synchronous `expect(pageErrors).toEqual([])` misses these.
 *
 * This helper gives the browser a short bounded settle (100 ms via
 * `page.waitForTimeout`) to flush any queued error events before asserting.
 *
 * Usage (replaces the bare inline assertion):
 * ```ts
 * const pageErrors: Error[] = [];
 * page.on("pageerror", (err) => pageErrors.push(err));
 * // ... test body ...
 * await expectNoPageErrors(page, pageErrors);
 * ```
 */
export async function expectNoPageErrors(
	page: Page,
	pageErrors: Error[],
): Promise<void> {
	// Allow up to 100 ms for late-fired microtask / timer errors to arrive.
	await page.waitForTimeout(100);
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
}
