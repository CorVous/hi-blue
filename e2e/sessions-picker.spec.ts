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
 *  - Version-mismatch banner: active session with a stale schema → sessions view with reason
 *  - Version-mismatch archived-build note (banner + picker row): a session
 *    stamped with the retired schema 11 (mapped to `0.0.2-beta.2` in
 *    SCHEMA_ARCHIVE_MAP) links to `./v/0.0.2-beta.2/`; an unmapped schema
 *    (999) keeps the plain mismatch copy and adds no note.
 *  - [ + new session ] flow: picker → start view, new active pointer
 *
 * Post-ADR-0011: the picker is opened by clicking the sessions icon, not by
 * navigating to a URL. Sticky for broken / version-mismatch active sessions.
 */
import { expect, test } from "@playwright/test";
import {
	expectNoPageErrors,
	goToGame,
	obfuscateEngineBlob,
	pickerOkSessionSeedScript,
	stubNewGameLLM,
} from "./helpers";

// ── Session seed helpers ──────────────────────────────────────────────────────

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
 * Defaults to schema 999 (no archive-map entry); pass 11 to seed the retired
 * pre-v12 schema, which the live build maps to the archived `0.0.2-beta.2`.
 */
function seedVersionMismatchScript(id: string, schemaVersion = 999): string {
	const engineDat = obfuscateEngineBlob(JSON.stringify({ schemaVersion }));
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

			// engine.dat sealed with schemaVersion=${schemaVersion} (mismatch)
			localStorage.setItem(prefix + 'engine.dat', '${engineDat}');
		})();
	`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/**
 * Recompute the engine.dat bytes `seedVersionMismatchScript` writes, so a test
 * can prove the mismatch route left the stored bytes untouched.
 */
function expectedSeededEngineBytes(schemaVersion: number): string {
	return obfuscateEngineBlob(JSON.stringify({ schemaVersion }));
}

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
			pickerOkSessionSeedScript("0xAAAA", "2025-03-01T10:00:00.000Z"),
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

	await expectNoPageErrors(page, pageErrors);
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
			pickerOkSessionSeedScript("0xAAAA", "2025-03-01T10:00:00.000Z"),
		) as () => void,
	);
	await page.addInitScript(
		new Function(
			pickerOkSessionSeedScript("0xBBBB", "2025-02-01T10:00:00.000Z"),
		) as () => void,
	);

	await page.goto("/");
	await page.locator("#sessions-icon").click();
	await expect(page.locator("#sessions-screen")).toBeVisible();

	// Click load on session BBBB (non-active)
	const rowB = page.locator('.session-row[data-session-id="0xBBBB"]');
	await rowB.locator(".ops button", { hasText: "[ load ]" }).click();

	// Should transition to the game view
	await expect(page.locator('main[data-view="game"]')).toBeAttached();

	// Active session should be BBBB
	const activeId = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(activeId).toBe("0xBBBB");

	await expectNoPageErrors(page, pageErrors);
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
			pickerOkSessionSeedScript("0xAAAA", "2025-03-01T10:00:00.000Z"),
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

	await expectNoPageErrors(page, pageErrors);
});

test("[ rm ] confirm/cancel flow", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await page.addInitScript(() => {
		localStorage.setItem("hi-blue:active-session", "0xAAAA");
	});
	await page.addInitScript(
		new Function(
			pickerOkSessionSeedScript("0xAAAA", "2025-03-01T10:00:00.000Z"),
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

	await expectNoPageErrors(page, pageErrors);
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
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await expect(page.locator("#sessions-screen")).toBeVisible();

	await expectNoPageErrors(page, pageErrors);
});

test("sessions-icon toggles back to game on second click", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);
	const sessionsIcon = page.locator("#sessions-icon");

	await sessionsIcon.click();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();

	await sessionsIcon.click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#composer")).toBeVisible();

	await expectNoPageErrors(page, pageErrors);
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
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();

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

	await expectNoPageErrors(page, pageErrors);
});

test("Escape on the picker returns to the game view", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);
	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();

	await page.keyboard.press("Escape");
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#composer")).toBeVisible();

	await expectNoPageErrors(page, pageErrors);
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
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await expect(page.locator("main")).toHaveAttribute("data-reason", "broken");

	// Banner should be visible with the broken copy
	const banner = page.locator("#sessions-banner");
	await expect(banner).toBeVisible();
	await expect(banner).toContainText("unreadable");

	await expectNoPageErrors(page, pageErrors);
});

test("version-mismatch banner: active session with stale schema → sessions view with reason", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Seed an active session whose sealed schema is stale (999) so the
	// active-session dispatcher reports a version-mismatch.
	await page.addInitScript(() => {
		localStorage.setItem("hi-blue:active-session", "0xSTAL");
	});
	await page.addInitScript(
		new Function(seedVersionMismatchScript("0xSTAL")) as () => void,
	);

	await page.goto("/");

	// Dispatcher routes version-mismatch sessions to the picker with
	// reason=version-mismatch (sticky).
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await expect(page.locator("main")).toHaveAttribute(
		"data-reason",
		"version-mismatch",
	);

	// Banner should be visible with the version-mismatch copy. Schema 999 is
	// not in the archive map, so the banner shows the plain "older version"
	// text rather than an archived-build link.
	const banner = page.locator("#sessions-banner");
	await expect(banner).toBeVisible();
	await expect(banner).toContainText("It has been kept");

	await expectNoPageErrors(page, pageErrors);
});

test("version-mismatch archive link: a session stamped with retired schema 11 links to the archived build", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Schema 11 is the last schema shipped by the released build
	// (0.0.2-beta.2) and is mapped in SCHEMA_ARCHIVE_MAP, so a save stamped 11
	// must surface as a mismatch that links to that archived build instead of
	// being rewritten.
	await page.addInitScript(() => {
		localStorage.setItem("hi-blue:active-session", "0xV11X");
	});
	await page.addInitScript(
		new Function(seedVersionMismatchScript("0xV11X", 11)) as () => void,
	);

	await page.goto("/");

	// Same sticky routing as any other version-mismatch active session.
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await expect(page.locator("main")).toHaveAttribute(
		"data-reason",
		"version-mismatch",
	);

	// Banner offers the archived build.
	const banner = page.locator("#sessions-banner");
	await expect(banner).toBeVisible();
	await expect(banner).toContainText("Continue it in");
	await expect(banner.locator("a")).toHaveAttribute(
		"href",
		"./v/0.0.2-beta.2/",
	);

	// The picker row carries the same link note, with no [ load ] button.
	const row = page.locator('.session-row[data-session-id="0xV11X"]');
	await expect(row.locator(".tag-version-mismatch")).toBeVisible();
	const note = row.locator(".session-version-note");
	await expect(note).toContainText("v0.0.2-beta.2");
	await expect(note.locator("a")).toHaveAttribute("href", "./v/0.0.2-beta.2/");
	await expect(row.locator(".ops button", { hasText: "[ load ]" })).toHaveCount(
		0,
	);

	// The save's bytes are preserved byte-for-byte, not rewritten or removed.
	const engineAfter = await page.evaluate(() =>
		localStorage.getItem("hi-blue:sessions/0xV11X/engine.dat"),
	);
	expect(engineAfter).toBe(expectedSeededEngineBytes(11));
	const daemonAfter = await page.evaluate(() =>
		localStorage.getItem("hi-blue:sessions/0xV11X/red.txt"),
	);
	expect(daemonAfter).toBe("{}");

	await expectNoPageErrors(page, pageErrors);
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
			pickerOkSessionSeedScript("0xAAAA", "2025-03-01T10:00:00.000Z"),
		) as () => void,
	);

	await page.goto("/");
	await page.locator("#sessions-icon").click();
	await expect(page.locator("#sessions-screen")).toBeVisible();

	// Click [ + new session ]
	await page.locator("#sessions-new").click();

	// Should transition to the start view
	await expect(page.locator('main[data-view="start"]')).toBeAttached();
	await expect(page.locator("#start-screen")).toBeVisible();

	// Active pointer should now be a new id (not 0xAAAA)
	const activeId = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(activeId).not.toBe("0xAAAA");
	expect(activeId).toMatch(/^0x[0-9A-Fa-f]{4}$/i);

	await expectNoPageErrors(page, pageErrors);
});
