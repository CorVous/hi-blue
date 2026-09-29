import { expect, type Page, test } from "@playwright/test";
import {
	classifyJsonRequest,
	expectNoPageErrors,
	goToGame,
	parseRequestBody,
} from "./helpers";

async function reachEndgame(page: Page): Promise<void> {
	const { names } = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["hello"],
	});
	await page.fill("#prompt", `*${names[0]} hello`);
	await page.click("#send");
	await expect(page.locator("#endgame")).toBeVisible({ timeout: 15_000 });
}

async function togglePickerOpenAndClosed(page: Page): Promise<void> {
	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#endgame")).toBeVisible();
}

async function holdNewRoomGeneration(page: Page) {
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

test("toggling the picker during a Same daemons generation keeps the choices locked and the status shown", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await reachEndgame(page);
	const generation = await holdNewRoomGeneration(page);

	await page.locator("#endgame-same-daemons-btn").click();
	await expect.poll(generation.requestCount).toBeGreaterThan(0);
	await expect(page.locator("#endgame-choice-status")).toContainText(
		"spinning up a new room",
	);

	await togglePickerOpenAndClosed(page);

	await expect(page.locator("#endgame-same-daemons-btn")).toBeDisabled();
	await expect(page.locator("#endgame-new-daemons-btn")).toBeDisabled();
	await expect(page.locator("#endgame-choice-status")).toContainText(
		"spinning up a new room",
	);
	expect(generation.requestCount()).toBe(1);

	generation.release();
	await expect(page.locator("#endgame")).toBeHidden({ timeout: 15_000 });
	await expect(page.locator("#composer")).toBeVisible();
	expect(generation.requestCount()).toBe(1);

	await expectNoPageErrors(page, pageErrors);
});

test("a triple-clicked diagnostics submit sends one request", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await reachEndgame(page);
	let posts = 0;
	await page.route("**/diagnostics", async (route) => {
		posts++;
		await route.fulfill({ status: 204, body: "" });
	});

	await page.locator("#diagnostics-summary").fill("great");
	await page.locator("#submit-diagnostics-btn").click({ clickCount: 3 });

	await expect(page.locator("#diagnostics-status")).toHaveText(
		"Diagnostics submitted.",
	);
	await expect(page.locator("#submit-diagnostics-btn")).toBeDisabled();
	await expect(page.locator("#diagnostics-summary")).toBeDisabled();
	expect(posts).toBe(1);

	await expectNoPageErrors(page, pageErrors);
});

test("Continue hides again once the stored OpenRouter key is cleared", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await reachEndgame(page);
	await page.evaluate(() => {
		localStorage.setItem("openrouter_key", "sk-or-test-key");
	});
	await togglePickerOpenAndClosed(page);
	await expect(page.locator("#endgame-continue-btn")).toBeVisible();

	await page.locator("#byok-cog").click();
	await page.locator("#byok-clear").click();
	await expect(page.locator("#byok-dialog")).not.toBeVisible();
	await togglePickerOpenAndClosed(page);
	await expect(page.locator("#endgame-continue-btn")).toBeHidden();

	await expectNoPageErrors(page, pageErrors);
});
