import { expect, type Page, test } from "@playwright/test";
import {
	collectPageErrors,
	expectNoPageErrors,
	getAiHandles,
	goToGame,
	readActiveSessionEngine,
	stubChatCompletions,
	writeActiveSessionEngine,
} from "./helpers";

const ROUND_BEYOND_THIS_TEST = 100;

async function injectChatLockoutIntoEngineDat(
	page: Page,
	targetId: string,
): Promise<void> {
	const { sessionId, sealed } = await readActiveSessionEngine(page);
	await writeActiveSessionEngine(page, sessionId, {
		...sealed,
		activeComplications: [
			...(sealed.activeComplications ?? []),
			{
				kind: "chat_lockout",
				target: targetId,
				resolveAtRound: ROUND_BEYOND_THIS_TEST,
			},
		],
	});
}

test("a lockout restored from storage mutes the panel before any typing, disables send for that AI, and is silent to the player", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { ids } = await goToGame(page, { sse: ["greetings"] });

	await injectChatLockoutIntoEngineDat(page, ids[0]);

	await page.reload();
	await stubChatCompletions(page, ["greetings"]);
	await expect(page.locator("#composer")).toBeVisible();

	const { names: reloadNames } = await getAiHandles(page);

	const lockedPanel = page.locator(`.ai-panel[data-ai="${ids[0]}"]`);
	await expect(lockedPanel).toHaveClass(/panel--locked/);
	await expect(lockedPanel).toHaveAttribute("aria-disabled", "true");

	await page.fill("#prompt", `*${reloadNames[0]} hi`);
	await expect(page.locator("#send")).toBeDisabled();

	const lockedTranscript = page.locator(`[data-transcript="${ids[0]}"]`);
	await expect(lockedTranscript).not.toContainText("unresponsive");

	await page.fill("#prompt", `*${reloadNames[1]} hi`);
	await expect(page.locator("#send")).toBeEnabled();

	await expectNoPageErrors(page, pageErrors);
});
