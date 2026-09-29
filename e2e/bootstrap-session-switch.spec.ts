import { expect, type Page, test } from "@playwright/test";
import {
	classifyJsonRequest,
	expectNoPageErrors,
	parseRequestBody,
	stubNewGameLLM,
} from "./helpers";

const HANDOVER_SETTLE_MS = 1_000;
const BOOTSTRAP_LOADING_TIMEOUT_MS = 300_000;

async function holdContentPacks(page: Page) {
	let requests = 0;
	let release: () => void = () => undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/v1/chat/completions", async (route, request) => {
		if (
			classifyJsonRequest(parseRequestBody(request)) === "dual-content-pack"
		) {
			requests++;
			await released;
		}
		await route.fallback();
	});
	return { release: () => release(), requestCount: () => requests };
}

async function connect(page: Page): Promise<void> {
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 15_000 });
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 15_000,
	});
}

function listSessionIds(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const prefix = "hi-blue:sessions/";
		const ids = new Set<string>();
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key?.startsWith(prefix)) continue;
			const id = key.slice(prefix.length).split("/")[0];
			if (id) ids.add(id);
		}
		return [...ids];
	});
}

test("a timed-out loading flow that succeeds after the player abandoned it does not take over the start screen", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await page.clock.install();
	await stubNewGameLLM(page, { sse: ["stub reply"] });
	const contentPacks = await holdContentPacks(page);
	await page.goto("/?skipDialup=1");
	await connect(page);
	await expect.poll(contentPacks.requestCount).toBeGreaterThan(0);

	await page.clock.fastForward(BOOTSTRAP_LOADING_TIMEOUT_MS + 1_000);
	await expect(page.locator("#bootstrap-recovery")).toBeVisible();
	await page.locator("#bootstrap-recovery-abandon").click();
	await expect(page.locator('main[data-view="start"]')).toBeAttached();

	const packsServed = page.waitForResponse((response) =>
		response.url().endsWith("/v1/chat/completions"),
	);
	contentPacks.release();
	await packsServed;
	await page.waitForTimeout(HANDOVER_SETTLE_MS);

	await expect(page.locator('main[data-view="start"]')).toBeAttached();
	await expect(page.locator("#start-screen")).toBeVisible();
	expect(await listSessionIds(page)).toEqual([]);

	await connect(page);
	await expect(page.locator("#composer")).toBeVisible({ timeout: 15_000 });
	await expect(page.locator("#prompt")).toBeEnabled();
	expect(await listSessionIds(page)).toHaveLength(1);

	await expectNoPageErrors(page, pageErrors);
});
