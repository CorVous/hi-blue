import { expect, test } from "@playwright/test";
import { getAiHandles } from "./helpers/index";

// The sandbox runs an HTTPS interception proxy whose CA the chromium binary
// doesn't trust. Allow self-signed-style certs so the SPA can reach
// openrouter.ai when running in BYOK mode.
test.use({ ignoreHTTPSErrors: true });

/**
 * Live smoke for the USD cents budget feature.
 *
 * Runs against real OpenRouter via BYOK (key set in localStorage so the SPA
 * bypasses the proxy). Verifies:
 *   1. Initial UI value is $0.05000
 *   2. After one round of 3 AI replies, each panel's budget has decremented
 *      by a small but non-zero USD amount (the actual usage.cost from the
 *      final SSE chunk).
 *   3. AI's own system prompt (server-rendered text) is not asserted here —
 *      we only smoke the user-visible flow.
 *
 * Skipped unless OPENROUTER_API_KEY is set in the environment.
 */
test("live: per-AI budget decrements in cents from real OpenRouter usage.cost", async ({
	page,
}) => {
	const apiKey = process.env.OPENROUTER_API_KEY;
	test.skip(!apiKey, "OPENROUTER_API_KEY not set — skipping live smoke");

	test.setTimeout(180_000);

	// Inject the BYOK key before any SPA code runs.
	await page.addInitScript((key: string) => {
		localStorage.setItem("openrouter_key", key);
	}, apiKey as string);

	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await page.goto("/");

	// Wait for the three AI panels to be ready (synthesis complete).
	const { ids, names } = await getAiHandles(page);

	// 1. Initial state: value "$0.05000".
	const firstPanel = page.locator(`.ai-panel[data-ai="${ids[0]}"]`);
	await expect(firstPanel.locator(".panel-budget")).toHaveText("$0.05000", {
		timeout: 30_000,
	});

	// All three panels start at $0.05000.
	for (const id of ids) {
		await expect(
			page.locator(`.ai-panel[data-ai="${id}"] .panel-budget`),
		).toHaveText("$0.05000");
	}

	// 2. Send a short message addressed to all three AIs. Keep it minimal to
	//    keep the round cheap.
	const message = `*${names[0]} *${names[1]} *${names[2]} say hi briefly`;
	await page.fill("#prompt", message);
	await page.click("#send");

	// 3. Wait for all three panels to drop below $0.05000 (i.e. cost was
	//    deducted). Real OpenRouter calls take a few seconds.
	await page.waitForFunction(
		(aiIds: string[]) => {
			return aiIds.every((id) => {
				const el = document.querySelector<HTMLElement>(
					`.ai-panel[data-ai="${id}"] .panel-budget`,
				);
				const text = el?.textContent ?? "";
				const match = /^\$(\d+\.\d{5})$/.exec(text);
				if (!match) return false;
				const value = Number(match[1]);
				return Number.isFinite(value) && value < 0.05;
			});
		},
		ids,
		{ timeout: 120_000 },
	);

	// 4. Each panel shows a strictly less-than-starting value, formatted as $X.XXXXX.
	for (const id of ids) {
		const text = await page
			.locator(`.ai-panel[data-ai="${id}"] .panel-budget`)
			.textContent();
		expect(text).toMatch(/^\$\d+\.\d{5}$/);
		const value = Number((text ?? "").replace("$", ""));
		expect(value).toBeLessThan(0.05);
		expect(value).toBeGreaterThanOrEqual(0); // display clamps at zero
	}

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
