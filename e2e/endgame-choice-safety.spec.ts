import { expect, type Page, test } from "@playwright/test";
import {
	ARCHIVE_PREFIX,
	activeSessionId,
	collectPageErrors,
	expectNoPageErrors,
	holdChatCompletions,
	isDualContentPackRequest,
	listSessionIds,
	reachEndgame,
	requireActiveSessionId,
	seedOkSession,
	sessionFileKey,
} from "./helpers";

const SESSION_B = "0xBBBB";
const NEW_ROOM_SETTLE_MS = 1_000;

function readSessionBFiles(page: Page): Promise<string[]> {
	return page.evaluate(
		(keys) => keys.map((key) => localStorage.getItem(key) ?? ""),
		["meta.json", "red.txt", "engine.dat"].map((name) =>
			sessionFileKey(SESSION_B, name),
		),
	);
}

async function loadSessionBFromPicker(page: Page): Promise<void> {
	await page.locator("#sessions-icon").click();
	const rowB = page.locator(`.session-row[data-session-id="${SESSION_B}"]`);
	await rowB.locator(".ops button", { hasText: "[ load ]" }).click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#panels")).toContainText("Red");
}

for (const choice of [
	{ name: "Same daemons", button: "#endgame-same-daemons-btn" },
	{ name: "Continue", button: "#endgame-continue-btn" },
]) {
	test(`${choice.name} leaves a session the player loaded meanwhile untouched`, async ({
		page,
	}) => {
		const pageErrors = collectPageErrors(page);
		await page.addInitScript(() => {
			localStorage.setItem("openrouter_key", "sk-or-test-key");
		});

		await reachEndgame(page);
		const endedSessionId = await requireActiveSessionId(page);
		await seedOkSession(page, SESSION_B);
		const sessionBBefore = await readSessionBFiles(page);
		const generation = await holdChatCompletions(
			page,
			isDualContentPackRequest,
		);

		await page.locator(choice.button).click();
		await expect.poll(generation.requestCount).toBeGreaterThan(0);
		await loadSessionBFromPicker(page);

		const newRoomServed = page.waitForResponse((response) =>
			response.url().endsWith("/v1/chat/completions"),
		);
		generation.release();
		await newRoomServed;
		await page.waitForTimeout(NEW_ROOM_SETTLE_MS);

		expect(await activeSessionId(page)).toBe(SESSION_B);
		expect(await readSessionBFiles(page)).toEqual(sessionBBefore);
		expect(await listSessionIds(page)).toEqual(
			[endedSessionId, SESSION_B].sort(),
		);
		expect(await listSessionIds(page, ARCHIVE_PREFIX)).toEqual([]);
		await expect(page.locator('main[data-view="game"]')).toBeAttached();
		await expect(page.locator("#endgame")).toBeHidden();

		await expectNoPageErrors(page, pageErrors);
	});
}

for (const choice of [
	{ name: "New daemons", button: "#endgame-new-daemons-btn" },
	{ name: "Same daemons", button: "#endgame-same-daemons-btn" },
]) {
	test(`${choice.name} keeps the finished game and shows why when archiving fails`, async ({
		page,
	}) => {
		const pageErrors = collectPageErrors(page);

		await reachEndgame(page);
		const endedSessionId = await requireActiveSessionId(page);
		await page.evaluate(
			(metaKey) => {
				localStorage.setItem(metaKey, "{not json");
			},
			sessionFileKey(endedSessionId, "meta.json"),
		);

		await page.locator(choice.button).click();

		await expect(page.locator("#endgame-choice-status")).toContainText(
			"could not archive this game",
			{ timeout: 15_000 },
		);
		await expect(page.locator(choice.button)).toBeEnabled();
		await expect(page.locator("#endgame")).toBeVisible();
		expect(await activeSessionId(page)).toBe(endedSessionId);
		expect(await listSessionIds(page)).toEqual([endedSessionId]);

		await expectNoPageErrors(page, pageErrors);
	});
}

function markFinalSaveTorn(page: Page, sessionId: string): Promise<void> {
	return page.evaluate(
		(savingKey) => {
			localStorage.setItem(savingKey, "stuck");
		},
		sessionFileKey(sessionId, "saving"),
	);
}

test("New daemons moves on from a torn final save without archiving it", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	await reachEndgame(page);
	const endedSessionId = await requireActiveSessionId(page);
	await markFinalSaveTorn(page, endedSessionId);

	await page.locator("#endgame-new-daemons-btn").click();

	await expect(page.locator('main[data-view="start"]')).toBeAttached({
		timeout: 15_000,
	});
	await expect(page.locator("#endgame")).toBeHidden();
	expect(await listSessionIds(page, ARCHIVE_PREFIX)).toEqual([]);
	expect(await listSessionIds(page)).not.toContain(endedSessionId);

	await expectNoPageErrors(page, pageErrors);
});

test("Same daemons notes a torn final save before building the new room", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	await reachEndgame(page);
	const endedSessionId = await requireActiveSessionId(page);
	await markFinalSaveTorn(page, endedSessionId);
	const generation = await holdChatCompletions(page, isDualContentPackRequest);

	await page.locator("#endgame-same-daemons-btn").click();
	await expect.poll(generation.requestCount).toBeGreaterThan(0);
	await expect(page.locator("#endgame-choice-status")).toContainText(
		"last save was incomplete, so it was not archived",
	);

	generation.release();
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#endgame")).toBeHidden({ timeout: 15_000 });
	await expect(page.locator("#composer")).toBeVisible();
	expect(await listSessionIds(page, ARCHIVE_PREFIX)).toEqual([]);
	const sessionsAfter = await listSessionIds(page);
	expect(sessionsAfter).not.toContain(endedSessionId);
	expect(sessionsAfter).toHaveLength(1);
	expect(await activeSessionId(page)).toBe(sessionsAfter[0]);

	await expectNoPageErrors(page, pageErrors);
});
