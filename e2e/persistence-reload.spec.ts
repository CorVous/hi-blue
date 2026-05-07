import { expect, test } from "@playwright/test";
import { getAiHandles, stubChatCompletions } from "./helpers";

/**
 * AI completions returned by the stub, keyed by call index (0 = first, 1 = second, 2 = third
 * for default initiative order).  We keep them short to minimise token-pacing delay.
 */
const STUB_COMPLETION = "stub reply";

test("game state and transcripts persist across mid-round reload", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub every call to /v1/chat/completions with a deterministic one-token response.
	// The SPA fires one call per AI per round.
	await stubChatCompletions(page, [STUB_COMPLETION]);

	await page.goto("/");

	// Wait for the SPA game route to mount (the composer form is present)
	await expect(page.locator("#composer")).toBeVisible();

	// Read AI handles dynamically (set after synthesis completes).
	const { ids, names } = await getAiHandles(page);

	// Address first AI via @<name> mention and send a message
	await page.fill("#prompt", `@${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	// Wait for the round to complete and the save to land. The save runs AFTER
	// the encoder loop processes all events, so we poll localStorage directly
	// rather than the transcript (which fills via live deltas earlier).
	// (Post-#107 the send button does NOT re-enable after submit because the
	// prompt is cleared and an empty prompt has no @mention → sendEnabled=false.)
	await expect
		.poll(
			() => page.evaluate(() => localStorage.getItem("hi-blue-game-state")),
			{ timeout: 15_000 },
		)
		.not.toBeNull();

	// ── Assert localStorage was written ────────────────────────────────────────

	const raw = await page.evaluate(() =>
		localStorage.getItem("hi-blue-game-state"),
	);
	expect(raw, "localStorage must contain saved game state").not.toBeNull();

	const saved = JSON.parse(raw as string) as {
		schemaVersion: number;
		transcripts?: Partial<Record<string, string>>;
	};
	expect(saved.schemaVersion).toBeGreaterThanOrEqual(1);
	expect(
		saved.transcripts?.[ids[0]],
		"transcripts[ids[0]] must be non-empty after turn 1",
	).toBeTruthy();

	// ── Capture pre-reload values ───────────────────────────────────────────────

	const preReloadTranscript = await page
		.locator(`[data-transcript="${ids[0]}"]`)
		.textContent();
	expect(preReloadTranscript).toBeTruthy();
	// The player's message must appear in the transcript
	expect(preReloadTranscript).toContain("> @");
	// The stub completion must appear in the addressed panel
	expect(preReloadTranscript).toContain(STUB_COMPLETION);

	const preReloadBudgets: Record<string, string> = {};
	for (const aiId of ids) {
		const el = page.locator(`.ai-panel[data-ai="${aiId}"] .panel-budget`);
		preReloadBudgets[aiId] = (await el.getAttribute("data-budget")) ?? "";
	}

	// ── Reload ──────────────────────────────────────────────────────────────────

	await page.reload();

	// Wait for SPA to remount after reload
	await expect(page.locator("#composer")).toBeVisible();

	// After reload we need to stub again for the restored session (the route
	// intercept was only on the previous page context).
	await stubChatCompletions(page, [STUB_COMPLETION]);

	// After reload, fetch handles again — procedural names persist via saved persona.name.
	const { ids: reloadIds } = await getAiHandles(page);

	// ── Assert transcripts restored ─────────────────────────────────────────────

	const postReloadTranscript = await page
		.locator(`[data-transcript="${reloadIds[0]}"]`)
		.textContent();
	expect(postReloadTranscript).toContain("> @");
	expect(postReloadTranscript).toContain(STUB_COMPLETION);
	expect(postReloadTranscript).toBe(preReloadTranscript);

	// ── Assert budgets restored ─────────────────────────────────────────────────

	for (const aiId of reloadIds) {
		const el = page.locator(`.ai-panel[data-ai="${aiId}"] .panel-budget`);
		const postBudget = await el.getAttribute("data-budget");
		expect(postBudget, `${aiId} budget must match after reload`).toBe(
			preReloadBudgets[aiId],
		);
	}

	// ── No page errors ──────────────────────────────────────────────────────────

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
