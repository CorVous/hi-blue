import { expect, test } from "@playwright/test";
import { getAiHandles, stubChatCompletions } from "./helpers/index";

/**
 * The three distinct completions served to the three AIs.  Since the SPA
 * shuffles turn initiative each round, we assign completions by call order
 * (first /v1/chat/completions request → COMPLETIONS[0], etc.) and verify that
 * each completion appears in exactly one of the three transcripts.
 */
const COMPLETIONS = ["alpha beta gamma", "one two", "x y z"] as const;

test("addressed message lands only on first panel; all three panels render progressively", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// 1. Navigate with ?winImmediately=1 so the SPA injects a win condition
	//    into the active phase on boot.
	await page.goto("/?winImmediately=1");

	// 2. Stub /v1/chat/completions — the SPA calls this once per AI per round.
	//    Return a distinct completion on each successive call using a factory.
	let callIndex = 0;
	await stubChatCompletions(page, () => {
		const text = COMPLETIONS[callIndex % COMPLETIONS.length] ?? COMPLETIONS[0];
		callIndex++;
		return (text as string).split(" ").map((w) => `${w} `);
	});

	// 3. Read AI handles dynamically (set after synthesis completes).
	const { ids, names } = await getAiHandles(page);

	// 4. Fill prompt with first AI's mention to address ids[0].
	const message = `@${names[0]} hello first panel`;
	await page.fill("#prompt", message);

	// 5. Install an in-page sampler that collects (ids[0], ids[1]) transcript
	//    lengths every 30 ms.  We read the results back after streaming ends.
	await page.evaluate((aiIds: string[]) => {
		(window as unknown as Record<string, unknown>).__lenSamples = [];
		(window as unknown as Record<string, unknown>).__lenSampleId = setInterval(
			() => {
				const r =
					document.querySelector(`[data-transcript="${aiIds[0]}"]`)?.textContent
						?.length ?? 0;
				const g =
					document.querySelector(`[data-transcript="${aiIds[1]}"]`)?.textContent
						?.length ?? 0;
				(
					(window as unknown as Record<string, unknown>).__lenSamples as Array<{
						first: number;
						second: number;
					}>
				).push({ first: r, second: g });
			},
			30,
		);
	}, ids);

	// 6. Click send — triggers the SPA round flow.
	await page.click("#send");

	// 7. Wait for all three panels to show their completion text.
	//    Each AI gets a distinct completion; wait until the third one appears.
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
		{ completions: COMPLETIONS, aiIds: ids },
		{ timeout: 30_000 },
	);

	// 8. Stop sampler and retrieve snapshots.
	await page.evaluate(() => {
		clearInterval(
			(window as unknown as Record<string, unknown>)
				.__lenSampleId as ReturnType<typeof setInterval>,
		);
	});
	const samples = await page.evaluate(
		() =>
			(window as unknown as Record<string, unknown>).__lenSamples as Array<{
				first: number;
				second: number;
			}>,
	);

	// 9. Gather transcript content.
	const firstTranscript = await page
		.locator(`[data-transcript="${ids[0]}"]`)
		.textContent();
	const secondTranscript = await page
		.locator(`[data-transcript="${ids[1]}"]`)
		.textContent();
	const thirdTranscript = await page
		.locator(`[data-transcript="${ids[2]}"]`)
		.textContent();

	// 10. player message appears in first transcript exactly once.
	expect(firstTranscript ?? "").toContain(`> @${names[0]} hello first panel`);
	// Exactly once: splitting on "> @" gives exactly two parts.
	expect((firstTranscript ?? "").split("> @").length).toBe(2);

	// 11. second and third do NOT contain "> @" (no player line).
	expect(secondTranscript ?? "").not.toContain("> @");
	expect(thirdTranscript ?? "").not.toContain("> @");

	// 12. Each distinct completion appears in exactly one transcript.
	const transcripts = [
		firstTranscript ?? "",
		secondTranscript ?? "",
		thirdTranscript ?? "",
	];
	for (const completion of COMPLETIONS) {
		const count = transcripts.filter((t) => t.includes(completion)).length;
		expect(
			count,
			`Completion "${completion}" should appear in exactly 1 transcript`,
		).toBe(1);
	}

	// 13. Progressive rendering: at least one sample must have both first and
	//     second non-empty with different lengths.  This arises naturally once
	//     one panel finishes streaming and the next is mid-stream.
	const divergentSample = samples.find(
		(s) => s.first > 0 && s.second > 0 && s.first !== s.second,
	);
	expect(
		divergentSample,
		`Expected a sample where first and second panels both have non-zero but different ` +
			`lengths. Samples: ${JSON.stringify(samples.slice(0, 20))}`,
	).toBeDefined();

	// 14. No page errors.
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
