import { expect, test } from "@playwright/test";
import { getAiHandles, goToGame, stubChatCompletions } from "./helpers";

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

	// Navigate through the start screen into the game.
	// goToGame stubs synthesis + content-pack + SSE and clicks BEGIN.
	const { names, ids } = await goToGame(page, { sse: [STUB_COMPLETION] });

	// Wait for the SPA game route to mount (the composer form is present)
	await expect(page.locator("#composer")).toBeVisible();

	// Address first AI via *<name> mention and send a message
	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	// Wait for the round to complete and the save to land. The save runs AFTER
	// the encoder loop processes all events, so we poll localStorage directly
	// rather than the transcript (which fills via live deltas earlier).
	// (Post-#107 the send button does NOT re-enable after submit because the
	// prompt is cleared and an empty prompt has no *mention → sendEnabled=false.)
	// Post-#173: BEGIN also saves engine.dat at round=0 on commit, so we can no
	// longer use engine.dat !== null as the "round complete" signal.  Instead we
	// wait for meta.round to advance to ≥ 1, which proves a full round was committed.
	await page.waitForFunction(
		() => {
			const sessionId = localStorage.getItem("hi-blue:active-session");
			if (!sessionId) return false;
			const metaRaw = localStorage.getItem(
				`hi-blue:sessions/${sessionId}/meta.json`,
			);
			if (!metaRaw) return false;
			try {
				const meta = JSON.parse(metaRaw) as { round?: number };
				return typeof meta.round === "number" && meta.round >= 1;
			} catch {
				return false;
			}
		},
		{ timeout: 15_000 },
	);

	// ── Assert localStorage was written ────────────────────────────────────────

	const { sessionId, metaRaw } = await page.evaluate(() => {
		const sid = localStorage.getItem("hi-blue:active-session");
		const meta = sid
			? localStorage.getItem(`hi-blue:sessions/${sid}/meta.json`)
			: null;
		return { sessionId: sid, metaRaw: meta };
	});
	expect(sessionId, "active-session pointer must be set").not.toBeNull();
	expect(metaRaw, "meta.json must be written").not.toBeNull();

	const meta = JSON.parse(metaRaw as string) as {
		phase: number;
		round: number;
		createdAt: string;
		lastSavedAt: string;
	};
	expect(meta.phase).toBeGreaterThanOrEqual(1);
	expect(meta.round).toBeGreaterThanOrEqual(1);

	// ── Capture pre-reload values ───────────────────────────────────────────────

	const preReloadTranscript = await page
		.locator(`[data-transcript="${ids[0]}"]`)
		.textContent();
	expect(preReloadTranscript).toBeTruthy();
	// The player's message must appear in the transcript. Post-#214 the leading
	// `*<handle>` mention is stripped before render, so the displayed line is
	// `> hello`, not `> *<handle> hello`.
	expect(preReloadTranscript).toContain("> hello");
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
	expect(postReloadTranscript).toContain("> hello");
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
