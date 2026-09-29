import { expect, type Page, test } from "@playwright/test";
import {
	collectPageErrors,
	expectNoPageErrors,
	goToGame,
	readActiveSessionEngine,
	requireActiveSessionId,
	type SealedEngine,
	waitForRound,
	writeActiveSessionEngine,
} from "./helpers";

const NEARLY_SPENT_USD = 0.001;

type SealedEngineWithBudgets = SealedEngine & {
	budgets: Record<string, { total: number; remaining: number }>;
};

async function waitForSealedEngine(page: Page): Promise<void> {
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
}

async function playRound(
	page: Page,
	sessionId: string,
	text: string,
	round: number,
): Promise<void> {
	await page.fill("#prompt", text);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");
	await waitForRound(page, sessionId, round);
	await expect(page.locator("#stage")).not.toHaveAttribute(
		"data-round-in-flight",
		"true",
	);
}

function transcriptLines(
	page: Page,
	ids: readonly string[],
): Promise<string[][]> {
	return Promise.all(
		ids.map((id) =>
			page.locator(`[data-transcript="${id}"] .msg-line`).allInnerTexts(),
		),
	);
}

test("an exhausted Daemon's panel reads the same live as after a reload", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);
	const { ids, names } = await goToGame(page, { sse: ["still here"] });
	const exhaustedId = ids[0] ?? "";
	await waitForSealedEngine(page);

	const { sessionId, sealed } = await readActiveSessionEngine(page);
	const withBudgets = sealed as SealedEngineWithBudgets;
	const exhaustedBudget = withBudgets.budgets[exhaustedId];
	if (!exhaustedBudget) throw new Error("e2e: no budget for the first Daemon");
	exhaustedBudget.remaining = NEARLY_SPENT_USD;
	await writeActiveSessionEngine(page, sessionId, withBudgets);
	await page.reload();
	await expect(page.locator("#composer")).toBeVisible({ timeout: 15_000 });
	expect(await requireActiveSessionId(page)).toBe(sessionId);

	await playRound(page, sessionId, `*${names[1]} spend the last of it`, 1);
	await playRound(page, sessionId, `*${names[1]} anyone there`, 2);

	const exhaustedPanel = page.locator(`[data-transcript="${exhaustedId}"]`);
	await expect(
		exhaustedPanel.locator(".msg-line", { hasText: "is unresponsive" }),
	).toHaveCount(1);
	const live = await transcriptLines(page, ids);

	await page.reload();
	await expect(page.locator("#composer")).toBeVisible({ timeout: 15_000 });
	await expect(
		exhaustedPanel.locator(".msg-line", { hasText: "is unresponsive" }),
	).toHaveCount(1);

	expect(await transcriptLines(page, ids)).toEqual(live);

	await expectNoPageErrors(page, pageErrors);
});
