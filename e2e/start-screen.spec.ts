import {
	expect,
	type Page,
	type Request,
	type Route,
	test,
} from "@playwright/test";
import {
	classifyJsonRequest,
	expectNoPageErrors,
	isJsonModeRequest,
	parseRequestBody,
	stubChatCompletions,
	stubNewGameLLM,
	waitForStartScreenReady,
} from "./helpers";

function untilNavigationAbortsTheRequest(): Promise<never> {
	return new Promise<never>(() => {});
}

async function waitForActiveSession(
	page: Page,
	timeoutMs = 15_000,
): Promise<void> {
	await page.waitForFunction(
		() => localStorage.getItem("hi-blue:active-session") !== null,
		undefined,
		{ timeout: timeoutMs },
	);
}

test("new visitor sees the start screen with panels and composer hidden", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await stubChatCompletions(page, ["stub reply"]);

	await page.goto("/");

	await expect(page.locator("#start-screen")).toBeVisible();
	await expect(page.locator("#panels")).toBeHidden();
	await expect(page.locator("#composer")).toBeHidden();

	await expectNoPageErrors(page, pageErrors);
});

test.describe("mobile viewport", () => {
	test.use({ viewport: { width: 375, height: 667 } });

	test("start screen keeps panels and composer hidden on mobile", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await stubChatCompletions(page, ["stub reply"]);

		await page.goto("/");

		await expect(page.locator("#start-screen")).toBeVisible();
		await expect(page.locator("#panels")).toBeHidden();
		await expect(page.locator("#composer")).toBeHidden();

		await expectNoPageErrors(page, pageErrors);
	});
});

test("password input disables ligatures so masked `***` doesn't shift mid-char", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await stubChatCompletions(page, ["stub reply"]);

	await page.goto("/?skipDialup=1");
	await expect(page.locator("#password")).toBeVisible();

	const passwordLigatures = await page
		.locator("#password")
		.evaluate((el) => getComputedStyle(el).fontVariantLigatures);
	expect(passwordLigatures).toBe("none");

	await expectNoPageErrors(page, pageErrors);
});

test("[ BEGIN ] is enabled once the start screen has booted with the dial-up skipped", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.goto("/?skipDialup=1");

	const beginBtn = await waitForStartScreenReady(page);
	await expect(beginBtn).toBeEnabled();

	await expectNoPageErrors(page, pageErrors);
});

test("clicking [ BEGIN ] transitions to the game view and shows panels", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.goto("/?skipDialup=1");

	const beginBtn = await waitForStartScreenReady(page);

	await page.locator("#password").fill("password");
	await beginBtn.click();

	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});

	await expect(page.locator("#panels")).toBeVisible();
	await expect(page.locator("#composer")).toBeVisible();
	await expect(page.locator("#start-screen")).toBeHidden();

	await waitForActiveSession(page);

	await expectNoPageErrors(page, pageErrors);
});

test("refreshing on the game view with an active session stays on the game view", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.goto("/?skipDialup=1");

	const beginBtn = await waitForStartScreenReady(page);
	await page.locator("#password").fill("password");
	await beginBtn.click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});

	await waitForActiveSession(page);

	await stubChatCompletions(page, ["stub reply"]);
	await page.reload();

	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#panels")).toBeVisible();
	await expect(page.locator("#composer")).toBeVisible();
	await expect(page.locator("#start-screen")).toBeHidden();

	await expectNoPageErrors(page, pageErrors);
});

test("CapHit during generation surfaces #cap-hit", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		if (isJsonModeRequest(body) && classifyJsonRequest(body) === "synthesis") {
			await route.fulfill({
				status: 429,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ error: { message: "Rate limit exceeded" } }),
			});
			return;
		}

		await route.fallback();
	});

	await page.goto("/");

	await expect(page.locator("#cap-hit")).toBeVisible({ timeout: 10_000 });

	await expect(page.locator("#start-screen")).toBeHidden();

	const errorsOtherThanRethrownCapHit = pageErrors.filter(
		(e) => e.name !== "CapHitError",
	);
	expect(
		errorsOtherThanRethrownCapHit,
		errorsOtherThanRethrownCapHit.map((e) => e.message).join("\n"),
	).toEqual([]);
});

test("refresh during generation re-enters start screen and restarts generation", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const holdGenerationInFlightHandler = async (
		route: Route,
		request: Request,
	) => {
		if (isJsonModeRequest(parseRequestBody(request))) {
			await untilNavigationAbortsTheRequest();
			return;
		}
		await route.fallback();
	};

	await page.route("**/v1/chat/completions", holdGenerationInFlightHandler);

	await page.goto("/?skipDialup=1");

	await expect(page.locator("#start-screen")).toBeVisible();
	await waitForStartScreenReady(page);

	await page.unroute("**/v1/chat/completions", holdGenerationInFlightHandler);
	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.reload();

	await expect(page.locator("#start-screen")).toBeVisible();

	const engineDat = await page.evaluate(() => {
		const sessionId = localStorage.getItem("hi-blue:active-session");
		if (!sessionId) return null;
		return localStorage.getItem(`hi-blue:sessions/${sessionId}/engine.dat`);
	});
	expect(engineDat).toBeNull();

	await waitForStartScreenReady(page);

	await expectNoPageErrors(page, pageErrors);
});

test("empty active-session pointer surfaces the start screen on load", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.addInitScript(() => {
		const freshId = "test-empty-session-id";
		localStorage.setItem("hi-blue:active-session", freshId);
	});

	await page.goto("/");

	await expect(page.locator('main[data-view="start"]')).toBeAttached({
		timeout: 10_000,
	});
	await expect(page.locator("#start-screen")).toBeVisible();

	await expectNoPageErrors(page, pageErrors);
});
