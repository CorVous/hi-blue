import { expect, test } from "@playwright/test";
import {
	classifyJsonRequest,
	stubNewGameLLM,
	stubPersonaSynthesis,
} from "./helpers/stubs.js";

test("regen happy path: content-pack fails, recover via regen button, game renders", async ({
	page,
}) => {
	const INITIAL_BOOTSTRAP_OUTER_BUDGET_CALLS = 3;
	let contentPackCalls = 0;

	await stubNewGameLLM(page, { sse: ["stub", "reply"] });

	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = JSON.parse(request.postData() ?? "null") as Parameters<
			typeof classifyJsonRequest
		>[0];
		if (classifyJsonRequest(body) === "dual-content-pack") {
			contentPackCalls++;
			if (contentPackCalls <= INITIAL_BOOTSTRAP_OUTER_BUDGET_CALLS) {
				await route.abort("failed");
				return;
			}
		}
		await route.fallback();
	});

	await page.goto("/?skipDialup=1");
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 30_000 });
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});

	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.locator("main")).toHaveAttribute("data-view", "game");

	await page.locator("#bootstrap-recovery-regen").click();

	await expect(page.locator("#bootstrap-recovery")).toBeHidden({
		timeout: 5_000,
	});

	await expect(page.locator("#composer")).toBeVisible({ timeout: 30_000 });
	await expect(page.locator("article.ai-panel")).toHaveCount(3, {
		timeout: 30_000,
	});
	await expect(page.locator("main")).toHaveAttribute("data-view", "game");
});

test("regen button: disabled while regenerating, enabled again after a retryable failure", async ({
	page,
}) => {
	const CONTENT_PACK_OUTER_BUDGET_CALLS = 3;
	const FAILED_REGEN_LAST_CALL = 2 * CONTENT_PACK_OUTER_BUDGET_CALLS;
	let contentPackCalls = 0;
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
		const body = JSON.parse(request.postData() ?? "null") as Parameters<
			typeof classifyJsonRequest
		>[0];
		if (classifyJsonRequest(body) !== "dual-content-pack") {
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

	await page.goto("/?skipDialup=1");
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 30_000 });
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});

	const recovery = page.locator("#bootstrap-recovery");
	const regenBtn = page.locator("#bootstrap-recovery-regen");
	await expect(recovery).toBeVisible({ timeout: 30_000 });
	await expect(regenBtn).toBeEnabled();

	await regenBtn.click();
	await regenCallArrived;
	await expect(recovery).toBeHidden();
	await expect(regenBtn).toBeDisabled();

	releaseFailedRegen();

	await expect(recovery).toBeVisible({ timeout: 30_000 });
	await expect(regenBtn).toBeEnabled();

	await regenBtn.click();
	await expect(recovery).toBeHidden({ timeout: 5_000 });
	await expect(page.locator("article.ai-panel")).toHaveCount(3, {
		timeout: 30_000,
	});
	await expect(page.locator("#composer")).toBeVisible({ timeout: 30_000 });
});

test("abandon path: recovery UI visible, click abandon to return to start with broken reason", async ({
	page,
}) => {
	await stubPersonaSynthesis(page);

	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = JSON.parse(request.postData() ?? "null") as Parameters<
			typeof classifyJsonRequest
		>[0];
		if (classifyJsonRequest(body) === "dual-content-pack") {
			await route.abort("failed");
			return;
		}
		await route.fallback();
	});

	await page.goto("/?skipDialup=1");
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 30_000 });
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});

	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 30_000,
	});

	await page.locator("#bootstrap-recovery-abandon").click();

	await expect(page.locator('main[data-view="start"]')).toBeAttached({
		timeout: 5_000,
	});
	await expect(page.locator("main")).toHaveAttribute("data-reason", "broken");
});
