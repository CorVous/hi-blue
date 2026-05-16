import { expect, test } from "@playwright/test";

/**
 * Acceptance spec: Bootstrap-time HTTP errors bounce to broken state.
 *
 * Covers:
 * 1. Content-pack request returns HTTP 500 → click CONNECT → bounce to #/start?reason=broken
 * 2. Content-pack request returns HTTP 200 with error body → click CONNECT → bounce to #/start?reason=broken
 */
test("content-pack request returns HTTP 500 → bounces to broken", async ({
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

	// Wait until the SPA has navigated to #/game so the start-screen catch is bypassed
	await page.waitForURL(/#\/game/, { timeout: 10_000 });

	// NOW release the content-pack rejection. game.ts's loading-flow catch
	// (the broken-bounce path) handles it.
	releaseContentPack();

	// Expect bounce to #/start?reason=broken
	await expect(page).toHaveURL(/#\/start\?reason=broken/, { timeout: 30_000 });
});

test("content-pack request returns HTTP 200 with error body → bounces to broken", async ({
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

	// Wait until the SPA has navigated to #/game so the start-screen catch is bypassed
	await page.waitForURL(/#\/game/, { timeout: 10_000 });

	// NOW release the content-pack rejection. game.ts's loading-flow catch
	// (the broken-bounce path) handles it.
	releaseContentPack();

	// Expect bounce to #/start?reason=broken
	await expect(page).toHaveURL(/#\/start\?reason=broken/, { timeout: 30_000 });
});
