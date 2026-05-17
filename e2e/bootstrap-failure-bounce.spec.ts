import { expect, test } from "@playwright/test";

/**
 * Acceptance spec: Bootstrap-time HTTP errors show recovery UI (not bounce).
 *
 * Covers:
 * 1. Content-pack request returns HTTP 500 → click CONNECT → shows #bootstrap-recovery
 * 2. Content-pack request returns HTTP 200 with error body → click CONNECT → shows #bootstrap-recovery
 *
 * Both scenarios verify the view stays on "game" (recovery UI lives inside it)
 * rather than flipping to "start" with reason=broken.
 */
test("content-pack request returns HTTP 500 → shows recovery UI", async ({
	page,
}) => {
	// Release-signal promise: hold content-pack rejection until after CONNECT
	let releaseContentPack!: () => void;
	const contentPackHeld = new Promise<void>((resolve) => {
		releaseContentPack = resolve;
	});

	// Stub new-game synthesis and persona requests normally
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = JSON.parse(request.postData() ?? "null") as {
			stream?: boolean;
			response_format?: unknown;
			messages?: Array<{ role?: string; content?: string }>;
		};

		const userMsg = body?.messages?.[1]?.content ?? "";

		// Synthesis request
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

		// Content-pack request: HOLD until released, then fail
		if (userMsg.startsWith("Generate")) {
			await contentPackHeld;
			await route.abort("failed");
			return;
		}

		// Fallback for other requests
		await route.abort();
	});

	// Navigate to the game page (this will trigger generation)
	await page.goto("/?skipDialup=1");
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 30_000 });

	// Fill password and click CONNECT
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();

	// Wait until the SPA has transitioned to the game view so the start-screen catch is bypassed
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});

	// NOW release the content-pack rejection. game.ts's loading-flow catch
	// (the recovery UI path) handles it.
	releaseContentPack();

	// Expect recovery UI to become visible — the view stays at "game"
	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.locator("main")).toHaveAttribute("data-view", "game");

	// Verify recovery UI title and buttons are present
	const titleEl = page.locator("#bootstrap-recovery-title");
	await expect(titleEl).toContainText("the room collapsed");
	await expect(page.locator("#bootstrap-recovery-regen")).toBeVisible();
	await expect(page.locator("#bootstrap-recovery-abandon")).toBeVisible();
});

test("content-pack request returns HTTP 200 with error body → shows recovery UI", async ({
	page,
}) => {
	// Release-signal promise: hold content-pack rejection until after CONNECT
	let releaseContentPack!: () => void;
	const contentPackHeld = new Promise<void>((resolve) => {
		releaseContentPack = resolve;
	});

	// Stub new-game synthesis and persona requests normally
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = JSON.parse(request.postData() ?? "null") as {
			stream?: boolean;
			response_format?: unknown;
			messages?: Array<{ role?: string; content?: string }>;
		};

		const userMsg = body?.messages?.[1]?.content ?? "";

		// Synthesis request
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

		// Content-pack request: HOLD until released, then fail
		if (userMsg.startsWith("Generate")) {
			await contentPackHeld;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					error: {
						message: "upstream stalled",
						code: "service_error",
					},
				}),
			});
			return;
		}

		// Fallback for other requests
		await route.abort();
	});

	// Navigate to the game page (this will trigger generation)
	await page.goto("/?skipDialup=1");
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 30_000 });

	// Fill password and click CONNECT
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();

	// Wait until the SPA has transitioned to the game view so the start-screen catch is bypassed
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});

	// NOW release the content-pack rejection. game.ts's loading-flow catch
	// (the recovery UI path) handles it.
	releaseContentPack();

	// Expect recovery UI to become visible — the view stays at "game"
	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.locator("main")).toHaveAttribute("data-view", "game");

	// Verify recovery UI title and buttons are present
	const titleEl = page.locator("#bootstrap-recovery-title");
	await expect(titleEl).toContainText("the room collapsed");
	await expect(page.locator("#bootstrap-recovery-regen")).toBeVisible();
	await expect(page.locator("#bootstrap-recovery-abandon")).toBeVisible();
});
