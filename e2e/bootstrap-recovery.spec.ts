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
