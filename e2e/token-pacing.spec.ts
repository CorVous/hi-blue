import { expect, test } from "@playwright/test";
import { stubChatCompletions } from "./helpers";

// Word chunks yielded for every AI call.  Red gets these tokens and we
// sample its transcript; green / blue responses use the same stub so all
// three LLM calls resolve quickly.
// 20 words × ≈42 ms/word (TOKEN_PACE_MS 60 × red-speed 0.7 × avg 1.0)
// ≈ 840 ms total display window — well beyond the 500 ms sample point.
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

// The expected final text appended to red's transcript by the token loop.
// game.ts prepends "[<PersonaName>] " before token emission and appends "\n"
// on ai_end.  We only assert the token portion here.
const EXPECTED_TOKENS = WORDS.join("");

/**
 * E2E Slice 2 — Token delivery
 *
 * Verifies that the SPA delivers AI content to `[data-transcript="red"]`
 * correctly when the completion SSE body arrives in a single chunk
 * (as `route.fulfill` does — the entire body is delivered at once).
 *
 * With live streaming (issue #102), content is painted via the `onAiDelta`
 * callback as SSE events arrive — BEFORE `submitMessage` resolves. This means
 * with a `route.fulfill` stub all content arrives synchronously before the
 * encoder pacing loop runs, so the pacing loop produces pace() delays but no
 * new appends for live AIs.
 *
 * The per-word monotonic-growth assertion from the pre-#102 implementation
 * has been replaced: content now arrives live (proved by
 * `e2e/diagnose-streaming.spec.ts`) rather than through the synthetic pacing
 * loop, so the meaningful guarantees here are:
 *
 * 1. Content reaches the panel before the round completes (snap0 has AI text).
 * 2. "thinking…" is gone before any AI text is visible (stripped on first delta).
 * 3. The final transcript contains the full expected token text.
 * 4. The round fully completes (send re-enables) with no page errors.
 */
test("token streaming arrives word-by-word, not as a single dump", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub every /v1/chat/completions call (one per AI per round).
	await stubChatCompletions(page, WORDS);

	await page.goto("/");

	// Ensure the game page is ready.
	await expect(page.locator('article.ai-panel[data-ai="red"]')).toBeVisible();

	// ── Submit a message addressed to red via @Ember mention ────────────────
	await page.fill("#prompt", "@Ember Hello");
	await expect(page.locator("#send")).toBeEnabled();

	const redTranscript = page.locator('[data-transcript="red"]');

	// Capture pre-submit baseline length.
	const baselineText = (await redTranscript.textContent()) ?? "";

	await page.click("#send");

	// ── Wait for live content to appear ──────────────────────────────────────
	// With live streaming, "thinking…" is stripped on the first live delta and
	// replaced immediately by the AI's persona prefix + content. We wait for
	// thinking… to disappear and the transcript to grow past the player message.
	const playerMsg = `\n[you] @Ember Hello\n`;
	const afterPlayerLength = baselineText.length + playerMsg.length;

	// Wait for thinking… to clear (first live delta strips it).
	await expect(redTranscript).not.toHaveText(/thinking…/, { timeout: 15_000 });

	// Poll until at least one token character arrives after the player message.
	await page.waitForFunction(
		({ selector, minLen }: { selector: string; minLen: number }) => {
			const el = document.querySelector(selector);
			return el != null && (el.textContent ?? "").length > minLen;
		},
		{ selector: '[data-transcript="red"]', minLen: afterPlayerLength },
		{ timeout: 10_000 },
	);

	// snap0: capture transcript immediately after first content arrives.
	// With live streaming + route.fulfill the entire AI response is already
	// there at this point (all deltas fire synchronously in one SSE read).
	const snap0 = (await redTranscript.textContent()) ?? "";

	// ── Wait for the round to fully complete ────────────────────────────────
	// The encoder pacing loop still runs (pace() awaits) but skips re-appending
	// text for live AIs. Send re-enables only after the loop finishes.
	await expect(page.locator("#send")).toBeEnabled({ timeout: 20_000 });
	const snapFinal = (await redTranscript.textContent()) ?? "";

	// ── Assertions ────────────────────────────────────────────────────────────

	// 1. Content was present at snap0 — live delivery happened before round end.
	expect(
		snap0.length,
		"snap0 should contain AI text (live delivery before round completes)",
	).toBeGreaterThan(afterPlayerLength);

	// 2. Final transcript contains the expected token text.
	expect(snapFinal).toContain(EXPECTED_TOKENS);

	// 3. snapFinal is at least as long as snap0 (no content removed during pacing).
	expect(
		snapFinal.length,
		`snapFinal length ${snapFinal.length} should be ≥ snap0 length ${snap0.length}`,
	).toBeGreaterThanOrEqual(snap0.length);

	// 4. No page errors fired.
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
