import { expect, test } from "@playwright/test";
import {
	expectNoPageErrors,
	goToGame,
	isJsonModeRequest,
	parseRequestBody,
	SSE_HEADERS,
} from "./helpers";

function streamThatErrorsMidway(): string {
	const firstChunk = `data: ${JSON.stringify({
		choices: [{ delta: { content: "half a thou" } }],
	})}\n\n`;
	const errorChunk = `data: ${JSON.stringify({
		error: { code: 502, message: "Provider disconnected mid-stream" },
		choices: [{ delta: { content: "" }, finish_reason: "error" }],
	})}\n\n`;
	return `${firstChunk}${errorChunk}data: [DONE]\n\n`;
}

test("an error chunk inside a 200 stream fails the round with #round-error", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { names } = await goToGame(page);

	await page.route("**/v1/chat/completions", async (route, request) => {
		if (isJsonModeRequest(parseRequestBody(request))) {
			await route.fallback();
			return;
		}
		await route.fulfill({
			status: 200,
			headers: SSE_HEADERS,
			body: streamThatErrorsMidway(),
		});
	});

	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	const roundError = page.locator("#round-error");
	await expect(roundError).toBeVisible({ timeout: 15_000 });
	await expect(roundError).toContainText("Provider disconnected mid-stream");

	await expectNoPageErrors(page, pageErrors);
});
