import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
	collectPageErrors,
	expectNoPageErrors,
	goToGame,
	holdChatCompletions,
	isGameplayRequest,
	renderedPlayerLine,
	requireActiveSessionId,
	sessionDir,
	stubNewGameLLM,
	waitForRound,
} from "./helpers";

function readStoredDaemonLogs(page: Page, sessionId: string): Promise<string> {
	return page.evaluate((prefix) => {
		const logs: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith(prefix) && key.endsWith(".txt")) {
				logs.push(localStorage.getItem(key) ?? "");
			}
		}
		return logs.join("\n");
	}, sessionDir(sessionId));
}

async function openSecondTab(context: BrowserContext): Promise<Page> {
	const second = await context.newPage();
	await stubNewGameLLM(second, { sse: ["stub reply"] });
	await second.goto("/?skipDialup=1");
	await expect(second.locator('main[data-view="game"]')).toBeAttached();
	await expect(second.locator("#composer")).toBeVisible();
	return second;
}

async function sendRound(page: Page, text: string): Promise<void> {
	await page.fill("#prompt", text);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");
}

test("an idle tab reloads the session when another tab saves a round into it", async ({
	context,
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { ids, names } = await goToGame(page);
	const sessionId = await requireActiveSessionId(page);
	await sendRound(page, `*${names[0]} first from tab a`);
	await waitForRound(page, sessionId, 1);
	await expect(page.locator("#stage")).not.toHaveAttribute(
		"data-round-in-flight",
		"true",
	);

	const second = await openSecondTab(context);
	await sendRound(second, `*${names[1]} second from tab b`);
	await waitForRound(second, sessionId, 2);

	await expect(page.locator(`[data-transcript="${ids[1]}"]`)).toContainText(
		renderedPlayerLine("second from tab b"),
	);
	await expect(page.locator("#persistence-warning")).toBeHidden();

	await sendRound(page, `*${names[2]} third from tab a`);
	await waitForRound(page, sessionId, 3);
	const stored = await readStoredDaemonLogs(page, sessionId);
	expect(stored).toContain("first from tab a");
	expect(stored).toContain("second from tab b");
	expect(stored).toContain("third from tab a");
	await expect(page.locator("#persistence-warning")).toBeHidden();

	await expectNoPageErrors(page, pageErrors);
});

test("a round that finishes after another tab saved is refused, warned about, and reloaded", async ({
	context,
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { ids, names } = await goToGame(page);
	const sessionId = await requireActiveSessionId(page);
	const held = await holdChatCompletions(page, isGameplayRequest);
	await sendRound(page, `*${names[0]} lost from tab a`);
	await expect.poll(held.requestCount).toBeGreaterThan(0);

	const second = await openSecondTab(context);
	await sendRound(second, `*${names[1]} kept from tab b`);
	await waitForRound(second, sessionId, 1);

	held.release();
	const warning = page.locator("#persistence-warning");
	await expect(warning).toBeVisible({ timeout: 15_000 });
	await expect(warning).toContainText("changed in another tab");
	await expect(page.locator(`[data-transcript="${ids[1]}"]`)).toContainText(
		renderedPlayerLine("kept from tab b"),
	);
	await expect(page.locator(`[data-transcript="${ids[0]}"]`)).not.toContainText(
		"lost from tab a",
	);

	const stored = await readStoredDaemonLogs(page, sessionId);
	expect(stored).toContain("kept from tab b");
	expect(stored).not.toContain("lost from tab a");

	await expectNoPageErrors(page, pageErrors);
});

async function failNextDaemonFileWrite(page: Page): Promise<void> {
	await page.evaluate(() => {
		const originalSetItem = Storage.prototype.setItem;
		let armed = true;
		Storage.prototype.setItem = function setItemFailingOnce(
			key: string,
			value: string,
		) {
			if (
				armed &&
				key.startsWith("hi-blue:sessions/") &&
				key.endsWith(".txt")
			) {
				armed = false;
				throw new DOMException("quota", "QuotaExceededError");
			}
			originalSetItem.call(this, key, value);
		};
	});
}

async function waitForRoundSettled(page: Page): Promise<void> {
	await expect(page.locator("#stage")).not.toHaveAttribute(
		"data-round-in-flight",
		"true",
	);
}

test("a save that fails part-way does not make the next save in the same tab stale", async ({
	context,
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { ids, names } = await goToGame(page);
	const sessionId = await activeSessionId(page);
	const warning = page.locator("#persistence-warning");
	await sendRound(page, `*${names[0]} first from tab a`);
	await waitForRound(page, sessionId, 1);
	await waitForRoundSettled(page);

	await failNextDaemonFileWrite(page);
	await sendRound(page, `*${names[0]} torn from tab a`);
	await expect(warning).toContainText("browser storage is full");
	await waitForRoundSettled(page);

	await sendRound(page, `*${names[0]} recovered in tab a`);
	await waitForRound(page, sessionId, 3);
	await waitForRoundSettled(page);
	await expect(warning).not.toContainText("changed in another tab");
	await expect(page.locator(`[data-transcript="${ids[0]}"]`)).toContainText(
		renderedPlayerLine("recovered in tab a"),
	);
	const stored = await readStoredDaemonLogs(page, sessionId);
	expect(stored).toContain("torn from tab a");
	expect(stored).toContain("recovered in tab a");

	const second = await openSecondTab(context);
	await expect(second.locator(`[data-transcript="${ids[0]}"]`)).toContainText(
		renderedPlayerLine("recovered in tab a"),
	);
	await sendRound(second, `*${names[1]} from tab b after recovery`);
	await waitForRound(second, sessionId, 4);
	await expect(page.locator(`[data-transcript="${ids[1]}"]`)).toContainText(
		renderedPlayerLine("from tab b after recovery"),
	);

	await expectNoPageErrors(page, pageErrors);
});
