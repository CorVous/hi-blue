import { expect, type Page, test } from "@playwright/test";
import {
	ARCHIVE_PREFIX,
	activeSessionId,
	COMPLICATION_COUNTDOWN_BEYOND_ANY_SPEC,
	collectPageErrors,
	expectNoPageErrors,
	goToGame,
	isJsonModeRequest,
	isRequestForDaemon,
	listSessionIds,
	type ParsedBody,
	parseRequestBody,
	reachEndgame,
	readActiveSessionEngine,
	readActiveSessionFiles,
	readDaemonFile,
	renderedPlayerLine,
	requireActiveSessionId,
	setComplicationCountdown,
} from "./helpers";

type FinalRound = "quiet" | "weather-change";

async function reachEndgameAfterFinalRound(
	page: Page,
	finalRound: FinalRound,
): Promise<{ names: string[]; ids: string[] }> {
	const handles = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["hello"],
	});
	await setComplicationCountdown(
		page,
		finalRound === "weather-change"
			? 1
			: COMPLICATION_COUNTDOWN_BEYOND_ANY_SPEC,
	);

	if (finalRound === "weather-change") {
		await page.evaluate(() => {
			const pinned = window as unknown as { e2eUnpinnedRandom?: () => number };
			pinned.e2eUnpinnedRandom = Math.random;
			Math.random = () => 0;
		});
	}
	await page.fill("#prompt", `*${handles.names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");
	await expect(page.locator("#endgame")).toBeVisible({ timeout: 15_000 });
	if (finalRound === "weather-change") {
		await page.evaluate(() => {
			const pinned = window as unknown as { e2eUnpinnedRandom?: () => number };
			if (pinned.e2eUnpinnedRandom) Math.random = pinned.e2eUnpinnedRandom;
		});
	}
	return handles;
}

test("game_ended disables the composer, shows endgame choices without Continue, and keeps the session pointer and URL", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { names } = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["hello"],
	});

	const urlBefore = page.url();

	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	await expect(page.locator("#send")).toBeDisabled({ timeout: 30_000 });
	await expect(page.locator("#prompt")).toBeDisabled();

	await expect(page.locator("#endgame")).toBeVisible();
	await expect(page.locator("#endgame-new-daemons-btn")).toBeVisible();
	await expect(page.locator("#endgame-same-daemons-btn")).toBeVisible();
	await expect(page.locator("#endgame-continue-btn")).toBeHidden();

	expect(
		await activeSessionId(page),
		"active-session pointer must be kept after game_ended",
	).not.toBeNull();
	expect(page.url(), "URL must not change after game_ended").toBe(urlBefore);

	await expectNoPageErrors(page, pageErrors);
});

async function expectPlayableGameAfterEndgame(page: Page) {
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
	const pageErrors = collectPageErrors(page);

	await reachEndgame(page);
	await page.locator("#endgame-same-daemons-btn").click();

	await expectPlayableGameAfterEndgame(page);

	await expectNoPageErrors(page, pageErrors);
});

test("Continue leaves the endgame screen and re-enables the prompt", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	await page.addInitScript(() => {
		localStorage.setItem("openrouter_key", "sk-or-test-key");
	});

	const { ids } = await reachEndgame(page);
	await expect(page.locator("#endgame-continue-btn")).toBeVisible();
	await expect(page.locator("#topinfo-left")).toContainText("EPOCH 01");
	const transcript = page.locator(`[data-transcript="${ids[0]}"]`);
	await expect(transcript).toContainText(renderedPlayerLine("hello"));
	const endedTranscript = (await transcript.textContent()) ?? "";
	await page.locator("#endgame-continue-btn").click();

	await expectPlayableGameAfterEndgame(page);

	await expect(page.locator("#topinfo-left")).toContainText("EPOCH 02");
	await expect(transcript).toHaveText(endedTranscript);

	const { daemons } = await readActiveSessionFiles(page);
	const storedDaemonLog = daemons[`${ids[0]}.txt`] ?? "";
	expect(storedDaemonLog).toContain("hello");
	expect(storedDaemonLog).toContain("The sysadmin has created a new room.");

	await expectNoPageErrors(page, pageErrors);
});

for (const finalRound of ["quiet", "weather-change"] as const) {
	test(`the first request after Continue ends with the new-room broadcast and the new player message (final round ${finalRound})`, async ({
		page,
	}) => {
		const pageErrors = collectPageErrors(page);

		await page.addInitScript(() => {
			localStorage.setItem("openrouter_key", "sk-or-test-key");
		});

		const { names, ids } = await reachEndgameAfterFinalRound(page, finalRound);
		const daemonName = names[0] ?? "";
		const { sessionId } = await readActiveSessionEngine(page);
		const endedLog = (await readDaemonFile(page, sessionId, ids[0] ?? ""))
			.conversationLog;
		const weatherChange = endedLog.filter((entry) =>
			entry.content?.includes("The weather has changed."),
		);
		expect(weatherChange).toEqual(
			finalRound === "weather-change"
				? [expect.objectContaining({ round: 1 })]
				: [],
		);
		await expect(page.locator("#topinfo-left")).toHaveText(/TURN 0*1\b/);
		await page.locator("#endgame-continue-btn").click();
		await expectPlayableGameAfterEndgame(page);
		await expect(page.locator("#topinfo-left")).toHaveText(/TURN 0*1\b/);

		const daemonRequests: ParsedBody[] = [];
		await page.route("**/v1/chat/completions", async (route, request) => {
			const body = parseRequestBody(request);
			if (!isJsonModeRequest(body) && isRequestForDaemon(body, daemonName)) {
				daemonRequests.push(body);
			}
			await route.fallback();
		});

		await page.fill("#prompt", `*${daemonName} new room hello`);
		await expect(page.locator("#send")).toBeEnabled();
		await page.click("#send");
		await expect.poll(() => daemonRequests.length).toBeGreaterThan(0);

		const contents = (daemonRequests[0]?.messages ?? []).map((m) =>
			typeof m.content === "string" ? m.content : "",
		);
		const currentState = contents[contents.length - 1] ?? "";
		const logTail = contents.slice(0, -1);
		expect(logTail[logTail.length - 1]).toContain("new room hello");
		expect(logTail[logTail.length - 2]).toContain(
			"The sysadmin has created a new room.",
		);
		const oldHello = logTail.findIndex((c) => c.includes("dms you: hello"));
		expect(oldHello).toBeGreaterThan(0);
		expect(oldHello).toBeLessThan(logTail.length - 2);
		const oldWeather = logTail.findIndex((c) =>
			c.includes("The weather has changed."),
		);
		if (finalRound === "weather-change") {
			expect(oldWeather).toBeGreaterThan(oldHello);
			expect(oldWeather).toBeLessThan(logTail.length - 2);
		} else {
			expect(oldWeather).toBe(-1);
		}
		expect(currentState).toContain(
			"[announcement] The sysadmin has created a new room.",
		);
		expect(currentState.match(/\[announcement\]/g)).toHaveLength(1);

		await expectNoPageErrors(page, pageErrors);
	});
}

test("New Daemons archives the session, mints a new one, and hides the endgame on the start screen and in the next game", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	await reachEndgame(page);
	const sessionBefore = await requireActiveSessionId(page);
	await page.locator("#endgame-new-daemons-btn").click();

	await expect(page.locator('main[data-view="start"]')).toBeAttached({
		timeout: 15_000,
	});
	await expect(page.locator("#endgame")).toBeHidden();
	const sessionAfter = await activeSessionId(page);
	expect(sessionAfter).not.toBeNull();
	expect(sessionAfter).not.toBe(sessionBefore);
	expect(await listSessionIds(page, ARCHIVE_PREFIX)).toEqual([sessionBefore]);

	await expect(page.locator("#begin")).toBeEnabled({ timeout: 15_000 });
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();

	await expectPlayableGameAfterEndgame(page);

	await expectNoPageErrors(page, pageErrors);
});
