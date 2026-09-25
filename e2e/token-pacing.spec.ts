import { expect, test } from "@playwright/test";
import { expectNoPageErrors, goToGame } from "./helpers";

const TWENTY_WORD_REPLY_CHUNKS = [
	"one ",
	"two ",
	"three ",
	"four ",
	"five ",
	"six ",
	"seven ",
	"eight ",
	"nine ",
	"ten ",
	"eleven ",
	"twelve ",
	"thirteen ",
	"fourteen ",
	"fifteen ",
	"sixteen ",
	"seventeen ",
	"eighteen ",
	"nineteen ",
	"twenty.",
];

const FULL_REPLY_TEXT = TWENTY_WORD_REPLY_CHUNKS.join("");

test("AI message content lands in the addressed panel after the round", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { ids, names } = await goToGame(page, {
		sse: TWENTY_WORD_REPLY_CHUNKS,
	});

	await expect(
		page.locator(`article.ai-panel[data-ai="${ids[0]}"]`),
	).toBeVisible();

	await page.fill("#prompt", `*${names[0]} Hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	const firstTranscript = page.locator(`[data-transcript="${ids[0]}"]`);

	await expect(firstTranscript).not.toHaveText(/thinking…/, {
		timeout: 15_000,
	});

	await expect(firstTranscript).toContainText(FULL_REPLY_TEXT, {
		timeout: 20_000,
	});

	await expectNoPageErrors(page, pageErrors);
});
