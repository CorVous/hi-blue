import { expect, type Page, test } from "@playwright/test";

async function connectThenFailContentPackInsideGameView(
	page: Page,
	releaseContentPackFailure: () => void,
): Promise<void> {
	await page.goto("/?skipDialup=1");
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 30_000 });
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});
	releaseContentPackFailure();
}

test("content-pack request fails at the network level → shows recovery UI", async ({
	page,
}) => {
	let releaseContentPackFailure!: () => void;
	const contentPackFailureReleased = new Promise<void>((resolve) => {
		releaseContentPackFailure = resolve;
	});

	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = JSON.parse(request.postData() ?? "null") as {
			stream?: boolean;
			response_format?: unknown;
			messages?: Array<{ role?: string; content?: string }>;
		};

		const userMsg = body?.messages?.[1]?.content ?? "";

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

		if (userMsg.startsWith("Generate")) {
			await contentPackFailureReleased;
			await route.abort("failed");
			return;
		}

		await route.abort();
	});

	await connectThenFailContentPackInsideGameView(
		page,
		releaseContentPackFailure,
	);

	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.locator("main")).toHaveAttribute("data-view", "game");

	const titleEl = page.locator("#bootstrap-recovery-title");
	await expect(titleEl).toContainText("the room collapsed");
	await expect(page.locator("#bootstrap-recovery-regen")).toBeVisible();
	await expect(page.locator("#bootstrap-recovery-abandon")).toBeVisible();
});

test("content-pack request returns HTTP 200 with error body → shows recovery UI", async ({
	page,
}) => {
	let releaseContentPackFailure!: () => void;
	const contentPackFailureReleased = new Promise<void>((resolve) => {
		releaseContentPackFailure = resolve;
	});

	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = JSON.parse(request.postData() ?? "null") as {
			stream?: boolean;
			response_format?: unknown;
			messages?: Array<{ role?: string; content?: string }>;
		};

		const userMsg = body?.messages?.[1]?.content ?? "";

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

		if (userMsg.startsWith("Generate")) {
			await contentPackFailureReleased;
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

		await route.abort();
	});

	await connectThenFailContentPackInsideGameView(
		page,
		releaseContentPackFailure,
	);

	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.locator("main")).toHaveAttribute("data-view", "game");

	const titleEl = page.locator("#bootstrap-recovery-title");
	await expect(titleEl).toContainText("the room collapsed");
	await expect(page.locator("#bootstrap-recovery-regen")).toBeVisible();
	await expect(page.locator("#bootstrap-recovery-abandon")).toBeVisible();
});
