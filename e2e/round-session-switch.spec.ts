import { expect, type Page, test } from "@playwright/test";
import {
	activeSessionId,
	collectPageErrors,
	expectNoPageErrors,
	goToGame,
	holdChatCompletions,
	isGameplayRequest,
	seedOkSession,
	sessionFileKey,
	waitForRound,
} from "./helpers";

const SESSION_B = "0xBBBB";
const ROUND_A_REPLY = "ROUNDAREPLY";

async function readMetaRound(page: Page, id: string): Promise<number | null> {
	return page.evaluate(
		(metaKey) => {
			const raw = localStorage.getItem(metaKey);
			return raw === null ? null : (JSON.parse(raw) as { round: number }).round;
		},
		sessionFileKey(id, "meta.json"),
	);
}

test("a round still running when the player loads another session is saved to its own session", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { names } = await goToGame(page, { sse: [ROUND_A_REPLY] });
	const sessionA = await activeSessionId(page);
	expect(sessionA).not.toBeNull();
	const turn = await holdChatCompletions(page, isGameplayRequest, {
		holdFirst: 1,
	});

	await page.fill("#prompt", `*${names[0]} hello`);
	await page.click("#send");
	await expect.poll(turn.requestCount).toBe(1);

	await seedOkSession(page, SESSION_B);
	await page.locator("#sessions-icon").click();
	const rowB = page.locator(`.session-row[data-session-id="${SESSION_B}"]`);
	await rowB.locator(".ops button", { hasText: "[ load ]" }).click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#panels")).toContainText("Red");

	turn.release();
	await waitForRound(page, sessionA ?? "", 1);
	await expect(page.locator("#stage")).not.toHaveAttribute(
		"data-round-in-flight",
		/.*/,
		{ timeout: 15_000 },
	);

	await expect(page.locator("#panels")).not.toContainText(ROUND_A_REPLY);
	await expect(page.locator("#endgame")).toBeHidden();
	await expect(page.locator("#round-error")).toBeHidden();
	expect(await activeSessionId(page)).toBe(SESSION_B);
	expect(await readMetaRound(page, SESSION_B)).toBe(0);

	await page.locator("#sessions-icon").click();
	const rowA = page.locator(`.session-row[data-session-id="${sessionA}"]`);
	await rowA.locator(".ops button", { hasText: "[ load ]" }).click();
	await expect(page.locator("#panels")).toContainText(ROUND_A_REPLY);

	await expectNoPageErrors(page, pageErrors);
});

test("a round still running when the player removes its session is dropped", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { names } = await goToGame(page, { sse: [ROUND_A_REPLY] });
	const sessionA = await activeSessionId(page);
	const turn = await holdChatCompletions(page, isGameplayRequest, {
		holdFirst: 1,
	});

	await page.fill("#prompt", `*${names[0]} hello`);
	await page.click("#send");
	await expect.poll(turn.requestCount).toBe(1);

	await page.locator("#sessions-icon").click();
	const rowA = page.locator(`.session-row[data-session-id="${sessionA}"]`);
	await rowA.locator(".ops button", { hasText: "[ rm ]" }).click();
	await rowA.locator(".ops button", { hasText: "[ confirm rm ]" }).click();
	await expect(rowA).toHaveCount(0);

	turn.release();
	await expect(page.locator("#stage")).not.toHaveAttribute(
		"data-round-in-flight",
		/.*/,
		{ timeout: 15_000 },
	);
	await expect.poll(() => turn.requestCount()).toBe(3);
	expect(await readMetaRound(page, sessionA ?? "")).toBeNull();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await expect(page.locator("#persistence-warning")).toBeHidden();

	await expectNoPageErrors(page, pageErrors);
});
