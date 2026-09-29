import { expect, test } from "@playwright/test";
import {
	expectNoPageErrors,
	goToGame,
	isJsonModeRequest,
	parseRequestBody,
} from "./helpers";

test("toggling the session picker mid-round keeps Send disabled and runs one round", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { names } = await goToGame(page, { sse: ["held", "reply"] });

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

	await page.fill("#prompt", `*${names[0]} first`);
	await page.click("#send");
	await expect(page.locator("#stage")).toHaveAttribute(
		"data-round-in-flight",
		"true",
	);
	await expect.poll(() => gameplayRequests).toBe(1);

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

	releaseFirstTurn();
	await expect(page.locator("#stage")).not.toHaveAttribute(
		"data-round-in-flight",
		/.*/,
		{ timeout: 15_000 },
	);
	expect(gameplayRequests).toBe(3);
	await expect(page.locator("#panels")).not.toContainText("> second");
	await expect(page.locator("#send")).toBeEnabled();

	await expectNoPageErrors(page, pageErrors);
});
