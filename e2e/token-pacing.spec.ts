import { expect, test } from "@playwright/test";
import { goToGame } from "./helpers";

// 20 words of stub content. The default `goToGame` SSE stub now emits a single
// `message` tool call addressed to "blue" carrying these joined words as its
// content (see `messageToolCallToBlueSseBody` in e2e/helpers/stubs.ts).
const WORDS = [
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

const EXPECTED_TOKENS = WORDS.join("");

/**
 * E2E — AI message arrives in the addressed panel after the round resolves.
 *
 * Post-#214 (DM-thread panels), AI content reaches panels via `message`
 * tool-call entries written into `conversationLogs`, replayed as `message`
 * encoder events after the round commits. Free-form `delta.content` is no
 * longer painted, so the pre-#214 word-by-word live-streaming guarantees do
 * not apply. The remaining smoke responsibilities here are:
 *
 * 1. The `thinking…` placeholder is cleared once the round resolves.
 * 2. The full AI content lands in the addressed panel's transcript.
 * 3. No page errors fire.
 */
test("AI message content lands in the addressed panel after the round", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { ids, names } = await goToGame(page, { sse: WORDS });

	await expect(
		page.locator(`article.ai-panel[data-ai="${ids[0]}"]`),
	).toBeVisible();

	await page.fill("#prompt", `*${names[0]} Hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	const firstTranscript = page.locator(`[data-transcript="${ids[0]}"]`);

	// thinking… is cleared once content arrives.
	await expect(firstTranscript).not.toHaveText(/thinking…/, {
		timeout: 15_000,
	});

	// Final transcript contains the full AI content.
	await expect(firstTranscript).toContainText(EXPECTED_TOKENS, {
		timeout: 20_000,
	});

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
