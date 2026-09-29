import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
	ARCHIVE_PREFIX,
	activeSessionId,
	collectPageErrors,
	expectNoPageErrors,
	holdChatCompletions,
	isDualContentPackRequest,
	listSessionIds,
	reachEndgame,
	readStoredDaemonLogs,
	renderedPlayerLine,
	requireActiveSessionId,
	sessionFileKey,
	stubNewGameLLM,
} from "./helpers";

const CONTINUED_LINE = "played on after continue";
const CHANGED_ELSEWHERE = "changed in another tab";
const HELD_RESPONSE_SETTLE_MS = 1_000;

interface TwoTabs {
	tabA: Page;
	tabB: Page;
	sessionId: string;
	ids: string[];
	names: string[];
}

async function openEndgameInTwoTabs(
	context: BrowserContext,
	tabA: Page,
): Promise<TwoTabs> {
	await tabA.addInitScript(() => {
		localStorage.setItem("openrouter_key", "sk-or-test-key");
	});
	const { ids, names } = await reachEndgame(tabA);
	const sessionId = await requireActiveSessionId(tabA);
	await tabA.goto("/?skipDialup=1");
	await expect(tabA.locator("#endgame")).toBeVisible({ timeout: 15_000 });

	const tabB = await context.newPage();
	await tabB.addInitScript(() => {
		const muteFlag = "__muteStorageEvents";
		window.addEventListener(
			"storage",
			(event) => {
				if ((window as unknown as Record<string, unknown>)[muteFlag]) {
					event.stopImmediatePropagation();
				}
			},
			true,
		);
	});
	await stubNewGameLLM(tabB, { sse: ["stub reply"] });
	await tabB.goto("/?skipDialup=1");
	await expect(tabB.locator("#endgame")).toBeVisible({ timeout: 15_000 });
	return { tabA, tabB, sessionId, ids, names };
}

function muteStorageEvents(page: Page): Promise<void> {
	return page.evaluate(() => {
		(window as unknown as Record<string, unknown>).__muteStorageEvents = true;
	});
}

async function readStoredEpoch(page: Page, sessionId: string): Promise<number> {
	const raw = await page.evaluate(
		(key) => localStorage.getItem(key),
		sessionFileKey(sessionId, "meta.json"),
	);
	return (JSON.parse(raw ?? "{}") as { epoch?: number }).epoch ?? 0;
}

async function continueAndPlayRoundInTabA(tabs: TwoTabs): Promise<void> {
	const { tabA, sessionId, names } = tabs;
	await tabA.locator("#endgame-continue-btn").click();
	await expect(tabA.locator("#composer")).toBeVisible({ timeout: 15_000 });
	await expect(tabA.locator("#endgame")).toBeHidden();
	await tabA.fill("#prompt", `*${names[0]} ${CONTINUED_LINE}`);
	await expect(tabA.locator("#send")).toBeEnabled();
	await tabA.click("#send");
	await expect
		.poll(() => readStoredDaemonLogs(tabA, sessionId), { timeout: 15_000 })
		.toContain(CONTINUED_LINE);
	await expect(tabA.locator("#stage")).not.toHaveAttribute(
		"data-round-in-flight",
		"true",
	);
}

async function expectTabAsGameKept(tabs: TwoTabs): Promise<void> {
	const { tabA, sessionId } = tabs;
	expect(await activeSessionId(tabA)).toBe(sessionId);
	expect(await listSessionIds(tabA)).toEqual([sessionId]);
	expect(await listSessionIds(tabA, ARCHIVE_PREFIX)).toEqual([]);
	expect(await readStoredDaemonLogs(tabA, sessionId)).toContain(CONTINUED_LINE);
	expect(await readStoredEpoch(tabA, sessionId)).toBe(2);
}

async function expectTabBShowsTabAsGame(tabs: TwoTabs): Promise<void> {
	const { tabB, ids } = tabs;
	await expect(tabB.locator("#endgame")).toBeHidden({ timeout: 15_000 });
	await expect(tabB.locator("#composer")).toBeVisible();
	await expect(tabB.locator(`[data-transcript="${ids[0]}"]`)).toContainText(
		renderedPlayerLine(CONTINUED_LINE),
	);
}

test("an idle endgame tab re-renders when another tab continues the game", async ({
	context,
	page,
}) => {
	const pageErrors = collectPageErrors(page);
	const tabs = await openEndgameInTwoTabs(context, page);
	const tabBErrors = collectPageErrors(tabs.tabB);

	await continueAndPlayRoundInTabA(tabs);

	await expectTabBShowsTabAsGame(tabs);
	await expect(tabs.tabB.locator("#persistence-warning")).toBeHidden();
	await expectTabAsGameKept(tabs);

	await expectNoPageErrors(page, pageErrors);
	await expectNoPageErrors(tabs.tabB, tabBErrors);
});

for (const choice of [
	{ name: "New daemons", button: "#endgame-new-daemons-btn" },
	{ name: "Continue", button: "#endgame-continue-btn" },
]) {
	test(`${choice.name} from a stale endgame tab leaves the other tab's continued game alone`, async ({
		context,
		page,
	}) => {
		const pageErrors = collectPageErrors(page);
		const tabs = await openEndgameInTwoTabs(context, page);
		const tabBErrors = collectPageErrors(tabs.tabB);
		const generation = await holdChatCompletions(
			tabs.tabB,
			isDualContentPackRequest,
		);
		await muteStorageEvents(tabs.tabB);

		await continueAndPlayRoundInTabA(tabs);
		await expect(tabs.tabB.locator("#endgame")).toBeVisible();
		await tabs.tabB.locator(choice.button).click();

		await expect(tabs.tabB.locator("#persistence-warning")).toContainText(
			CHANGED_ELSEWHERE,
			{ timeout: 15_000 },
		);
		await expectTabBShowsTabAsGame(tabs);
		await expectTabAsGameKept(tabs);
		expect(generation.requestCount()).toBe(0);
		generation.release();

		await expectNoPageErrors(page, pageErrors);
		await expectNoPageErrors(tabs.tabB, tabBErrors);
	});
}

for (const choice of [
	{ name: "Same daemons", button: "#endgame-same-daemons-btn" },
	{ name: "Continue", button: "#endgame-continue-btn" },
]) {
	test(`${choice.name} started before another tab continued is refused when its room arrives`, async ({
		context,
		page,
	}) => {
		const pageErrors = collectPageErrors(page);
		const tabs = await openEndgameInTwoTabs(context, page);
		const tabBErrors = collectPageErrors(tabs.tabB);
		const generation = await holdChatCompletions(
			tabs.tabB,
			isDualContentPackRequest,
		);

		await tabs.tabB.locator(choice.button).click();
		await expect.poll(generation.requestCount).toBeGreaterThan(0);

		await continueAndPlayRoundInTabA(tabs);

		const newRoomServed = tabs.tabB.waitForResponse((response) =>
			response.url().endsWith("/v1/chat/completions"),
		);
		generation.release();
		await newRoomServed;
		await tabs.tabB.waitForTimeout(HELD_RESPONSE_SETTLE_MS);

		await expect(tabs.tabB.locator("#persistence-warning")).toContainText(
			CHANGED_ELSEWHERE,
			{ timeout: 15_000 },
		);
		await expectTabBShowsTabAsGame(tabs);
		await expectTabAsGameKept(tabs);

		await expectNoPageErrors(page, pageErrors);
		await expectNoPageErrors(tabs.tabB, tabBErrors);
	});
}
