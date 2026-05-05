import { expect, test } from "@playwright/test";
import { stubGameTurn } from "./helpers";

/**
 * Build a minimal set of OpenAI-compatible SSE chunks for one LLM call.
 *
 * Returns a valid OpenAI chat completion SSE body that the SPA's
 * parseSSEStream can decode. Each AI streams one word so the round
 * coordinator's BrowserLLMProvider resolves quickly.
 */
function openAiSseBody(text: string): string {
	const chunks: string[] = [
		`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
		"data: [DONE]\n\n",
	];
	return chunks.join("");
}

test("game_ended disables composer and clears storage", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub /v1/chat/completions — the SPA's BrowserLLMProvider calls this for
	// every AI turn. Return a tiny valid OpenAI SSE stream so each AI "speaks"
	// a single word. The win condition fires independently via the bundle patch
	// below; this stub just prevents real network calls.
	await page.route("**/v1/chat/completions", async (route) => {
		await route.fulfill({
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
			},
			body: openAiSseBody("Hello"),
		});
	});

	// Patch the compiled SPA bundle to inject winCondition: () => true into
	// every phase config so the game engine advances phases and ends the game.
	// The three phase configs each end with `budgetPerAi:5` followed by `}` or
	// `,nextPhaseConfig:`. We inject the win condition before the closing char.
	await page.route("**/assets/index.js", async (route) => {
		const resp = await route.fetch();
		let body = await resp.text();
		// Phase 3 (no nextPhaseConfig): budgetPerAi:5}
		body = body.replace(
			/budgetPerAi:5}/g,
			"budgetPerAi:5,winCondition:()=>!0}",
		);
		// Phases 1 & 2 (have nextPhaseConfig): budgetPerAi:5,nextPhaseConfig:
		body = body.replace(
			/budgetPerAi:5,nextPhaseConfig:/g,
			"budgetPerAi:5,winCondition:()=>!0,nextPhaseConfig:",
		);
		await route.fulfill({ response: resp, body });
	});

	// Capture URL before any turns
	await page.goto("/");
	const urlBefore = page.url();

	// stubGameTurn is included here to satisfy the helper import pattern used
	// by this slice family; it has no effect on the SPA (the SPA calls
	// /v1/chat/completions, not /game/turn).
	await stubGameTurn(page, []);

	// Wait for composer to be ready
	await expect(page.locator("#send")).toBeVisible();
	await expect(page.locator("#prompt")).toBeVisible();

	// Helper: submit one turn, wait for send button state
	async function submitTurn(expectDisabledAfter: boolean): Promise<void> {
		await page.locator("#prompt").fill("hello");
		await page.locator("#send").click();

		if (expectDisabledAfter) {
			await expect(page.locator("#send")).toBeDisabled();
		} else {
			await expect(page.locator("#send")).toBeEnabled();
		}
	}

	// Turn 1: phase_advanced (phase 1 → phase 2), game continues
	await submitTurn(false);

	// Turn 2: phase_advanced (phase 2 → phase 3), game continues
	await submitTurn(false);

	// Turn 3: game_ended (phase 3 has no nextPhaseConfig)
	await submitTurn(true);

	// 1. #send disabled
	await expect(page.locator("#send")).toHaveAttribute("disabled", "");

	// 2. #prompt disabled
	await expect(page.locator("#prompt")).toHaveAttribute("disabled", "");

	// 3. localStorage cleared by clearGame()
	const storedValue = await page.evaluate(() =>
		localStorage.getItem("hi-blue-game-state"),
	);
	expect(storedValue).toBeNull();

	// 4. URL stable across all three turns
	expect(page.url()).toBe(urlBefore);

	// 5. No page errors
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
