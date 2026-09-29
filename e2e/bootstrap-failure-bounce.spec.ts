import { expect, type Page, test } from "@playwright/test";
import {
	classifyJsonRequest,
	parseRequestBody,
	stubNewGameLLM,
} from "./helpers";

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

test("content-pack request refused with HTTP 402 → recovery UI names the upstream error after one request", async ({
	page,
}) => {
	let releaseContentPackFailure!: () => void;
	const contentPackFailureReleased = new Promise<void>((resolve) => {
		releaseContentPackFailure = resolve;
	});

	await stubNewGameLLM(page, { sse: ["stub reply"] });

	let contentPackRequests = 0;
	await page.route("**/v1/chat/completions", async (route, request) => {
		if (
			classifyJsonRequest(parseRequestBody(request)) !== "dual-content-pack"
		) {
			await route.fallback();
			return;
		}
		contentPackRequests += 1;
		await contentPackFailureReleased;
		await route.fulfill({
			status: 402,
			contentType: "application/json",
			body: JSON.stringify({
				error: { message: "Insufficient credits", code: 402 },
			}),
		});
	});

	await connectThenFailContentPackInsideGameView(
		page,
		releaseContentPackFailure,
	);

	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.locator("#bootstrap-recovery-body")).toContainText(
		"HTTP 402: Insufficient credits",
	);
	expect(contentPackRequests).toBe(1);
});
