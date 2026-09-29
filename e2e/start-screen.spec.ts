import {
	expect,
	type Page,
	type Request,
	type Route,
	test,
} from "@playwright/test";
import {
	ACTIVE_SESSION_KEY,
	activeSessionId,
	classifyJsonRequest,
	collectPageErrors,
	expectNoPageErrors,
	isJsonModeRequest,
	parseRequestBody,
	sessionFileKey,
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
		(activeKey) => localStorage.getItem(activeKey) !== null,
		ACTIVE_SESSION_KEY,
		{ timeout: timeoutMs },
	);
}

test("new visitor sees the start screen with panels and composer hidden", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

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
		const pageErrors = collectPageErrors(page);

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
	const pageErrors = collectPageErrors(page);

	await stubChatCompletions(page, ["stub reply"]);

	await page.goto("/?skipDialup=1");
	await expect(page.locator("#password")).toBeVisible();

	const passwordLigatures = await page
		.locator("#password")
		.evaluate((el) => getComputedStyle(el).fontVariantLigatures);
	expect(passwordLigatures).toBe("none");

	await expectNoPageErrors(page, pageErrors);
});

test("[ BEGIN ] logs in to the game view, and a refresh with the active session stays on it", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.goto("/?skipDialup=1");

	const beginBtn = await waitForStartScreenReady(page);
	await expect(beginBtn).toBeEnabled();
	await page.locator("#password").fill("password");
	await beginBtn.click();

	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});
	await expect(page.locator("#panels")).toBeVisible();
	await expect(page.locator("#composer")).toBeVisible();
	await expect(page.locator("#start-screen")).toBeHidden();

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
	const pageErrors = collectPageErrors(page);

	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		if (isJsonModeRequest(body) && classifyJsonRequest(body) === "synthesis") {
			await route.fulfill({
				status: 429,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					error: {
						message: "You have exceeded your daily spend limit.",
						type: "rate_limit_exceeded",
						code: "per-ip-daily",
					},
				}),
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

test("an upstream provider 429 during generation is retried, not shown as #cap-hit", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	await stubNewGameLLM(page, { sse: ["stub reply"] });

	let providerRateLimitsSent = 0;
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		const isSynthesis =
			isJsonModeRequest(body) && classifyJsonRequest(body) === "synthesis";
		if (isSynthesis && providerRateLimitsSent === 0) {
			providerRateLimitsSent += 1;
			await route.fulfill({
				status: 429,
				headers: { "Content-Type": "application/json", "Retry-After": "1" },
				body: JSON.stringify({
					error: { message: "Provider rate limited", code: 429 },
				}),
			});
			return;
		}

		await route.fallback();
	});

	await page.goto("/?skipDialup=1");

	const beginBtn = await waitForStartScreenReady(page);
	await expect(beginBtn).toBeEnabled();
	await expect(page.locator("#cap-hit")).toBeHidden();
	expect(providerRateLimitsSent).toBe(1);

	await expectNoPageErrors(page, pageErrors);
});

test("a non-cap generation failure shows a retryable error on the start screen, not #cap-hit", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	await stubNewGameLLM(page, { sse: ["stub reply"] });

	let rejectSynthesis = true;
	let synthesisRequests = 0;
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		const isSynthesis =
			isJsonModeRequest(body) && classifyJsonRequest(body) === "synthesis";
		if (isSynthesis) synthesisRequests += 1;
		if (isSynthesis && rejectSynthesis) {
			await route.fulfill({
				status: 401,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					error: { message: "No auth credentials found", code: 401 },
				}),
			});
			return;
		}
		await route.fallback();
	});

	await page.goto("/?skipDialup=1");

	const errorEl = page.locator("#start-bootstrap-error");
	await expect(errorEl).toBeVisible({ timeout: 10_000 });
	await expect(errorEl).toContainText("HTTP 401: No auth credentials found");
	await expect(page.locator("#cap-hit")).toBeHidden();
	await expect(page.locator("#start-screen")).toBeVisible();
	expect(synthesisRequests).toBe(1);

	rejectSynthesis = false;
	await page.locator("#start-bootstrap-retry").click();
	await expect(errorEl).toBeHidden();

	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await expect(page.locator("#composer")).toBeVisible({ timeout: 15_000 });
	await expect(page.locator("#prompt")).toBeEnabled({ timeout: 15_000 });
	expect(synthesisRequests).toBe(2);

	await expectNoPageErrors(page, pageErrors);
});

const RERENDER_SETTLE_MS = 500;

test("toggling the session picker after a generation failure sends no new request", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	let completionRequests = 0;
	await page.route("**/v1/chat/completions", async (route) => {
		completionRequests += 1;
		await route.fulfill({
			status: 401,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				error: { message: "No auth credentials found", code: 401 },
			}),
		});
	});

	await page.goto("/?skipDialup=1");

	const errorEl = page.locator("#start-bootstrap-error");
	await expect(errorEl).toBeVisible({ timeout: 10_000 });
	const requestsAfterFailure = completionRequests;
	expect(requestsAfterFailure).toBeGreaterThan(0);

	const toggleSessionPicker = () =>
		page.evaluate(() =>
			document.querySelector<HTMLButtonElement>("#sessions-icon")?.click(),
		);

	const recoveryEl = page.locator("#bootstrap-recovery");

	await toggleSessionPicker();
	await expect(page.locator("#sessions-screen")).toBeVisible();
	await toggleSessionPicker();
	await expect(recoveryEl).toBeVisible();
	await expect(recoveryEl).toContainText("HTTP 401: No auth credentials found");

	await toggleSessionPicker();
	await expect(page.locator("#sessions-screen")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(recoveryEl).toBeVisible();

	await page.waitForTimeout(RERENDER_SETTLE_MS);
	expect(completionRequests).toBe(requestsAfterFailure);

	await expectNoPageErrors(page, pageErrors);
});

test("refresh during generation re-enters start screen and restarts generation", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

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

	const sessionId = await activeSessionId(page);
	const engineDat =
		sessionId === null
			? null
			: await page.evaluate(
					(key) => localStorage.getItem(key),
					sessionFileKey(sessionId, "engine.dat"),
				);
	expect(engineDat).toBeNull();

	await waitForStartScreenReady(page);

	await expectNoPageErrors(page, pageErrors);
});

test("empty active-session pointer surfaces the start screen on load", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.addInitScript((activeKey) => {
		localStorage.setItem(activeKey, "test-empty-session-id");
	}, ACTIVE_SESSION_KEY);

	await page.goto("/");

	await expect(page.locator('main[data-view="start"]')).toBeAttached({
		timeout: 10_000,
	});
	await expect(page.locator("#start-screen")).toBeVisible();

	await expectNoPageErrors(page, pageErrors);
});
