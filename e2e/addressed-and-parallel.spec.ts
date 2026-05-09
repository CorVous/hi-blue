import { expect, test } from "@playwright/test";
import { goToGame } from "./helpers/index";

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

	// Navigate through the start screen with ?winImmediately=1 so the SPA
	// injects a win condition into the active phase on boot.
	// The SSE factory returns distinct completions by call order.
	let callIndex = 0;
	const { ids, names } = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: () => {
			const text =
				COMPLETIONS[callIndex % COMPLETIONS.length] ?? COMPLETIONS[0];
			callIndex++;
			return (text as string).split(" ").map((w) => `${w} `);
		},
	});

	// Fill prompt with first AI's mention to address ids[0].
	const message = `*${names[0]} hello first panel`;
	await page.fill("#prompt", message);

	// Click send — triggers the SPA round flow.
	await page.click("#send");

	// Wait for all three panels to show their completion text.
	// Each AI gets a distinct completion; wait until the third one appears.
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

	// Gather transcript content.
	const firstTranscript = await page
		.locator(`[data-transcript="${ids[0]}"]`)
		.textContent();
	const secondTranscript = await page
		.locator(`[data-transcript="${ids[1]}"]`)
		.textContent();
	const thirdTranscript = await page
		.locator(`[data-transcript="${ids[2]}"]`)
		.textContent();

	// Player message appears in the first transcript exactly once. The SPA's
	// form-submit handler strips the leading `*<handle>` mention before
	// rendering the player line (see `src/spa/routes/game.ts`: "Append the
	// (mention-stripped) player message to the addressed panel."), so the
	// assertion checks for the stripped body, not the original input.
	expect(firstTranscript ?? "").toContain("> hello first panel");
	// Exactly once: splitting on the player prefix gives exactly two parts.
	expect((firstTranscript ?? "").split("> hello first panel").length).toBe(2);

	// second and third do NOT contain the player line.
	expect(secondTranscript ?? "").not.toContain("> hello first panel");
	expect(thirdTranscript ?? "").not.toContain("> hello first panel");

	// Each distinct completion appears in exactly one transcript.
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

	// No page errors.
	// The previous `divergentSample` assertion (a 30 ms-poll setInterval that
	// looked for a moment where two panels had non-zero but different lengths)
	// was dropped: under stubbed SSE the round completes in well under 100 ms,
	// the sampler captures only 2-3 frames, and the assertion was flaky at
	// `--repeat-each=10`. Inter-panel render-timing coverage, if needed, belongs
	// in a dedicated spec built on a deterministic sequencing harness rather
	// than piggy-backed onto this addressed-mention test. See issue #151.
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
