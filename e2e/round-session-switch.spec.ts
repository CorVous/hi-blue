import { expect, type Page, test } from "@playwright/test";
import {
	expectNoPageErrors,
	goToGame,
	isJsonModeRequest,
	parseRequestBody,
	pickerOkSessionFiles,
	waitForRound,
} from "./helpers";

const SESSION_B = "0xBBBB";
const ROUND_A_REPLY = "ROUNDAREPLY";

async function seedSessionB(page: Page): Promise<void> {
	await page.evaluate(
		({ id, files }) => {
			for (const [name, content] of Object.entries(files)) {
				localStorage.setItem(`hi-blue:sessions/${id}/${name}`, content);
			}
		},
		{ id: SESSION_B, files: pickerOkSessionFiles("2025-02-01T10:00:00.000Z") },
	);
}

async function holdFirstGameplayTurn(page: Page) {
	let gameplayRequests = 0;
	let releaseFirstTurn: () => void = () => undefined;
	const firstTurnReleased = new Promise<void>((resolve) => {
		releaseFirstTurn = resolve;
	});
	await page.route("**/v1/chat/completions", async (route, request) => {
		if (isJsonModeRequest(parseRequestBody(request))) {
			await route.fallback();
			return;
		}
		gameplayRequests++;
		if (gameplayRequests === 1) await firstTurnReleased;
		await route.fallback();
	});
	return {
		release: () => releaseFirstTurn(),
		requestCount: () => gameplayRequests,
	};
}

async function readMetaRound(page: Page, id: string): Promise<number | null> {
	return page.evaluate((sid) => {
		const raw = localStorage.getItem(`hi-blue:sessions/${sid}/meta.json`);
		return raw === null ? null : (JSON.parse(raw) as { round: number }).round;
	}, id);
}

test("a round still running when the player loads another session is saved to its own session", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { names } = await goToGame(page, { sse: [ROUND_A_REPLY] });
	const sessionA = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(sessionA).not.toBeNull();
	const turn = await holdFirstGameplayTurn(page);

	await page.fill("#prompt", `*${names[0]} hello`);
	await page.click("#send");
	await expect.poll(turn.requestCount).toBe(1);

	await seedSessionB(page);
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
	expect(
		await page.evaluate(() => localStorage.getItem("hi-blue:active-session")),
	).toBe(SESSION_B);
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
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { names } = await goToGame(page, { sse: [ROUND_A_REPLY] });
	const sessionA = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	const turn = await holdFirstGameplayTurn(page);

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
