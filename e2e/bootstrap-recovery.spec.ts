import { expect, test } from "@playwright/test";
import {
	classifyJsonRequest,
	stubNewGameLLM,
	stubPersonaSynthesis,
} from "./helpers/stubs.js";

/**
 * Acceptance spec for issue #380: Bootstrap recovery UI with regenerate and
 * abandon paths. The regen path re-kicks content-pack generation without
 * re-resolving personas; the abandon path bounces to #/start?reason=broken.
 */

test("regen happy path: content-pack fails, recover via regen button, game renders", async ({
	page,
}) => {
	// The initial bootstrap exhausts its OUTER_BUDGET (3 LLM calls) before the
	// recovery UI appears. The regen click starts a fresh budget; we let its
	// first call succeed via the schema-valid fall-through stub.
	const FAIL_FIRST_N_PACK_CALLS = 3;
	let contentPackCalls = 0;

	await stubNewGameLLM(page, { sse: ["stub", "reply"] });

	// Registered after the success stub so it runs first (Playwright LIFO).
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = JSON.parse(request.postData() ?? "null") as Parameters<
			typeof classifyJsonRequest
		>[0];
		if (classifyJsonRequest(body) === "dual-content-pack") {
			contentPackCalls++;
			if (contentPackCalls <= FAIL_FIRST_N_PACK_CALLS) {
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
	await page.waitForURL(/#\/game/, { timeout: 10_000 });

	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 30_000,
	});
	await expect(page).toHaveURL(/#\/game\/?$/);

	await page.locator("#bootstrap-recovery-regen").click();

	await expect(page.locator("#bootstrap-recovery")).toBeHidden({
		timeout: 5_000,
	});

	await expect(page.locator("#composer")).toBeVisible({ timeout: 30_000 });
	await expect(page.locator("article.ai-panel")).toHaveCount(3, {
		timeout: 30_000,
	});
	await expect(page).toHaveURL(/#\/game\/?$/);
});

test("abandon path: recovery UI visible, click abandon to bounce to #/start?reason=broken", async ({
	page,
}) => {
	await stubPersonaSynthesis(page);

	// Override: all dual-content-pack calls fail, so the OUTER_BUDGET is exhausted
	// and the recovery UI appears. Falls through to synthesis stub for other calls.
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
	await page.waitForURL(/#\/game/, { timeout: 10_000 });

	await expect(page.locator("#bootstrap-recovery")).toBeVisible({
		timeout: 30_000,
	});

	await page.locator("#bootstrap-recovery-abandon").click();

	await expect(page).toHaveURL(/#\/start\?reason=broken/, {
		timeout: 5_000,
	});
});
