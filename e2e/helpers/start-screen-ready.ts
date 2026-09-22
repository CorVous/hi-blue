/**
 * start-screen-ready.ts
 *
 * Event-driven readiness wait for the start screen's `[ CONNECT ]` / `#begin`
 * button.
 *
 * ## What actually gates `#begin`
 *
 * `#begin` ships with the `disabled` attribute in the markup and is flipped
 * enabled in exactly one place: `revealLogin()` in `src/spa/views/start.ts`.
 * With `?skipDialup=1` (or `prefers-reduced-motion: reduce`) `revealLogin()`
 * runs **synchronously** during the first `renderStart`, so `#begin` becomes
 * enabled as soon as the SPA has booted — it does **not** wait on persona
 * synthesis or content-pack generation. Generation continues in the background
 * and the game route renders progressive loading.
 *
 * That means "`#begin` enabled" is a proxy for **"the SPA booted and
 * `renderStart` ran"**, not for "generation completed". Waiting a fixed 10s for
 * it therefore measures bundle fetch/parse/boot latency under whatever load the
 * machine happens to be under — not the generation work the surrounding specs
 * are named for. Under full-suite load (or on a cold browser cache) boot can
 * exceed 10s, which is what made `e2e/start-screen.spec.ts:131` and `:274`
 * flake.
 *
 * ## Why this is a state wait, not a bigger number
 *
 * {@link waitForStartScreenReady} resolves on the real boot signal rather than
 * sleeping a longer fixed budget:
 *
 *   1. It waits on the boot state itself — `renderApp` sets `main[data-view]`
 *      before dispatching to the renderer, and `revealLogin` clears `#begin`'s
 *      `disabled` — so the wait completes the moment the app is ready, with no
 *      fixed sleep and no dependence on how loaded the machine is.
 *   2. If the app never reaches that state it throws, and it first checks
 *      whether the app instead landed on its `#cap-hit` failure UX so that a
 *      broken stub reports *that* rather than the bare timeout.
 *
 * Note the `#cap-hit` check is a diagnostic for failures that prevent boot, not
 * a general "generation failed" detector: on the normal boot path `revealLogin`
 * enables `#begin` before the background generation promise settles, so a
 * generation rejection surfaces `#cap-hit` only *after* this helper has already
 * resolved. Specs that assert on generation failure must still check `#cap-hit`
 * themselves (see the "CapHit during generation" spec).
 *
 * The default budget is the repo's established boot budget for this button
 * (`e2e/bootstrap-recovery.spec.ts`, `e2e/bootstrap-failure-bounce.spec.ts` and
 * `e2e/helpers/handles.ts` all use 30s): it is a ceiling on *boot under
 * arbitrary load*, not a tuned timing assumption, and a healthy run resolves it
 * in a few hundred milliseconds.
 */
import type { Page } from "@playwright/test";

/** Repo-wide default ceiling for "the SPA has booted", in milliseconds. */
export const START_SCREEN_BOOT_TIMEOUT_MS = 30_000;

/**
 * Wait until the start screen is booted and `[ CONNECT ]` (`#begin`) is
 * enabled, then return the `#begin` locator for further interaction.
 *
 * Resolves as soon as the app reports readiness; it does not sleep out a fixed
 * budget. Throws a descriptive error if the app boots into the cap-hit failure
 * state instead, or if it never boots within `timeoutMs`.
 *
 * Gate on this whenever a spec needs to click `[ CONNECT ]`. It assumes the
 * dial-up animation is skipped (`?skipDialup=1`), which is what makes
 * `revealLogin()` run at boot; without that, `#begin` genuinely waits on the
 * ~7s animation and this helper's "booted" framing no longer applies.
 */
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
				// The app is ready once the router has published a view and
				// `revealLogin()` has cleared the markup's initial `disabled`.
				return (
					begin !== null &&
					!begin.disabled &&
					root !== null &&
					root.dataset.view !== undefined
				);
			},
			undefined,
			{ timeout: timeoutMs },
		);
	} catch (err) {
		// Distinguish "the app landed on its failure UX and so never enables
		// `#begin`" from "the app never booted" so a real regression reports its
		// cause instead of a bare timeout. `renderStart` unhides `#cap-hit` and
		// hides `#start-screen` when generation rejects.
		const capHitVisible = await page
			.locator("#cap-hit")
			.isVisible()
			.catch(() => false);
		if (capHitVisible) {
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
