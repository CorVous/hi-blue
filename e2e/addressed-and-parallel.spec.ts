import { expect, test } from "@playwright/test";
import { newWinImmediatelyGame } from "./helpers/index";

/**
 * The three distinct completions served to the three AIs.  Since the SPA
 * shuffles turn initiative each round, we assign completions by call order
 * (first /v1/chat/completions request → COMPLETIONS[0], etc.) and verify that
 * each completion appears in exactly one of the three transcripts.
 */
const COMPLETIONS = ["alpha beta gamma", "one two", "x y z"] as const;

/**
 * Build an OpenAI-streaming SSE body for a single completion string.
 * Each word is emitted as a separate delta chunk, ending with [DONE].
 */
function openAiSseBody(text: string): string {
	const words = text.split(" ");
	const lines: string[] = [];
	for (const word of words) {
		const chunk = JSON.stringify({
			choices: [{ delta: { content: `${word} ` }, finish_reason: null }],
		});
		lines.push(`data: ${chunk}\n\n`);
	}
	// Trim trailing space from last token via a final empty-content chunk then DONE
	lines.push(
		`data: ${JSON.stringify({ choices: [{ delta: { content: "" }, finish_reason: "stop" }] })}\n\n`,
	);
	lines.push("data: [DONE]\n\n");
	return lines.join("");
}

type LenPair = { red: number; green: number };

test("addressed message lands only on red panel; all three panels render progressively", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// 1. Navigate and set up a real game session via the worker.
	await page.goto("/");
	await newWinImmediatelyGame(page);

	// 2. Stub /v1/chat/completions — the SPA calls this once per AI per round.
	//    Return a distinct completion on each successive call.
	let callIndex = 0;
	await page.route("**/v1/chat/completions", async (route) => {
		const completion =
			COMPLETIONS[callIndex % COMPLETIONS.length] ?? COMPLETIONS[0];
		callIndex++;
		await route.fulfill({
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
			},
			body: openAiSseBody(completion as string),
		});
	});

	// 3. Address red, fill prompt.
	const message = "hello red panel";
	await page.selectOption("#address", "red");
	await page.fill("#prompt", message);

	// 4. Install an in-page sampler that collects (red, green) transcript
	//    lengths every 30 ms.  We read the results back after streaming ends.
	await page.evaluate(() => {
		(window as unknown as Record<string, unknown>).__lenSamples = [];
		(window as unknown as Record<string, unknown>).__lenSampleId = setInterval(
			() => {
				const r =
					document.querySelector('[data-transcript="red"]')?.textContent
						?.length ?? 0;
				const g =
					document.querySelector('[data-transcript="green"]')?.textContent
						?.length ?? 0;
				(
					(window as unknown as Record<string, unknown>)
						.__lenSamples as LenPair[]
				).push({ red: r, green: g });
			},
			30,
		);
	});

	// 5. Click send — triggers the SPA round flow.
	await page.click("#send");

	// 6. Wait for all three panels to show their completion text.
	//    Each AI gets a distinct completion; wait until the third one appears.
	await page.waitForFunction(
		(completions: readonly string[]) => {
			const texts = ["red", "green", "blue"].map(
				(ai) =>
					document.querySelector(`[data-transcript="${ai}"]`)?.textContent ??
					"",
			);
			return completions.every((c) => texts.some((t) => t.includes(c)));
		},
		COMPLETIONS,
		{ timeout: 30_000 },
	);

	// 7. Stop sampler and retrieve snapshots.
	await page.evaluate(() => {
		clearInterval(
			(window as unknown as Record<string, unknown>)
				.__lenSampleId as ReturnType<typeof setInterval>,
		);
	});
	const samples = await page.evaluate(
		() =>
			(window as unknown as Record<string, unknown>).__lenSamples as LenPair[],
	);

	// 8. Gather transcript content.
	const redTranscript = await page
		.locator('[data-transcript="red"]')
		.textContent();
	const greenTranscript = await page
		.locator('[data-transcript="green"]')
		.textContent();
	const blueTranscript = await page
		.locator('[data-transcript="blue"]')
		.textContent();

	// 9. [you] message appears in red transcript exactly once.
	expect(redTranscript ?? "").toContain(`[you] ${message}`);
	// Exactly once: splitting on "[you]" gives exactly two parts.
	expect((redTranscript ?? "").split("[you]").length).toBe(2);

	// 10. green and blue do NOT contain [you].
	expect(greenTranscript ?? "").not.toContain("[you]");
	expect(blueTranscript ?? "").not.toContain("[you]");

	// 11. Each distinct completion appears in exactly one transcript.
	const transcripts = [
		redTranscript ?? "",
		greenTranscript ?? "",
		blueTranscript ?? "",
	];
	for (const completion of COMPLETIONS) {
		const count = transcripts.filter((t) => t.includes(completion)).length;
		expect(
			count,
			`Completion "${completion}" should appear in exactly 1 transcript`,
		).toBe(1);
	}

	// 12. Progressive rendering: at least one sample must have both red and
	//     green non-empty with different lengths.  This arises naturally once
	//     one panel finishes streaming and the next is mid-stream.
	const divergentSample = samples.find(
		(s) => s.red > 0 && s.green > 0 && s.red !== s.green,
	);
	expect(
		divergentSample,
		`Expected a sample where red and green both have non-zero but different ` +
			`lengths. Samples: ${JSON.stringify(samples.slice(0, 20))}`,
	).toBeDefined();

	// 13. No page errors.
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
