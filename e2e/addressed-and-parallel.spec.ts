import { expect, test } from "@playwright/test";
import {
	expectNoPageErrors,
	goToGame,
	renderedPlayerLine,
} from "./helpers/index";

const COMPLETIONS_IN_CALL_ORDER = [
	"alpha beta gamma",
	"one two",
	"x y z",
] as const;

test("addressed message lands only on first panel; each call-order completion lands in exactly one panel", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	let callIndex = 0;
	const { ids, names } = await goToGame(page, {
		sse: () => {
			const text =
				COMPLETIONS_IN_CALL_ORDER[
					callIndex % COMPLETIONS_IN_CALL_ORDER.length
				] ?? COMPLETIONS_IN_CALL_ORDER[0];
			callIndex++;
			return (text as string).split(" ").map((w) => `${w} `);
		},
	});

	const messageAfterMention = "hello first panel";
	await page.fill("#prompt", `*${names[0]} ${messageAfterMention}`);
	await page.click("#send");

	await page.waitForFunction(
		({
			completions,
			aiIds,
		}: {
			completions: readonly string[];
			aiIds: string[];
		}) => {
			const texts = aiIds.map(
				(ai) =>
					document.querySelector(`[data-transcript="${ai}"]`)?.textContent ??
					"",
			);
			return completions.every((c) => texts.some((t) => t.includes(c)));
		},
		{ completions: COMPLETIONS_IN_CALL_ORDER, aiIds: ids },
		{ timeout: 30_000 },
	);

	const firstTranscript = await page
		.locator(`[data-transcript="${ids[0]}"]`)
		.textContent();
	const secondTranscript = await page
		.locator(`[data-transcript="${ids[1]}"]`)
		.textContent();
	const thirdTranscript = await page
		.locator(`[data-transcript="${ids[2]}"]`)
		.textContent();

	const playerLine = renderedPlayerLine(messageAfterMention);
	const playerLineOccurrences =
		(firstTranscript ?? "").split(playerLine).length - 1;
	expect(playerLineOccurrences).toBe(1);
	expect(secondTranscript ?? "").not.toContain(playerLine);
	expect(thirdTranscript ?? "").not.toContain(playerLine);

	const transcripts = [
		firstTranscript ?? "",
		secondTranscript ?? "",
		thirdTranscript ?? "",
	];
	for (const completion of COMPLETIONS_IN_CALL_ORDER) {
		const count = transcripts.filter((t) => t.includes(completion)).length;
		expect(
			count,
			`Completion "${completion}" should appear in exactly 1 transcript`,
		).toBe(1);
	}

	await expectNoPageErrors(page, pageErrors);
});
