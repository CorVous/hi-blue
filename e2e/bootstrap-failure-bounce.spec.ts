import { expect, type Page, type Route, test } from "@playwright/test";
import {
	expectVisibleSkippingRetryBackoff,
	isDualContentPackRequest,
	parseRequestBody,
	stubNewGameLLM,
} from "./helpers";

async function connectThenFailContentPacksInsideGameView(
	page: Page,
	failContentPack: (route: Route) => Promise<void>,
): Promise<{ contentPackRequests: () => number }> {
	let releaseContentPackFailure!: () => void;
	const contentPackFailureReleased = new Promise<void>((resolve) => {
		releaseContentPackFailure = resolve;
	});
	let contentPackRequests = 0;

	await page.clock.install();
	await stubNewGameLLM(page, { sse: ["stub reply"] });
	await page.route("**/v1/chat/completions", async (route, request) => {
		if (!isDualContentPackRequest(parseRequestBody(request))) {
			await route.fallback();
			return;
		}
		contentPackRequests += 1;
		await contentPackFailureReleased;
		await failContentPack(route);
	});

	await page.goto("/?skipDialup=1");
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 30_000 });
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});
	releaseContentPackFailure();
	return { contentPackRequests: () => contentPackRequests };
}

async function expectRecoveryInsideGameView(page: Page): Promise<void> {
	await expectVisibleSkippingRetryBackoff(
		page,
		page.locator("#bootstrap-recovery"),
	);
	await expect(page.locator("main")).toHaveAttribute("data-view", "game");
	await expect(page.locator("#bootstrap-recovery-title")).toContainText(
		"the room collapsed",
	);
	await expect(page.locator("#bootstrap-recovery-regen")).toBeVisible();
	await expect(page.locator("#bootstrap-recovery-abandon")).toBeVisible();
}

test("content-pack request fails at the network level → shows recovery UI", async ({
	page,
}) => {
	await connectThenFailContentPacksInsideGameView(page, (route) =>
		route.abort("failed"),
	);

	await expectRecoveryInsideGameView(page);
});

test("content-pack request returns HTTP 200 with error body → shows recovery UI", async ({
	page,
}) => {
	await connectThenFailContentPacksInsideGameView(page, (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				error: {
					message: "upstream stalled",
					code: "service_error",
				},
			}),
		}),
	);

	await expectRecoveryInsideGameView(page);
});

test("content-pack request refused with HTTP 402 → recovery UI names the upstream error after one request", async ({
	page,
}) => {
	const { contentPackRequests } =
		await connectThenFailContentPacksInsideGameView(page, (route) =>
			route.fulfill({
				status: 402,
				contentType: "application/json",
				body: JSON.stringify({
					error: { message: "Insufficient credits", code: 402 },
				}),
			}),
		);

	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.locator("#bootstrap-recovery-body")).toContainText(
		"HTTP 402: Insufficient credits",
	);
	expect(contentPackRequests()).toBe(1);
});
