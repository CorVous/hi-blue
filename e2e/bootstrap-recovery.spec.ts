import { expect, type Page, test } from "@playwright/test";
import {
	classifyJsonRequest,
	expectVisibleSkippingRetryBackoff,
	parseRequestBody,
	stubNewGameLLM,
} from "./helpers";

const CONTENT_PACK_OUTER_BUDGET_CALLS = 3;

async function loginFromStartScreen(page: Page): Promise<void> {
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 30_000 });
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});
}

async function openGameSkippingRetryBackoff(page: Page): Promise<void> {
	await page.clock.install();
	await page.goto("/?skipDialup=1");
	await loginFromStartScreen(page);
}

test("regen button: disabled while regenerating, enabled again after a retryable failure, and regenerates without re-resolving personas", async ({
	page,
}) => {
	const FAILED_REGEN_LAST_CALL = 2 * CONTENT_PACK_OUTER_BUDGET_CALLS;
	let contentPackCalls = 0;
	let synthesisCalls = 0;
	let signalRegenCallArrived: () => void = () => undefined;
	const regenCallArrived = new Promise<void>((resolve) => {
		signalRegenCallArrived = resolve;
	});
	let releaseFailedRegen: () => void = () => undefined;
	const failedRegenReleased = new Promise<void>((resolve) => {
		releaseFailedRegen = resolve;
	});

	await stubNewGameLLM(page, { sse: ["stub", "reply"] });

	await page.route("**/v1/chat/completions", async (route, request) => {
		const kind = classifyJsonRequest(parseRequestBody(request));
		if (kind === "synthesis") synthesisCalls++;
		if (kind !== "dual-content-pack") {
			await route.fallback();
			return;
		}
		contentPackCalls++;
		if (contentPackCalls <= CONTENT_PACK_OUTER_BUDGET_CALLS) {
			await route.abort("failed");
			return;
		}
		if (contentPackCalls <= FAILED_REGEN_LAST_CALL) {
			signalRegenCallArrived();
			await failedRegenReleased;
			await route.abort("failed");
			return;
		}
		await route.fallback();
	});

	await openGameSkippingRetryBackoff(page);

	const recovery = page.locator("#bootstrap-recovery");
	const regenBtn = page.locator("#bootstrap-recovery-regen");
	await expectVisibleSkippingRetryBackoff(page, recovery);
	await expect(page.locator("main")).toHaveAttribute("data-view", "game");
	await expect(regenBtn).toBeEnabled();

	await regenBtn.click();
	await regenCallArrived;
	await expect(recovery).toBeHidden();
	await expect(regenBtn).toBeDisabled();

	releaseFailedRegen();

	await expectVisibleSkippingRetryBackoff(page, recovery);
	await expect(regenBtn).toBeEnabled();

	await regenBtn.click();
	await expect(recovery).toBeHidden({ timeout: 5_000 });
	await expect(page.locator("article.ai-panel")).toHaveCount(3, {
		timeout: 30_000,
	});
	await expect(page.locator("#composer")).toBeVisible({ timeout: 30_000 });
	await expect(page.locator("main")).toHaveAttribute("data-view", "game");
	expect(contentPackCalls).toBe(FAILED_REGEN_LAST_CALL + 1);
	expect(synthesisCalls).toBe(1);
});

test("abandon returns to start with the broken reason, and its banner does not follow the player into the game", async ({
	page,
}) => {
	let failContentPacks = true;
	await stubNewGameLLM(page, { sse: ["stub", "reply"] });
	await page.route("**/v1/chat/completions", async (route, request) => {
		if (
			failContentPacks &&
			classifyJsonRequest(parseRequestBody(request)) === "dual-content-pack"
		) {
			await route.abort("failed");
			return;
		}
		await route.fallback();
	});

	await openGameSkippingRetryBackoff(page);
	await expectVisibleSkippingRetryBackoff(
		page,
		page.locator("#bootstrap-recovery"),
	);
	await page.locator("#bootstrap-recovery-abandon").click();

	const warning = page.locator("#persistence-warning");
	await expect(page.locator('main[data-view="start"]')).toBeAttached({
		timeout: 5_000,
	});
	await expect(page.locator("main")).toHaveAttribute("data-reason", "broken");
	await expect(warning).toBeVisible();

	failContentPacks = false;
	await loginFromStartScreen(page);
	await expect(page.locator("#composer")).toBeVisible({ timeout: 30_000 });
	await expect(warning).toBeHidden();
});
