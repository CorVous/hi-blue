/**
 * sessions-picker.spec.ts
 *
 * Playwright e2e tests for the sessions picker.
 *
 * Covers:
 *  - Picker rendering for ok / broken / version-mismatch row states
 *  - [ load ] flow: picker → game view → topinfo shows session id
 *  - [ dup ] flow: picker → two rows, active pointer unchanged
 *  - [ rm ] confirm/cancel flow
 *  - Sessions-icon ([ ls ] button) click → sessions view
 *  - Broken-session banner: active session with missing engine.dat → sessions view with reason
 *  - [ + new session ] flow: picker → start view, new active pointer
 *
 * Post-ADR-0011: the picker is opened by clicking the sessions icon, not by
 * navigating to a URL. Sticky for broken / version-mismatch active sessions.
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
				epoch: 1,
				round: 0,
				personaOrder: ['red'],
			});
			localStorage.setItem(prefix + 'meta.json', meta);

			// Daemon file: flat DaemonFile shape (v6+)
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
				conversationLog: [],
			});
			localStorage.setItem(prefix + 'red.txt', daemonFile);

			// Build engine.dat via inline obfuscation — payload must match SealedEngine v7
			const OBFUSCATION_KEY = '${OBFUSCATION_KEY}';
			const keyBytes = Array.from(new TextEncoder().encode(OBFUSCATION_KEY));
			const stubLandmarks = {
				north: { shortName: 'Ridge', horizonPhrase: 'A distant ridge.' },
				south: { shortName: 'Hills', horizonPhrase: 'Rolling hills.' },
				east: { shortName: 'Tower', horizonPhrase: 'A stone tower.' },
				west: { shortName: 'Forest', horizonPhrase: 'A dark forest.' },
			};
			const stubPack = {
				setting: 'test setting',
				weather: 'clear',
				timeOfDay: 'morning',
				objectivePairs: [],
				interestingObjects: [],
				obstacles: [],
				aiStarts: {},
				landmarks: stubLandmarks,
			};
			const payload = JSON.stringify({
				schemaVersion: 8,
				isComplete: false,
				world: { entities: [] },
				budgets: { red: { remaining: 50, total: 50 } },
				lockedOut: [],
				personaSpatial: { red: { position: { row: 2, col: 2 }, facing: 'north' } },
				contentPacksA: [stubPack],
				contentPacksB: [{ ...stubPack, setting: 'test setting B' }],
				activePackId: 'A',
				weather: 'clear',
				objectives: [],
				complicationSchedule: { countdown: 5, settingShiftFired: false },
				activeComplications: [],
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
				epoch: 1,
				round: 0,
			});
			localStorage.setItem(prefix + 'meta.json', meta);
			localStorage.setItem(prefix + 'red.txt', '{}');
			// Intentionally omit engine.dat
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
				epoch: 1,
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

	await page.goto("/");
	// Open the picker by clicking the sessions icon (active session is "ok",
	// so the dispatcher's natural view is "game" — picker opens on top).
	await page.locator("#sessions-icon").click();
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

test("[ load ] flow: click load on non-active row → game view", async ({
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

	await page.goto("/");
	await page.locator("#sessions-icon").click();
	await expect(page.locator("#sessions-screen")).toBeVisible();

	// Click load on session BBBB (non-active)
	const rowB = page.locator('.session-row[data-session-id="0xBBBB"]');
	await rowB.locator(".ops button", { hasText: "[ load ]" }).click();

	// Should transition to the game view
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});

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

	await page.goto("/");
	await page.locator("#sessions-icon").click();
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

	await page.goto("/");
	await page.locator("#sessions-icon").click();
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

test("sessions-icon click → sessions view", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);

	// Click the [ ls ] button in the header chrome
	const sessionsIcon = page.locator("#sessions-icon");
	await expect(sessionsIcon).toBeVisible();
	await sessionsIcon.click();

	// Should transition to the sessions view
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached({
		timeout: 10_000,
	});
	await expect(page.locator("#sessions-screen")).toBeVisible();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("sessions-icon toggles back to game on second click", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);
	const sessionsIcon = page.locator("#sessions-icon");

	await sessionsIcon.click();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached({
		timeout: 10_000,
	});

	await sessionsIcon.click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});
	await expect(page.locator("#composer")).toBeVisible();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("refresh while picker is open lands on the game view (picker state is in-memory)", async ({
	page,
}) => {
	// Post-ADR-0011: pickerOpen lives in memory only, so a refresh drops it
	// and the dispatcher's natural view (game, given the populated active
	// session) takes over. The chrome must still paint on the game view.
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);
	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached({
		timeout: 10_000,
	});

	await page.reload();
	// After reload, the game view is restored from storage.
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#composer")).toBeVisible();
	await expect(page.locator("#banner")).not.toBeEmpty();
	await expect(page.locator("#topinfo-left")).toContainText("SESSION 0x");
	await expect(page.locator("#topinfo-left")).toContainText("EPOCH");
	await expect(page.locator("#topinfo-right")).toContainText(
		"connection stable",
	);

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("Escape on the picker returns to the game view", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);
	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached({
		timeout: 10_000,
	});

	await page.keyboard.press("Escape");
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});
	await expect(page.locator("#composer")).toBeVisible();

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("broken-session banner: active session with missing engine.dat → sessions view with reason", async ({
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

	// Dispatcher routes broken sessions to the picker with reason=broken (sticky).
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached({
		timeout: 10_000,
	});
	await expect(page.locator("main")).toHaveAttribute("data-reason", "broken");

	// Banner should be visible with the broken copy
	const banner = page.locator("#sessions-banner");
	await expect(banner).toBeVisible();
	await expect(banner).toContainText("unreadable");

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("[ + new session ] flow: click → start view, new active pointer", async ({
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

	await page.goto("/");
	await page.locator("#sessions-icon").click();
	await expect(page.locator("#sessions-screen")).toBeVisible();

	// Click [ + new session ]
	await page.locator("#sessions-new").click();

	// Should transition to the start view
	await expect(page.locator('main[data-view="start"]')).toBeAttached({
		timeout: 10_000,
	});
	await expect(page.locator("#start-screen")).toBeVisible();

	// Active pointer should now be a new id (not 0xAAAA)
	const activeId = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(activeId).not.toBe("0xAAAA");
	expect(activeId).toMatch(/^0x[0-9A-Fa-f]{4}$/i);

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
