import { expect, test } from "@playwright/test";
import {
	expectNoPageErrors,
	goToGame,
	readActiveSessionEngine,
	type SealedEngine,
	writeActiveSessionEngine,
} from "./helpers";

const WIN_LINE = "You have completed the objectives.";
const BUDGET_EXHAUSTED_LINE = "You have hit your budget.";
const NEARLY_SPENT_USD = 0.001;

type SealedEngineWithEnding = SealedEngine & {
	budgets: Record<string, { total: number; remaining: number }>;
	isComplete: boolean;
};

test("a win shows the win line, the final turn and the final round's lines, and survives a reload", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { names } = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["final ", "words"],
	});

	await page.fill("#prompt", `*${names[0]} hello`);
	await page.click("#send");

	await expect(page.locator("#endgame")).toBeVisible({ timeout: 30_000 });
	await expect(page.locator("#endgame-subtitle")).toHaveText(WIN_LINE);
	await expect(page.locator("#topinfo-left")).toContainText("TURN 1");
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
	await expect(page.locator("#topinfo-left")).toContainText("TURN 1");

	await expectNoPageErrors(page, pageErrors);
});

test("a budget-exhausted ending shows its own line", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

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
	await expect(page.locator("#topinfo-left")).toContainText("TURN 1");

	await expectNoPageErrors(page, pageErrors);
});
