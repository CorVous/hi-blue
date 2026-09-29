import { expect, test } from "@playwright/test";
import {
	collectPageErrors,
	expectNoPageErrors,
	goToGame,
	holdChatCompletions,
	isGameplayRequest,
} from "./helpers";

test("toggling the session picker mid-round keeps Send disabled and runs one round", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { names } = await goToGame(page, { sse: ["held", "reply"] });

	const turns = await holdChatCompletions(page, isGameplayRequest, {
		holdFirst: 1,
	});

	await page.fill("#prompt", `*${names[0]} first`);
	await page.click("#send");
	await expect(page.locator("#stage")).toHaveAttribute(
		"data-round-in-flight",
		"true",
	);
	await expect.poll(turns.requestCount).toBe(1);

	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#composer")).toBeVisible();

	await page.fill("#prompt", `*${names[0]} second`);
	await expect(page.locator("#send")).toBeDisabled();
	await page.evaluate(() => {
		document.querySelector<HTMLFormElement>("#composer")?.requestSubmit();
	});
	await expect(page.locator("#prompt")).toHaveValue(`*${names[0]} second`);

	turns.release();
	await expect(page.locator("#stage")).not.toHaveAttribute(
		"data-round-in-flight",
		/.*/,
		{ timeout: 15_000 },
	);
	expect(turns.requestCount()).toBe(3);
	await expect(page.locator("#panels")).not.toContainText("> second");
	await expect(page.locator("#send")).toBeEnabled();

	await expectNoPageErrors(page, pageErrors);
});
