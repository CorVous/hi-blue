import { expect, test } from "@playwright/test";
import { expectNoPageErrors, goToGame, renderedPlayerLine } from "./helpers";

async function reachEndgame(page: Parameters<typeof goToGame>[0]) {
	const { names, ids } = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["hello"],
	});
	await expect(page.locator("#composer")).toBeVisible();
	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");
	await expect(page.locator("#endgame")).toBeVisible({ timeout: 15_000 });
	return { ids };
}

test("endgame shows choice buttons; Continue hidden without openrouter_key", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await reachEndgame(page);

	await expect(page.locator("#endgame-new-daemons-btn")).toBeVisible();
	await expect(page.locator("#endgame-same-daemons-btn")).toBeVisible();

	const continueBtn = page.locator("#endgame-continue-btn");
	await expect(continueBtn).toBeHidden();

	await expectNoPageErrors(page, pageErrors);
});

test("Continue button visible when openrouter_key is set in localStorage", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await page.addInitScript(() => {
		localStorage.setItem("openrouter_key", "sk-or-test-key");
	});

	await reachEndgame(page);

	await expect(page.locator("#endgame-continue-btn")).toBeVisible();

	await expectNoPageErrors(page, pageErrors);
});

test("New Daemons click archives session and transitions to start view", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await reachEndgame(page);

	const sessionBefore = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(sessionBefore).not.toBeNull();

	await page.locator("#endgame-new-daemons-btn").click();

	await expect(page.locator('main[data-view="start"]')).toBeAttached({
		timeout: 15_000,
	});

	const sessionAfter = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(sessionAfter).not.toBeNull();
	expect(sessionAfter).not.toBe(sessionBefore);

	await expectNoPageErrors(page, pageErrors);
});

async function expectPlayableGameAfterEndgame(
	page: Parameters<typeof goToGame>[0],
) {
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 15_000,
	});
	await expect(page.locator("#composer")).toBeVisible({ timeout: 15_000 });
	await expect(page.locator("#endgame")).toBeHidden();
	await expect(page.locator("#prompt")).toBeEnabled();
}

test("Same Daemons leaves the endgame screen and re-enables the prompt", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await reachEndgame(page);
	await page.locator("#endgame-same-daemons-btn").click();

	await expectPlayableGameAfterEndgame(page);

	await expectNoPageErrors(page, pageErrors);
});

test("Continue leaves the endgame screen and re-enables the prompt", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await page.addInitScript(() => {
		localStorage.setItem("openrouter_key", "sk-or-test-key");
	});

	const { ids } = await reachEndgame(page);
	await expect(page.locator("#topinfo-left")).toContainText("EPOCH 01");
	const transcript = page.locator(`[data-transcript="${ids[0]}"]`);
	await expect(transcript).toContainText(renderedPlayerLine("hello"));
	const endedTranscript = (await transcript.textContent()) ?? "";
	await page.locator("#endgame-continue-btn").click();

	await expectPlayableGameAfterEndgame(page);

	await expect(page.locator("#topinfo-left")).toContainText("EPOCH 02");
	await expect(transcript).toHaveText(endedTranscript);

	const storedDaemonLog = await page.evaluate((aiId) => {
		const sid = localStorage.getItem("hi-blue:active-session");
		return localStorage.getItem(`hi-blue:sessions/${sid}/${aiId}.txt`) ?? "";
	}, ids[0]);
	expect(storedDaemonLog).toContain("hello");
	expect(storedDaemonLog).toContain("The sysadmin has created a new room.");

	await expectNoPageErrors(page, pageErrors);
});

test("New Daemons hides the endgame on the start screen and in the next game", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await reachEndgame(page);
	await page.locator("#endgame-new-daemons-btn").click();

	await expect(page.locator('main[data-view="start"]')).toBeAttached({
		timeout: 15_000,
	});
	await expect(page.locator("#endgame")).toBeHidden();

	await expect(page.locator("#begin")).toBeEnabled({ timeout: 15_000 });
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();

	await expectPlayableGameAfterEndgame(page);

	await expectNoPageErrors(page, pageErrors);
});
