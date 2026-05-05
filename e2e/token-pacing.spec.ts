import { expect, test } from "@playwright/test";
import { streamChatCompletion } from "./helpers";

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
 * E2E Slice 2 — Token pacing
 *
 * Verifies that the SPA's token-pacing loop (TOKEN_PACE_MS × AI_TYPING_SPEED)
 * delivers `[data-transcript="red"]` content word-by-word rather than as a
 * single synchronous dump.
 *
 * Approach
 * --------
 * 1. Stub *\/v1/chat/completions to return a synthetic 7-word OpenAI SSE body
 *    for all three AI calls.  The SPA processes each response, assembles
 *    per-AI completions, then iterates the encoded token events with a
 *    pace() delay of ~42 ms per token (TOKEN_PACE_MS 60 × red-speed 0.7 ×
 *    random[0.5–1.5]).  Seven tokens spread across ~150–630 ms gives us
 *    ample room to capture strictly-monotonic intermediate snapshots.
 * 2. After submitting the form we wait for the "thinking…" placeholder to
 *    clear (signals that all LLM calls have resolved and the pacing loop has
 *    started), then record four snapshots of [data-transcript="red"] length
 *    at ≈50 ms / ≈200 ms / ≈500 ms / final.
 * 3. Assert strict monotonic growth and ≥ 3 distinct intermediate snapshots.
 */
test("token streaming arrives word-by-word, not as a single dump", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub every /v1/chat/completions call (one per AI per round).
	await streamChatCompletion(page, WORDS);

	await page.goto("/");

	// Ensure the game page is ready.
	await expect(page.locator('article.ai-panel[data-ai="red"]')).toBeVisible();

	// ── Submit a message addressed to red ────────────────────────────────────
	await page.selectOption("#address", "red");
	await page.fill("#prompt", "Hello");

	const redTranscript = page.locator('[data-transcript="red"]');

	// Capture pre-submit baseline length.
	const baselineText = (await redTranscript.textContent()) ?? "";

	await page.click("#send");

	// ── Wait for pacing loop to start ────────────────────────────────────────
	// The SPA appends "thinking…" to the addressed panel immediately on submit
	// and removes it once all LLM calls resolve and the token loop begins.
	// We wait until "thinking…" is absent from red's transcript AND red's
	// transcript has grown beyond the baseline + player message, meaning at
	// least one token has been appended.
	const playerMsg = `\n[you] Hello\n`;
	const afterPlayerLength = baselineText.length + playerMsg.length;

	// Wait for first token to appear: transcript longer than baseline + player message.
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

	// ── Capture four snapshots during pacing ─────────────────────────────────
	const snap0 = (await redTranscript.textContent()) ?? "";

	await page.waitForTimeout(50);
	const snap50 = (await redTranscript.textContent()) ?? "";

	await page.waitForTimeout(150); // cumulative ~200 ms
	const snap200 = (await redTranscript.textContent()) ?? "";

	await page.waitForTimeout(300); // cumulative ~500 ms
	const snap500 = (await redTranscript.textContent()) ?? "";

	// ── Wait for all tokens to finish (send re-enables on completion) ─────────
	await expect(page.locator("#send")).toBeEnabled({ timeout: 10_000 });
	const snapFinal = (await redTranscript.textContent()) ?? "";

	// ── Assertions ────────────────────────────────────────────────────────────

	const lengths = [
		snap0.length,
		snap50.length,
		snap200.length,
		snap500.length,
		snapFinal.length,
	];

	// 1. Strictly monotonically increasing length across the 4 timed samples
	//    (snap0 → snap50 → snap200 → snap500) plus the final snapshot.
	for (let i = 1; i < lengths.length; i++) {
		expect(
			lengths[i],
			`snapshot[${i}] length ${lengths[i]} must be > snapshot[${i - 1}] length ${lengths[i - 1]}`,
		).toBeGreaterThan(lengths[i - 1] as number);
	}

	// 2. At least 3 distinct intermediate snapshots (snap0 / snap50 / snap200
	//    before reaching the final), ruling out "all-at-once then pause".
	const intermediates = new Set([snap0, snap50, snap200, snap500]);
	expect(
		intermediates.size,
		`expected ≥ 3 distinct intermediate snapshots, got ${intermediates.size}`,
	).toBeGreaterThanOrEqual(3);

	// 3. Final transcript contains the expected token text.
	expect(snapFinal).toContain(EXPECTED_TOKENS);

	// 4. No page errors fired.
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
