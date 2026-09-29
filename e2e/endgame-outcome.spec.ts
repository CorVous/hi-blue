import { expect, test } from "@playwright/test";
import {
	classifyJsonRequest,
	collectPageErrors,
	expectNoPageErrors,
	goToGame,
	isJsonModeRequest,
	parseRequestBody,
	readActiveSessionEngine,
	type SealedEngine,
	writeActiveSessionEngine,
} from "./helpers";

const WIN_LINE = "You have completed the objectives.";
const BUDGET_EXHAUSTED_LINE = "You have hit your budget.";
const NEARLY_SPENT_USD = 0.001;
const FINAL_TURN_ONE = /TURN 0*1\b/;

type SealedEngineWithEnding = SealedEngine & {
	budgets: Record<string, { total: number; remaining: number }>;
	isComplete: boolean;
};

test("a win shows the win line, the final turn and the final round's lines, and survives a reload", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { names } = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["final ", "words"],
	});

	await page.fill("#prompt", `*${names[0]} hello`);
	await page.click("#send");

	await expect(page.locator("#endgame")).toBeVisible({ timeout: 30_000 });
	await expect(page.locator("#endgame-subtitle")).toHaveText(WIN_LINE);
	await expect(page.locator("#topinfo-left")).toHaveText(FINAL_TURN_ONE);
	await expect(page.locator("#endgame-final-round")).toBeVisible();
	await expect(
		page.locator("#endgame-final-lines .msg-line", { hasText: "final words" }),
	).toHaveCount(3);

	const { sealed } = await readActiveSessionEngine(page);
	expect((sealed as SealedEngineWithEnding).isComplete).toBe(true);

	await page.reload();

	await expect(page.locator("#endgame")).toBeVisible({ timeout: 15_000 });
	await expect(page.locator("#composer")).toBeHidden();
	await expect(page.locator("#endgame-subtitle")).toHaveText(WIN_LINE);
	await expect(page.locator("#topinfo-left")).toHaveText(FINAL_TURN_ONE);

	await expectNoPageErrors(page, pageErrors);
});

test("a budget-exhausted ending shows its own line", async ({ page }) => {
	const pageErrors = collectPageErrors(page);

	const { names } = await goToGame(page, { sse: ["last ", "gasp"] });

	await expect
		.poll(async () => {
			try {
				await readActiveSessionEngine(page);
				return true;
			} catch {
				return false;
			}
		})
		.toBe(true);
	const { sessionId, sealed } = await readActiveSessionEngine(page);
	const withBudgets = sealed as SealedEngineWithEnding;
	for (const budget of Object.values(withBudgets.budgets)) {
		budget.remaining = NEARLY_SPENT_USD;
	}
	await writeActiveSessionEngine(page, sessionId, withBudgets);

	await page.reload();
	await expect(page.locator("#composer")).toBeVisible({ timeout: 15_000 });

	await page.fill("#prompt", `*${names[0]} spend it`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	await expect(page.locator("#endgame")).toBeVisible({ timeout: 30_000 });
	await expect(page.locator("#endgame-subtitle")).toHaveText(
		BUDGET_EXHAUSTED_LINE,
	);
	await expect(page.locator("#topinfo-left")).toHaveText(FINAL_TURN_ONE);

	await page.reload();

	await expect(page.locator("#endgame")).toBeVisible({ timeout: 15_000 });
	await expect(page.locator("#endgame-subtitle")).toHaveText(
		BUDGET_EXHAUSTED_LINE,
	);
	await expect(page.locator("#topinfo-left")).toHaveText(FINAL_TURN_ONE);

	await expectNoPageErrors(page, pageErrors);
});

test("re-entering the endgame without a reload does not stack its button handlers", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { names } = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["bye"],
	});
	await page.fill("#prompt", `*${names[0]} hello`);
	await page.click("#send");
	await expect(page.locator("#endgame")).toBeVisible({ timeout: 30_000 });

	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await page.locator("#sessions-icon").click();
	await expect(page.locator("#endgame")).toBeVisible({ timeout: 15_000 });
	await expect(page.locator("#endgame-subtitle")).toHaveText(WIN_LINE);

	let downloads = 0;
	page.on("download", () => {
		downloads++;
	});
	await page.locator("#download-ais-btn").click();
	await expect(page.locator("#download-status")).toHaveText("Saved.");
	await expect.poll(() => downloads).toBe(1);

	let contentPackRequests = 0;
	page.on("request", (request) => {
		if (!request.url().includes("/v1/chat/completions")) return;
		const body = parseRequestBody(request);
		if (!isJsonModeRequest(body)) return;
		const kind = classifyJsonRequest(body);
		if (kind === "dual-content-pack") {
			contentPackRequests++;
		}
	});
	await page.locator("#endgame-same-daemons-btn").click();
	await expect(page.locator("#composer")).toBeVisible({ timeout: 15_000 });
	expect(contentPackRequests).toBe(1);
	expect(downloads).toBe(1);

	await expectNoPageErrors(page, pageErrors);
});
