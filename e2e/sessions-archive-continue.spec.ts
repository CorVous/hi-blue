import { expect, type Page, test } from "@playwright/test";
import {
	ARCHIVE_PREFIX,
	activeSessionId,
	collectPageErrors,
	expectNoPageErrors,
	holdChatCompletions,
	isDualContentPackRequest,
	listSessionIds,
	parseRequestBody,
	reachEndgame,
	requireActiveSessionId,
	sessionFileKey,
} from "./helpers";

const SPINNING_UP = "spinning up a new room…";
const HELD_RESPONSE_SETTLE_MS = 1_000;

interface ArchivedAndPlaying {
	archivedId: string;
	playingId: string;
}

async function archiveOneGameAndStartAnother(
	page: Page,
): Promise<ArchivedAndPlaying> {
	await page.addInitScript(() => {
		localStorage.setItem("openrouter_key", "sk-or-test-key");
	});
	await reachEndgame(page);
	const archivedId = await requireActiveSessionId(page);
	await page.locator("#endgame-new-daemons-btn").click();
	await expect(page.locator('main[data-view="start"]')).toBeAttached({
		timeout: 15_000,
	});
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 15_000 });
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 15_000,
	});
	await expect(page.locator("#composer")).toBeVisible();
	expect(await listSessionIds(page, ARCHIVE_PREFIX)).toEqual([archivedId]);
	return { archivedId, playingId: await requireActiveSessionId(page) };
}

function archivedRow(page: Page, archivedId: string) {
	return page.locator(
		`#sessions-list .session-row[data-session-id="${archivedId}"]`,
	);
}

async function openPicker(page: Page): Promise<void> {
	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
}

async function closePickerWithEscape(page: Page): Promise<void> {
	await page.keyboard.press("Escape");
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
}

test("continue with new room runs once, survives the picker closing, and does not take over the game the player went back to", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);
	const { archivedId, playingId } = await archiveOneGameAndStartAnother(page);
	const generation = await holdChatCompletions(page, isDualContentPackRequest);

	await openPicker(page);
	const row = archivedRow(page, archivedId);
	const continueBtn = row.locator(".session-continue-btn");
	await continueBtn.click();
	await expect.poll(generation.requestCount).toBe(1);
	await expect(row.locator(".session-continue-status")).toHaveText(SPINNING_UP);

	await closePickerWithEscape(page);
	await openPicker(page);
	await expect(continueBtn).toBeDisabled();
	await expect(row.locator(".session-continue-status")).toHaveText(SPINNING_UP);
	await continueBtn.click({ force: true });
	await closePickerWithEscape(page);

	const newRoomServed = page.waitForResponse((response) =>
		response.url().endsWith("/v1/chat/completions"),
	);
	generation.release();
	await newRoomServed;
	await page.waitForTimeout(HELD_RESPONSE_SETTLE_MS);

	expect(generation.requestCount()).toBe(1);
	expect(await activeSessionId(page)).toBe(playingId);
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#composer")).toBeVisible();
	const sessionIds = await listSessionIds(page);
	expect(sessionIds).toHaveLength(2);
	expect(sessionIds).toContain(playingId);
	const seededId = sessionIds.find((id) => id !== playingId) ?? "";

	await openPicker(page);
	await expect(
		page.locator(`#sessions-list .session-row[data-session-id="${seededId}"]`),
	).toBeVisible();
	await expect(row.locator(".session-continue-status")).toContainText(
		"new room ready",
	);
	await expect(continueBtn).toBeEnabled();

	await expectNoPageErrors(page, pageErrors);
});

test("continue with new room says why on the row when the content pack is refused", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);
	const { archivedId, playingId } = await archiveOneGameAndStartAnother(page);
	let contentPackRequests = 0;
	await page.route("**/v1/chat/completions", async (route, request) => {
		if (!isDualContentPackRequest(parseRequestBody(request))) {
			await route.fallback();
			return;
		}
		contentPackRequests += 1;
		await route.fulfill({
			status: 402,
			contentType: "application/json",
			body: JSON.stringify({
				error: { message: "Insufficient credits", code: 402 },
			}),
		});
	});

	await openPicker(page);
	const row = archivedRow(page, archivedId);
	await row.locator(".session-continue-btn").click();

	const status = row.locator(".session-continue-status");
	await expect(status).toContainText("could not spin up a new room", {
		timeout: 15_000,
	});
	await expect(status).toContainText("Insufficient credits");
	await expect(row.locator(".session-continue-btn")).toBeEnabled();
	expect(contentPackRequests).toBe(1);
	expect(await activeSessionId(page)).toBe(playingId);
	expect(await listSessionIds(page)).toEqual([playingId]);
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();

	await expectNoPageErrors(page, pageErrors);
});

test("continue with new room takes the player in when a broken active session forced the sessions screen", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);
	const { archivedId, playingId } = await archiveOneGameAndStartAnother(page);
	await page.evaluate(
		(key) => localStorage.removeItem(key),
		sessionFileKey(playingId, "engine.dat"),
	);
	await page.goto("/?skipDialup=1");
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await expect(page.locator("main")).toHaveAttribute("data-reason", "broken");
	await expect(page.locator("#sessions-banner")).toContainText("unreadable");

	await archivedRow(page, archivedId).locator(".session-continue-btn").click();

	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 15_000,
	});
	await expect(page.locator("#composer")).toBeVisible();
	const enteredId = await requireActiveSessionId(page);
	expect(enteredId).not.toBe(playingId);
	expect(await listSessionIds(page)).toEqual(
		expect.arrayContaining([playingId, enteredId]),
	);
	expect(await listSessionIds(page, ARCHIVE_PREFIX)).toEqual([archivedId]);

	await expectNoPageErrors(page, pageErrors);
});
