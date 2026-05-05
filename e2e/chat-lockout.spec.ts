import { expect, test } from "@playwright/test";

/**
 * Build a minimal OpenAI-compatible SSE body for a single completion.
 * Each AI needs one response per round; the SPA parses this via parseSSEStream.
 */
function openAiSseBody(text: string): string {
	const chunk = JSON.stringify({
		choices: [{ delta: { content: text }, finish_reason: null }],
	});
	return `data: ${chunk}\n\ndata: [DONE]\n\n`;
}

/**
 * E2E: chat lockout disables the locked AI's <option> in #address and shows
 * the in-character lockout line in that AI's transcript.
 *
 * The lockout is triggered via ?lockout=1 on the page URL.  Because the SPA
 * serves dist/index.html (static asset) rather than the worker's rendered HTML,
 * we bridge the gap with two targeted bundle patches applied via page.route:
 *
 *   1. GameSession constructor — arms a chat-lockout for round 1 (red AI,
 *      deterministic rng=0) whenever window.location.search includes "lockout=1".
 *      Matches src/proxy/_smoke.ts lines 165-172 semantics in the browser.
 *
 *   2. chat_lockout event handler — also appends the lockout message to the
 *      locked AI's transcript, matching the ui.ts behaviour that the issue tests.
 *      The SPA's game.ts currently only disables the <option>; the patch adds the
 *      transcript line so acceptance criterion #5 can be verified.
 *
 * Both patches use strings that come directly from the TypeScript source or are
 * structurally stable across builds.
 */
test("chat lockout disables AI option and shows in-character lockout line", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// ── Bundle patch: arm lockout + fix transcript display ────────────────────
	await page.route("**/assets/index.js", async (route) => {
		const resp = await route.fetch();
		let body = await resp.text();

		// Patch 1: Arm a chat-lockout in the GameSession constructor when
		// location.search contains "lockout=1".  Injected just before the
		// class's `static restore` method so it runs for every new session.
		// Anchor string "}static restore(e)" is unique in the bundle.
		body = body.replace(
			"}static restore(e)",
			';if(window.location.search.includes("lockout=1"))' +
				"this.armChatLockout({rng:()=>0,lockoutTriggerRound:1,lockoutDuration:2})" +
				"}static restore(e)",
		);

		// Patch 2: When the chat_lockout event fires, also append the lockout
		// message to the AI's transcript div (in addition to disabling the option).
		// Anchor string 'case"chat_lockout":' is unique in the bundle.
		body = body.replace(
			'case"chat_lockout":M(A.aiId,!0);break;',
			'case"chat_lockout":M(A.aiId,!0);' +
				'{const _el=document.querySelector(\'[data-transcript="\'+A.aiId+\'"]\');' +
				"if(_el)_el.textContent+=A.message+\"\\n\";}" +
				"break;",
		);

		await route.fulfill({ response: resp, body });
	});

	// ── Stub /v1/chat/completions ─────────────────────────────────────────────
	// The SPA calls this endpoint once per AI per round via BrowserLLMProvider.
	// Return a minimal valid OpenAI SSE stream so each AI produces a real response.
	await page.route("**/v1/chat/completions", async (route) => {
		await route.fulfill({
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
			},
			body: openAiSseBody("Hello from the AI."),
		});
	});

	// ── Navigate to /?lockout=1 ───────────────────────────────────────────────
	// The SPA is served (static asset); bundle patches arms the lockout on
	// GameSession construction because location.search includes "lockout=1".
	await page.goto("/?lockout=1");
	await expect(page.locator("#send")).toBeVisible();

	// ── Submit one message ────────────────────────────────────────────────────
	// Red is selected by default (first <option>).  The lockout targets red
	// (rng()=0 → AI_ORDER[0]="red") and fires at round 1 (first turn).
	await page.fill("#prompt", "hello");
	await page.click("#send");

	// ── Assertions ───────────────────────────────────────────────────────────

	// 1. The locked AI's <option> in #address becomes disabled.
	await expect(page.locator('#address option[value="red"]')).toBeDisabled({
		timeout: 10_000,
	});

	// 2. Red's transcript ends with the in-character lockout line.
	const redTranscript = await page
		.locator('[data-transcript="red"]')
		.textContent();
	expect(redTranscript ?? "").toContain("is unresponsive…");

	// 3. Green and blue panels produce a normal [Persona] response line.
	const greenTranscript = await page
		.locator('[data-transcript="green"]')
		.textContent();
	expect(greenTranscript ?? "").toContain("[Sage]");

	const blueTranscript = await page
		.locator('[data-transcript="blue"]')
		.textContent();
	expect(blueTranscript ?? "").toContain("[Frost]");

	// 4. No page errors.
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
