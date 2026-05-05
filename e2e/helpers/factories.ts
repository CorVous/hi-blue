import type { Page } from "@playwright/test";

/**
 * Start a new game session in "win immediately" test mode.
 *
 * Posts to `/game/new` with `{ testMode: "win_immediately" }`, which causes
 * the worker to create a session whose phase-1 win condition fires on the very
 * first turn. The worker sets the session cookie on the `BrowserContext`
 * automatically; this factory returns nothing.
 *
 * @param page  The Playwright `Page` whose `BrowserContext` should receive the
 *              session cookie.
 *
 * @remarks
 * **Requires** the worker to be started with `ENABLE_TEST_MODES=1`. When that
 * flag is unset the worker silently ignores `testMode` (see
 * `src/proxy/_smoke.ts` ~line 221) and falls back to the real
 * `PHASE_1_CONFIG` — this factory will still resolve without error, but the
 * game will NOT enter win-immediately mode. This is a known foot-gun: tests
 * will appear to pass setup but then behave unexpectedly at runtime.
 */
export async function newWinImmediatelyGame(page: Page): Promise<void> {
	const response = await page.request.post("/game/new", {
		data: { testMode: "win_immediately" },
	});
	if (!response.ok()) {
		throw new Error(`/game/new failed with status ${response.status()}`);
	}
}
