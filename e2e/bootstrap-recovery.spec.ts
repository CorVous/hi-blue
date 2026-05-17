import { expect, test } from "@playwright/test";

/**
 * Acceptance spec: Bootstrap recovery UI with regenerate and abandon paths.
 *
 * Covers:
 * 1. Regen happy path: content-pack fails on first call, succeeds on retry after clicking regen
 * 2. Abandon path: recovery UI visible, click abandon to bounce to #/start?reason=broken
 */

test("regen happy path: content-pack fails, recover via regen button, game renders", async ({
	page,
}) => {
	let contentPackCallCount = 0;
	let releaseContentPack!: () => void;
	const contentPackHeld = new Promise<void>((resolve) => {
		releaseContentPack = resolve;
	});

	// Stub LLM calls for synthesis and content generation
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = JSON.parse(request.postData() ?? "null") as {
			stream?: boolean;
			response_format?: unknown;
			messages?: Array<{ role?: string; content?: string }>;
		};

		const userMsg = body?.messages?.[1]?.content ?? "";

		// Synthesis request: always succeed
		if (userMsg.startsWith("Synthesize blurbs for these personas:")) {
			const ids = Array.from(
				userMsg.matchAll(/id:\s*"([a-z0-9]{4})"/g),
				(m) => m[1] ?? "",
			).filter(Boolean);

			const content = JSON.stringify({
				personas: ids.map((id) => ({
					id,
					blurb: `Stub blurb for ${id}.`,
					voiceExamples: [
						`Voice 1 for ${id}.`,
						`Voice 2 for ${id}.`,
						`Voice 3 for ${id}.`,
					],
				})),
			});

			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ choices: [{ message: { content } }] }),
			});
			return;
		}

		// Content-pack request: fail first call, succeed on retry
		if (userMsg.startsWith("Generate")) {
			// FIXME: second call success handler commented out pending investigation (#380)
			// When the success handler is present, the recovery UI doesn't show on the first
			// call failure, which is the inverse of the expected behavior. For now, all
			// Generate requests are aborted to verify the recovery UI path works.
			// The second call (after regen click) will also fail, causing the test to timeout.
			contentPackCallCount++;

			if (contentPackCallCount === 1) {
				// First call: hold until released, then fail
				await contentPackHeld;
				await route.abort("failed");
				return;
			}

			// TODO: Restore second-call success handler once investigation is complete.
			// The handler structure is correct (valid dual content pack) but something
			// about its presence causes the first call's abort to not trigger recovery UI.
			//
			// For now, second call also aborts to isolate the first-call issue:
			await route.abort("failed");
			return;
		}

		// Fallback
		await route.abort();
	});

	// Navigate to game page
	await page.goto("/?skipDialup=1");
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 30_000 });

	// Fill password and click CONNECT
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();

	// Wait until the SPA has navigated to #/game
	await page.waitForURL(/#\/game/, { timeout: 10_000 });

	// Release the content-pack rejection so recovery UI shows
	releaseContentPack();

	// Wait for recovery UI to become visible
	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 30_000,
	});

	// Verify we're still at #/game (not bounced to #/start?reason=broken)
	await expect(page).toHaveURL(/#\/game\/?$/);

	// Click the regen button to retry
	await page.locator("#bootstrap-recovery-regen").click();

	// Recovery UI should hide while loading
	await expect(page.locator("#bootstrap-recovery")).toBeHidden({
		timeout: 5_000,
	});

	// Wait for daemon panels to appear (game renders)
	// Check that at least one panel-name element exists and is visible
	await expect(page.locator(".panel-name").first()).toBeVisible({
		timeout: 30_000,
	});

	// Verify recovery UI stays hidden
	await expect(page.locator("#bootstrap-recovery")).toBeHidden();

	// Verify location.hash is still #/game
	await expect(page).toHaveURL(/#\/game\/?$/);
});

test("abandon path: recovery UI visible, click abandon to bounce to #/start?reason=broken", async ({
	page,
}) => {
	let releaseContentPack!: () => void;
	const contentPackHeld = new Promise<void>((resolve) => {
		releaseContentPack = resolve;
	});

	// Stub LLM calls
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = JSON.parse(request.postData() ?? "null") as {
			stream?: boolean;
			response_format?: unknown;
			messages?: Array<{ role?: string; content?: string }>;
		};

		const userMsg = body?.messages?.[1]?.content ?? "";

		// Synthesis request: always succeed
		if (userMsg.startsWith("Synthesize blurbs for these personas:")) {
			const ids = Array.from(
				userMsg.matchAll(/id:\s*"([a-z0-9]{4})"/g),
				(m) => m[1] ?? "",
			).filter(Boolean);

			const content = JSON.stringify({
				personas: ids.map((id) => ({
					id,
					blurb: `Stub blurb for ${id}.`,
					voiceExamples: [
						`Voice 1 for ${id}.`,
						`Voice 2 for ${id}.`,
						`Voice 3 for ${id}.`,
					],
				})),
			});

			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ choices: [{ message: { content } }] }),
			});
			return;
		}

		// Content-pack request: hold until released, then fail
		if (userMsg.startsWith("Generate")) {
			await contentPackHeld;
			await route.abort("failed");
			return;
		}

		// Fallback
		await route.abort();
	});

	// Navigate to game page
	await page.goto("/?skipDialup=1");
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 30_000 });

	// Fill password and click CONNECT
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();

	// Wait until the SPA has navigated to #/game
	await page.waitForURL(/#\/game/, { timeout: 10_000 });

	// Release the content-pack rejection so recovery UI shows
	releaseContentPack();

	// Wait for recovery UI to become visible
	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 30_000,
	});

	// Click the abandon link
	await page.locator("#bootstrap-recovery-abandon").click();

	// Should navigate to #/start?reason=broken
	await expect(page).toHaveURL(/#\/start\?reason=broken/, {
		timeout: 5_000,
	});
});
