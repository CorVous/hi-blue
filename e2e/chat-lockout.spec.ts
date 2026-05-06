import { expect, test } from "@playwright/test";
import { stubChatCompletions } from "./helpers";

test("chat lockout disables the red AI option and appends an in-character lockout line", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// 1. Stub /v1/chat/completions so each AI returns a deterministic non-empty
	//    completion. The stub text is not asserted beyond "non-empty" but is
	//    required for the round to complete (the SPA won't emit transcript events
	//    if the fetch fails or returns empty).
	await stubChatCompletions(page, ["greetings"]);

	// 2. Navigate with ?lockout=1 so applyTestAffordances() arms a chat-lockout
	//    for red (2 rounds) effective on the next round.
	await page.goto("/?lockout=1");

	// 3. Submit one message.
	await page.fill("#prompt", "hello");
	await page.click("#send");

	// 4a. Wait for the red option to become disabled (chat_lockout event
	//     processed by the SPA's round-coordinator render loop).
	await expect(page.locator('#address option[value="red"]')).toBeDisabled({
		timeout: 30_000,
	});

	// 4b. Red transcript ends with the in-character lockout line (appended by
	//     the chat_lockout event handler in game.ts: "[${event.message}]\n").
	//     The exact persona name is "Ember" (from src/content/personas.ts).
	const redTranscript = page.locator('[data-transcript="red"]');
	await expect(redTranscript).toContainText(/[\w]+ is unresponsive…/);

	// 4c. Green and blue transcripts contain a normal AI response line.
	const greenTranscript = page.locator('[data-transcript="green"]');
	const blueTranscript = page.locator('[data-transcript="blue"]');
	await expect(greenTranscript).toContainText("greetings");
	await expect(blueTranscript).toContainText("greetings");

	// 4d. No page errors.
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
