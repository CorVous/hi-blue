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
 *   1. Initial UI value is 5.000¢
 *   2. After one round of 3 AI replies, each panel's budget has decremented
 *      by a small but non-zero USD amount (the actual usage.cost from the
 *      final SSE chunk).
 *   3. AI's own system prompt (server-rendered text) is not asserted here —
 *      we only smoke the user-visible flow.
 *
 * Skipped unless OPENROUTER_API_KEY is set in the environment to a real
 * credential (the playwright webServer injects the placeholder "test-key" by
 * default, which cannot reach OpenRouter and would only cause this test to
 * time out).
 */
test("live: per-AI budget decrements in cents from real OpenRouter usage.cost", async ({
	page,
}) => {
	const apiKey = process.env.OPENROUTER_API_KEY;
	const hasRealKey = !!apiKey && apiKey !== "test-key";
	test.skip(
		!hasRealKey,
		"OPENROUTER_API_KEY not set (or is the placeholder 'test-key') — skipping live smoke; set a real OpenRouter key to run this test",
	);

	test.setTimeout(180_000);

	// Inject the BYOK key before any SPA code runs.
	await page.addInitScript((key: string) => {
		localStorage.setItem("openrouter_key", key);
	}, apiKey as string);

	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Navigate to the root — the start screen will appear first since there
	// is no active session. Real LLM calls (synthesis + content-pack) will run
	// using the injected BYOK key.
	await page.goto("/?skipDialup=1");

	// Wait for the start screen's generation to complete (real synthesis call).
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 120_000 });

	// Enter the password and click CONNECT to proceed to the game.
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await page.waitForURL(/.*#\/game/, { timeout: 30_000 });

	// Wait for the three AI panels to be ready (synthesis complete).
	const { ids, names } = await getAiHandles(page);

	// 1. Initial state: value "5.000¢".
	const firstPanel = page.locator(`.ai-panel[data-ai="${ids[0]}"]`);
	await expect(firstPanel.locator(".panel-budget")).toHaveText("5.000¢", {
		timeout: 30_000,
	});

	// All three panels start at 5.000¢.
	for (const id of ids) {
		await expect(
			page.locator(`.ai-panel[data-ai="${id}"] .panel-budget`),
		).toHaveText("5.000¢");
	}

	// 2. Send a short message addressed to all three AIs. Keep it minimal to
	//    keep the round cheap.
	const message = `*${names[0]} *${names[1]} *${names[2]} say hi briefly`;
	await page.fill("#prompt", message);
	await page.click("#send");

	// 3. Wait for all three panels to drop below 5.000¢ (i.e. cost was
	//    deducted). Real OpenRouter calls take a few seconds.
	await page.waitForFunction(
		(aiIds: string[]) => {
			return aiIds.every((id) => {
				const el = document.querySelector<HTMLElement>(
					`.ai-panel[data-ai="${id}"] .panel-budget`,
				);
				const text = el?.textContent ?? "";
				const match = /^(\d+\.\d{3})¢$/.exec(text);
				if (!match) return false;
				const cents = Number(match[1]);
				return Number.isFinite(cents) && cents < 5;
			});
		},
		ids,
		{ timeout: 120_000 },
	);

	// 4. Each panel shows a strictly less-than-starting value, formatted as X.XXX¢.
	for (const id of ids) {
		const text = await page
			.locator(`.ai-panel[data-ai="${id}"] .panel-budget`)
			.textContent();
		expect(text).toMatch(/^\d+\.\d{3}¢$/);
		const cents = Number((text ?? "").replace("¢", ""));
		expect(cents).toBeLessThan(5);
		expect(cents).toBeGreaterThanOrEqual(0); // display clamps at zero
	}

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
