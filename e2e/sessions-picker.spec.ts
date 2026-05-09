/**
 * sessions-picker.spec.ts
 *
 * Playwright e2e tests for the #/sessions picker.
 *
 * Covers:
 *  - Picker rendering for ok / broken / version-mismatch row states
 *  - [ load ] flow: picker → #/game → topinfo shows session id
 *  - [ dup ] flow: picker → two rows, active pointer unchanged
 *  - [ rm ] confirm/cancel flow
 *  - Sessions-icon ([ ls ] button) click → #/sessions
 *  - Broken-session banner: active session with missing engine.dat → #/sessions?reason=broken
 *  - [ + new session ] flow: picker → #/start, new active pointer
 *
 * Issue #174 (parent #155).
 */
import { expect, test } from "@playwright/test";
import { goToGame, stubNewGameLLM } from "./helpers";

// ── Obfuscation key (embedded in seed scripts) ────────────────────────────────

const OBFUSCATION_KEY = "hi-blue:engine/v1@kJvN3pX8wQmR2sZt";

// ── Session seed helpers ──────────────────────────────────────────────────────

/**
 * Seed an ok session in localStorage for addInitScript use.
 */
function seedOkSessionScript(id: string, lastSavedAt: string): string {
	return `
		(function() {
			const prefix = 'hi-blue:sessions/${id}/';
			const meta = JSON.stringify({
				createdAt: '2025-01-01T00:00:00.000Z',
				lastSavedAt: '${lastSavedAt}',
				phase: 1,
				round: 0,
				personaOrder: ['red'],
			});
			localStorage.setItem(prefix + 'meta.json', meta);

			// Daemon file: must match DaemonFile shape (aiId, persona, phases)
			const daemonFile = JSON.stringify({
				aiId: 'red',
				persona: {
					id: 'red',
					name: 'Red',
					color: '#ff0000',
					temperaments: ['bold', 'calm'],
					personaGoal: 'stub',
					blurb: 'stub',
					typingQuirks: ['...', '!'],
					voiceExamples: ['Hello.', 'Indeed.', 'Farewell.'],
				},
				phases: {
					'1': { phaseGoal: '', conversationLog: [] },
					'2': { phaseGoal: '', conversationLog: [] },
					'3': { phaseGoal: '', conversationLog: [] },
				},
			});
			localStorage.setItem(prefix + 'red.txt', daemonFile);

			// Build engine.dat via inline obfuscation — payload must match SealedEngine
			const OBFUSCATION_KEY = '${OBFUSCATION_KEY}';
			const keyBytes = Array.from(new TextEncoder().encode(OBFUSCATION_KEY));
			const payload = JSON.stringify({
				schemaVersion: 3,
				currentPhase: 1,
				isComplete: false,
				world: {
					1: { entities: [] },
					2: { entities: [] },
					3: { entities: [] },
				},
				contentPacks: [
					{ phaseNumber: 1, setting: 'test', objectivePairs: [], interestingObjects: [], obstacles: [], aiStarts: {} },
				],
				budgets: { 1: {}, 2: {}, 3: {} },
				lockouts: {
					1: { lockedOut: [], chatLockouts: [] },
					2: { lockedOut: [], chatLockouts: [] },
					3: { lockedOut: [], chatLockouts: [] },
				},
				personaSpatial: { 1: {}, 2: {}, 3: {} },
			});
			const jsonBytes = Array.from(new TextEncoder().encode(payload));
			const xored = jsonBytes.map((b,i) => b ^ (keyBytes[i % keyBytes.length] ?? 0));
			let iso = '';
			for (const b of xored) iso += String.fromCharCode(b);
			const engineDat = btoa(iso);
			localStorage.setItem(prefix + 'engine.dat', engineDat);
		})();
	`;
}

/**
 * Seed a broken session (missing engine.dat) for addInitScript use.
 */
function seedBrokenSessionScript(id: string): string {
	return `
		(function() {
			const prefix = 'hi-blue:sessions/${id}/';
			const meta = JSON.stringify({
				createdAt: '2025-01-01T00:00:00.000Z',
				lastSavedAt: '2025-01-01T08:00:00.000Z',
				phase: 1,
				round: 0,
			});
			localStorage.setItem(prefix + 'meta.json', meta);
			localStorage.setItem(prefix + 'red.txt', '{}');
			// Intentionally omit engine.dat (whispers.txt retired in v3)
		})();
	`;
}

/**
 * Seed a version-mismatch session (bumped schemaVersion) for addInitScript use.
 */
function seedVersionMismatchScript(id: string): string {
	return `
		(function() {
			const prefix = 'hi-blue:sessions/${id}/';
			const meta = JSON.stringify({
				createdAt: '2025-01-01T00:00:00.000Z',
				lastSavedAt: '2025-01-01T06:00:00.000Z',
				phase: 1,
				round: 0,
			});
			localStorage.setItem(prefix + 'meta.json', meta);
			localStorage.setItem(prefix + 'red.txt', '{}');

			// Build engine.dat with schemaVersion=999 (mismatch)
			const OBFUSCATION_KEY = '${OBFUSCATION_KEY}';
			const keyBytes = Array.from(new TextEncoder().encode(OBFUSCATION_KEY));
			const payload = JSON.stringify({ schemaVersion: 999 });
			const jsonBytes = Array.from(new TextEncoder().encode(payload));
			const xored = jsonBytes.map((b,i) => b ^ (keyBytes[i % keyBytes.length] ?? 0));
			let iso = '';
			for (const b of xored) iso += String.fromCharCode(b);
			const engineDat = btoa(iso);
			localStorage.setItem(prefix + 'engine.dat', engineDat);
		})();
	`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("picker renders ok/broken/version-mismatch rows with correct tags and buttons", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await page.addInitScript(() => {
		// ok session
		localStorage.setItem("hi-blue:active-session", "0xAAAA");
	});
	await page.addInitScript(
		new Function(
			seedOkSessionScript("0xAAAA", "2025-03-01T10:00:00.000Z"),
		) as () => void,
	);
	await page.addInitScript(
		new Function(seedBrokenSessionScript("0xBBBB")) as () => void,
	);
	await page.addInitScript(
		new Function(seedVersionMismatchScript("0xCCCC")) as () => void,
	);

	await page.goto("/#/sessions");
	await expect(page.locator("#sessions-screen")).toBeVisible();

	// ok row
	const okRow = page.locator('.session-row[data-session-id="0xAAAA"]');
	await expect(okRow).toBeVisible();
	await expect(
		okRow.locator(".ops button", { hasText: "[ load ]" }),
	).toBeVisible();
	await expect(
		okRow.locator(".ops button", { hasText: "[ dup ]" }),
	).toBeVisible();
	await expect(
		okRow.locator(".ops button", { hasText: "[ rm ]" }),
	).toBeVisible();

	// broken row
	const brokenRow = page.locator('.session-row[data-session-id="0xBBBB"]');
	await expect(brokenRow).toBeVisible();
	await expect(brokenRow.locator(".tag-corrupt")).toBeVisible();
	await expect(
		brokenRow.locator(".ops button", { hasText: "[ rm ]" }),
	).toBeVisible();
	await expect(
		brokenRow.locator(".ops button", { hasText: "[ load ]" }),
	).not.toBeVisible();

	// version-mismatch row
	const vmRow = page.locator('.session-row[data-session-id="0xCCCC"]');
	await expect(vmRow).toBeVisible();
	await expect(vmRow.locator(".tag-version-mismatch")).toBeVisible();
	await expect(
		vmRow.locator(".ops button", { hasText: "[ rm ]" }),
	).toBeVisible();
	await expect(
		vmRow.locator(".ops button", { hasText: "[ load ]" }),
	).not.toBeVisible();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("[ load ] flow: click load on non-active row → URL becomes #/game", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub LLM so the SPA can restore and render game
	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.addInitScript(() => {
		localStorage.setItem("hi-blue:active-session", "0xAAAA");
	});
	await page.addInitScript(
		new Function(
			seedOkSessionScript("0xAAAA", "2025-03-01T10:00:00.000Z"),
		) as () => void,
	);
	await page.addInitScript(
		new Function(
			seedOkSessionScript("0xBBBB", "2025-02-01T10:00:00.000Z"),
		) as () => void,
	);

	await page.goto("/#/sessions");
	await expect(page.locator("#sessions-screen")).toBeVisible();

	// Click load on session BBBB (non-active)
	const rowB = page.locator('.session-row[data-session-id="0xBBBB"]');
	await rowB.locator(".ops button", { hasText: "[ load ]" }).click();

	// Should navigate to #/game
	await page.waitForURL(/.*#\/game/, { timeout: 10_000 });

	// Active session should be BBBB
	const activeId = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(activeId).toBe("0xBBBB");

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("[ dup ] flow: click dup → two rows, active pointer unchanged", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await page.addInitScript(() => {
		localStorage.setItem("hi-blue:active-session", "0xAAAA");
	});
	await page.addInitScript(
		new Function(
			seedOkSessionScript("0xAAAA", "2025-03-01T10:00:00.000Z"),
		) as () => void,
	);

	await page.goto("/#/sessions");
	await expect(page.locator("#sessions-screen")).toBeVisible();

	// Initially 1 row
	await expect(page.locator(".session-row")).toHaveCount(1);

	// Click dup
	const rowA = page.locator('.session-row[data-session-id="0xAAAA"]');
	await rowA.locator(".ops button", { hasText: "[ dup ]" }).click();

	// Now 2 rows
	await expect(page.locator(".session-row")).toHaveCount(2);

	// Active pointer should still be 0xAAAA
	const activeId = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(activeId).toBe("0xAAAA");

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("[ rm ] confirm/cancel flow", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await page.addInitScript(() => {
		localStorage.setItem("hi-blue:active-session", "0xAAAA");
	});
	await page.addInitScript(
		new Function(
			seedOkSessionScript("0xAAAA", "2025-03-01T10:00:00.000Z"),
		) as () => void,
	);

	await page.goto("/#/sessions");
	await expect(page.locator("#sessions-screen")).toBeVisible();
	await expect(page.locator(".session-row")).toHaveCount(1);

	// Click [ rm ]
	const row = page.locator('.session-row[data-session-id="0xAAAA"]');
	await row.locator(".ops button", { hasText: "[ rm ]" }).click();

	// Confirm rm and cancel should appear
	await expect(
		row.locator(".ops button", { hasText: "[ confirm rm ]" }),
	).toBeVisible();
	await expect(
		row.locator(".ops button", { hasText: "[ cancel ]" }),
	).toBeVisible();

	// Click cancel — row count stays the same
	await row.locator(".ops button", { hasText: "[ cancel ]" }).click();
	await expect(page.locator(".session-row")).toHaveCount(1);
	await expect(row.locator(".ops button", { hasText: "[ rm ]" })).toBeVisible();

	// Click rm again, then confirm rm
	await row.locator(".ops button", { hasText: "[ rm ]" }).click();
	await row.locator(".ops button", { hasText: "[ confirm rm ]" }).click();

	// Row should be gone
	await expect(page.locator(".session-row")).toHaveCount(0);

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("sessions-icon click → #/sessions", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);

	// Click the [ ls ] button in the header chrome
	const sessionsIcon = page.locator("#sessions-icon");
	await expect(sessionsIcon).toBeVisible();
	await sessionsIcon.click();

	// Should navigate to #/sessions
	await page.waitForURL(/.*#\/sessions/, { timeout: 10_000 });
	await expect(page.locator("#sessions-screen")).toBeVisible();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("sessions-icon toggles back to game on second click", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);
	const sessionsIcon = page.locator("#sessions-icon");

	await sessionsIcon.click();
	await page.waitForURL(/.*#\/sessions/, { timeout: 10_000 });

	await sessionsIcon.click();
	await page.waitForURL(/.*#\/game/, { timeout: 10_000 });
	await expect(page.locator("#composer")).toBeVisible();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("refresh on #/sessions paints banner and topinfo", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);
	await page.locator("#sessions-icon").click();
	await page.waitForURL(/.*#\/sessions/, { timeout: 10_000 });

	await page.reload();
	await expect(page.locator("#sessions-screen")).toBeVisible();
	await expect(page.locator("#banner")).not.toBeEmpty();
	await expect(page.locator("#topinfo-left")).toContainText("SESSION 0x");
	await expect(page.locator("#topinfo-left")).toContainText("PHASE");
	await expect(page.locator("#topinfo-right")).toContainText(
		"connection stable",
	);

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("Escape on #/sessions navigates back to game", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);
	await page.locator("#sessions-icon").click();
	await page.waitForURL(/.*#\/sessions/, { timeout: 10_000 });

	await page.keyboard.press("Escape");
	await page.waitForURL(/.*#\/game/, { timeout: 10_000 });
	await expect(page.locator("#composer")).toBeVisible();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("broken-session banner: active session with missing engine.dat → #/sessions?reason=broken", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Seed an active session that is broken (no engine.dat)
	await page.addInitScript(() => {
		localStorage.setItem("hi-blue:active-session", "0xBROK");
	});
	await page.addInitScript(
		new Function(seedBrokenSessionScript("0xBROK")) as () => void,
	);

	await page.goto("/");

	// Dispatcher should route to #/sessions?reason=broken
	await page.waitForURL(/.*#\/sessions/, { timeout: 10_000 });

	const url = page.url();
	expect(url).toContain("reason=broken");

	// Banner should be visible with the broken copy
	const banner = page.locator("#sessions-banner");
	await expect(banner).toBeVisible();
	await expect(banner).toContainText("unreadable");

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("[ + new session ] flow: click → URL becomes #/start, new active pointer", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Stub LLM for start-screen generation
	await stubNewGameLLM(page, { sse: ["stub reply"] });

	await page.addInitScript(() => {
		localStorage.setItem("hi-blue:active-session", "0xAAAA");
	});
	await page.addInitScript(
		new Function(
			seedOkSessionScript("0xAAAA", "2025-03-01T10:00:00.000Z"),
		) as () => void,
	);

	await page.goto("/#/sessions");
	await expect(page.locator("#sessions-screen")).toBeVisible();

	// Click [ + new session ]
	await page.locator("#sessions-new").click();

	// Should navigate to #/start
	await page.waitForURL(/.*#\/start/, { timeout: 10_000 });
	await expect(page.locator("#start-screen")).toBeVisible();

	// Active pointer should now be a new id (not 0xAAAA)
	const activeId = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(activeId).not.toBe("0xAAAA");
	expect(activeId).toMatch(/^0x[0-9A-Fa-f]{4}$/i);

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
