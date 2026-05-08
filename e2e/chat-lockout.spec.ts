import { expect, test } from "@playwright/test";
import { getAiHandles, stubChatCompletions } from "./helpers";

test("chat lockout disables the first AI option and appends an in-character lockout line", async ({
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
	//    for ids[0] (first AI in Object.keys order, rng: () => 0) effective on
	//    the next round.
	await page.goto("/?lockout=1");

	// 3. Read AI handles dynamically (set after synthesis completes).
	const { ids, names } = await getAiHandles(page);

	// 4. Submit one message addressed to ids[0].
	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	// 5a. Wait for the chat_lockout to take effect: typing *<name[0]> should
	//     disable Send.
	await page.fill("#prompt", `*${names[0]} hi`);
	await expect(page.locator("#send")).toBeDisabled({ timeout: 30_000 });

	// 5b. First AI transcript ends with the in-character lockout line (appended by
	//     the chat_lockout event handler in game.ts: "[${event.message}]\n").
	const firstTranscript = page.locator(`[data-transcript="${ids[0]}"]`);
	await expect(firstTranscript).toContainText(/[\w]+ is unresponsive…/);

	// 5c. Second and third transcripts contain a normal AI response line.
	const secondTranscript = page.locator(`[data-transcript="${ids[1]}"]`);
	const thirdTranscript = page.locator(`[data-transcript="${ids[2]}"]`);
	await expect(secondTranscript).toContainText("greetings");
	await expect(thirdTranscript).toContainText("greetings");

	// 5d. No page errors.
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
