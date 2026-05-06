import { expect, test } from "@playwright/test";
import { stubChatCompletions } from "./helpers";

/**
 * E2E Slice 4 — game_ended current behaviour (issue #80)
 *
 * Proves that when game_ended fires the SPA:
 *   - disables #send and #prompt
 *   - clears localStorage (clearGame() ran)
 *   - keeps the URL stable (no navigation)
 *   - emits no pageerror events
 *
 * Strategy
 * --------
 * `?winImmediately=1` injects `winCondition: () => true` into the **active**
 * phase only. The real PHASE_1_CONFIG has `nextPhaseConfig`, so after phase 1
 * ends the game advances to phase 2 (which has no winCondition) — game_ended
 * never fires from a cold start.
 *
 * Instead we pre-seed localStorage with a minimal valid phase-3 game state
 * (phase 3 has no nextPhaseConfig). When the SPA loads `/?winImmediately=1` it
 * restores the phase-3 state from storage, then applyTestAffordances injects
 * `winCondition: () => true` into that active phase. One submitted message
 * fires winCondition → advancePhase(state, undefined) → isComplete=true →
 * game_ended emitted after the first turn.
 */

/** Minimal localStorage blob representing a live phase-3 session. */
const PHASE_3_SEED = JSON.stringify({
	schemaVersion: 1,
	savedAt: new Date(0).toISOString(),
	game: {
		currentPhase: 3,
		isComplete: false,
		personas: {
			red: {
				id: "red",
				name: "Ember",
				color: "red",
				personality: "p",
				goal: "g",
				budgetPerPhase: 5,
			},
			green: {
				id: "green",
				name: "Sage",
				color: "green",
				personality: "p",
				goal: "g",
				budgetPerPhase: 5,
			},
			blue: {
				id: "blue",
				name: "Frost",
				color: "blue",
				personality: "p",
				goal: "g",
				budgetPerPhase: 5,
			},
		},
		phases: [
			{
				phaseNumber: 3,
				objective: "get the key in the keyhole",
				aiGoals: { red: "Endure", green: "Endure", blue: "Endure" },
				round: 0,
				world: { items: [] },
				budgets: {
					red: { remaining: 5, total: 5 },
					green: { remaining: 5, total: 5 },
					blue: { remaining: 5, total: 5 },
				},
				chatHistories: { red: [], green: [], blue: [] },
				whispers: [],
				actionLog: [],
				lockedOut: [],
				chatLockouts: [],
			},
		],
	},
	transcripts: { red: "", green: "", blue: "" },
});

test("game_ended disables composer and clears storage", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// 1. Stub every /v1/chat/completions call — one per AI per turn.
	await stubChatCompletions(page, ["hello"]);

	// 2. Navigate to the root first to establish the origin, then pre-seed
	//    localStorage with a phase-3 state so that applyTestAffordances patches
	//    the final phase (no nextPhaseConfig → game_ended on win).
	await page.goto("/");
	await page.evaluate(
		([key, value]: [string, string]) => localStorage.setItem(key, value),
		["hi-blue-game-state", PHASE_3_SEED],
	);

	// 3. Navigate to /?winImmediately=1 — applyTestAffordances injects
	//    winCondition: () => true into the active (phase-3) session.
	await page.goto("/?winImmediately=1");

	// Wait for SPA mount.
	await expect(page.locator("#composer")).toBeVisible();

	// 4. Capture URL before submitting (proves URL stability below).
	const urlBefore = page.url();

	// 5. Submit one message addressed to red (@Ember). Because winCondition always
	//    returns true and phase 3 has no nextPhaseConfig, advancePhase sets
	//    isComplete=true → game_ended event → composer disabled.
	await page.fill("#prompt", "@Ember hello");
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	// 6. Wait for game_ended handler to fire: #send must become disabled.
	//    Use a generous timeout — three LLM stub calls + token-pacing run first.
	await expect(page.locator("#send")).toBeDisabled({ timeout: 30_000 });

	// 7. Assert all acceptance criteria.

	// #send disabled
	await expect(page.locator("#send")).toBeDisabled();

	// #prompt disabled
	await expect(page.locator("#prompt")).toBeDisabled();

	// localStorage cleared (clearGame() ran inside game_ended handler)
	const stored = await page.evaluate(() =>
		localStorage.getItem("hi-blue-game-state"),
	);
	expect(stored, "localStorage must be null after game_ended").toBeNull();

	// URL stable — no navigation or hash change occurred
	expect(page.url(), "URL must not change after game_ended").toBe(urlBefore);

	// No page errors
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
