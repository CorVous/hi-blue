import { expect, type Page, test } from "@playwright/test";
import {
	collectPageErrors,
	expectNoPageErrors,
	goToGame,
	isJsonModeRequest,
	parseRequestBody,
	SSE_HEADERS,
} from "./helpers";

const ERROR_CHUNK = `data: ${JSON.stringify({
	error: { code: 502, message: "Provider disconnected mid-stream" },
	choices: [{ delta: { content: "" }, finish_reason: "error" }],
})}\n\n`;

function streamThatErrorsBeforeAnyOutput(): string {
	const reasoningChunk = `data: ${JSON.stringify({
		choices: [{ delta: { reasoning: "thinking about it" } }],
	})}\n\n`;
	return `${reasoningChunk}${ERROR_CHUNK}data: [DONE]\n\n`;
}

function streamThatErrorsAfterAMessage(content: string): string {
	const toolCallChunk = `data: ${JSON.stringify({
		choices: [
			{
				delta: {
					tool_calls: [
						{
							index: 0,
							id: "call_before_error",
							function: {
								name: "message",
								arguments: JSON.stringify({ to: "blue", content }),
							},
						},
					],
				},
			},
		],
	})}\n\n`;
	return `${toolCallChunk}${ERROR_CHUNK}data: [DONE]\n\n`;
}

async function routeDaemonStreams(page: Page, body: () => string) {
	await page.route("**/v1/chat/completions", async (route, request) => {
		if (isJsonModeRequest(parseRequestBody(request))) {
			await route.fallback();
			return;
		}
		await route.fulfill({ status: 200, headers: SSE_HEADERS, body: body() });
	});
}

test("an error chunk before any content or tool call fails the round with #round-error", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { names } = await goToGame(page);
	await routeDaemonStreams(page, streamThatErrorsBeforeAnyOutput);

	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	const roundError = page.locator("#round-error");
	await expect(roundError).toBeVisible({ timeout: 15_000 });
	await expect(roundError).toContainText("Provider disconnected mid-stream");

	await expectNoPageErrors(page, pageErrors);
});

test("an error chunk after a message tool call keeps the message and completes the round", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const { ids, names } = await goToGame(page);
	await routeDaemonStreams(page, () =>
		streamThatErrorsAfterAMessage("kept before the error"),
	);

	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	for (const id of ids) {
		await expect(page.locator(`[data-transcript="${id}"]`)).toContainText(
			"kept before the error",
			{ timeout: 15_000 },
		);
	}
	await expect(page.locator("#round-error")).toBeHidden();

	await expectNoPageErrors(page, pageErrors);
});
