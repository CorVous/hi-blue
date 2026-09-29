import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
	collectPageErrors,
	expectNoPageErrors,
	goToGame,
	isJsonModeRequest,
	parseRequestBody,
	renderedPlayerLine,
	stubNewGameLLM,
	waitForRound,
} from "./helpers";

function activeSessionId(page: Page): Promise<string> {
	return page.evaluate(() => {
		const id = localStorage.getItem("hi-blue:active-session");
		if (id === null) throw new Error("e2e: no active session");
		return id;
	});
}

function readStoredDaemonLogs(page: Page, sessionId: string): Promise<string> {
	return page.evaluate((id) => {
		const prefix = `hi-blue:sessions/${id}/`;
		const logs: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith(prefix) && key.endsWith(".txt")) {
				logs.push(localStorage.getItem(key) ?? "");
			}
		}
		return logs.join("\n");
	}, sessionId);
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

async function holdDaemonTurns(page: Page) {
	let held = 0;
	let release: () => void = () => undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/v1/chat/completions", async (route, request) => {
		if (!isJsonModeRequest(parseRequestBody(request))) {
			held++;
			await released;
		}
		await route.fallback();
	});
	return { release: () => release(), heldCount: () => held };
}

test("an idle tab reloads the session when another tab saves a round into it", async ({
	context,
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { ids, names } = await goToGame(page);
	const sessionId = await activeSessionId(page);
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
	const sessionId = await activeSessionId(page);
	const held = await holdDaemonTurns(page);
	await sendRound(page, `*${names[0]} lost from tab a`);
	await expect.poll(held.heldCount).toBeGreaterThan(0);

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
