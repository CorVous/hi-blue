import { expect, test } from "@playwright/test";
import {
	expectNoPageErrors,
	goToGame,
	obfuscateEngineBlob,
	pickerOkSessionSeedScript,
	stubNewGameLLM,
} from "./helpers";

const SCHEMA_WITHOUT_ARCHIVE_ENTRY = 999;

const RETIRED_SCHEMA_WITH_ARCHIVED_BUILD = 11;

const ARCHIVED_BUILD_VERSION = "0.0.2-beta.2";

const ARCHIVED_BUILD_HREF = `./v/${ARCHIVED_BUILD_VERSION}/`;

function seedSessionWithoutEngineDatScript(id: string): string {
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
		})();
	`;
}

function seedVersionMismatchScript(
	id: string,
	schemaVersion = SCHEMA_WITHOUT_ARCHIVE_ENTRY,
): string {
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
			localStorage.setItem(prefix + 'engine.dat', '${engineDat}');
		})();
	`;
}

function expectedSeededEngineBytes(schemaVersion: number): string {
	return obfuscateEngineBlob(JSON.stringify({ schemaVersion }));
}

test("picker renders ok/broken/version-mismatch rows with correct tags and buttons", async ({
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
	await page.addInitScript(
		new Function(seedSessionWithoutEngineDatScript("0xBBBB")) as () => void,
	);
	await page.addInitScript(
		new Function(seedVersionMismatchScript("0xCCCC")) as () => void,
	);

	await page.goto("/");
	await page.locator("#sessions-icon").click();
	await expect(page.locator("#sessions-screen")).toBeVisible();

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

	const brokenRow = page.locator('.session-row[data-session-id="0xBBBB"]');
	await expect(brokenRow).toBeVisible();
	await expect(brokenRow.locator(".tag-corrupt")).toBeVisible();
	await expect(
		brokenRow.locator(".ops button", { hasText: "[ rm ]" }),
	).toBeVisible();
	await expect(
		brokenRow.locator(".ops button", { hasText: "[ load ]" }),
	).not.toBeVisible();

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

	const rowB = page.locator('.session-row[data-session-id="0xBBBB"]');
	await rowB.locator(".ops button", { hasText: "[ load ]" }).click();

	await expect(page.locator('main[data-view="game"]')).toBeAttached();

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

	await expect(page.locator(".session-row")).toHaveCount(1);

	const rowA = page.locator('.session-row[data-session-id="0xAAAA"]');
	await rowA.locator(".ops button", { hasText: "[ dup ]" }).click();

	await expect(page.locator(".session-row")).toHaveCount(2);

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

	const row = page.locator('.session-row[data-session-id="0xAAAA"]');
	await row.locator(".ops button", { hasText: "[ rm ]" }).click();

	await expect(
		row.locator(".ops button", { hasText: "[ confirm rm ]" }),
	).toBeVisible();
	await expect(
		row.locator(".ops button", { hasText: "[ cancel ]" }),
	).toBeVisible();

	await row.locator(".ops button", { hasText: "[ cancel ]" }).click();
	await expect(page.locator(".session-row")).toHaveCount(1);
	await expect(row.locator(".ops button", { hasText: "[ rm ]" })).toBeVisible();

	await row.locator(".ops button", { hasText: "[ rm ]" }).click();
	await row.locator(".ops button", { hasText: "[ confirm rm ]" }).click();

	await expect(page.locator(".session-row")).toHaveCount(0);

	await expectNoPageErrors(page, pageErrors);
});

test("sessions-icon click → sessions view", async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);

	const sessionsIcon = page.locator("#sessions-icon");
	await expect(sessionsIcon).toBeVisible();
	await sessionsIcon.click();

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
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await goToGame(page);
	await page.locator("#sessions-icon").click();
	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();

	await page.reload();
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

	await page.addInitScript(() => {
		localStorage.setItem("hi-blue:active-session", "0xBROK");
	});
	await page.addInitScript(
		new Function(seedSessionWithoutEngineDatScript("0xBROK")) as () => void,
	);

	await page.goto("/");

	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await expect(page.locator("main")).toHaveAttribute("data-reason", "broken");

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

	await page.addInitScript(() => {
		localStorage.setItem("hi-blue:active-session", "0xSTAL");
	});
	await page.addInitScript(
		new Function(seedVersionMismatchScript("0xSTAL")) as () => void,
	);

	await page.goto("/");

	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await expect(page.locator("main")).toHaveAttribute(
		"data-reason",
		"version-mismatch",
	);

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

	await page.addInitScript(() => {
		localStorage.setItem("hi-blue:active-session", "0xV11X");
	});
	await page.addInitScript(
		new Function(
			seedVersionMismatchScript("0xV11X", RETIRED_SCHEMA_WITH_ARCHIVED_BUILD),
		) as () => void,
	);

	await page.goto("/");

	await expect(page.locator('main[data-view="sessions"]')).toBeAttached();
	await expect(page.locator("main")).toHaveAttribute(
		"data-reason",
		"version-mismatch",
	);

	const banner = page.locator("#sessions-banner");
	await expect(banner).toBeVisible();
	await expect(banner).toContainText("Continue it in");
	await expect(banner.locator("a")).toHaveAttribute(
		"href",
		ARCHIVED_BUILD_HREF,
	);

	const row = page.locator('.session-row[data-session-id="0xV11X"]');
	await expect(row.locator(".tag-version-mismatch")).toBeVisible();
	const note = row.locator(".session-version-note");
	await expect(note).toContainText(`v${ARCHIVED_BUILD_VERSION}`);
	await expect(note.locator("a")).toHaveAttribute("href", ARCHIVED_BUILD_HREF);
	await expect(row.locator(".ops button", { hasText: "[ load ]" })).toHaveCount(
		0,
	);

	const engineAfter = await page.evaluate(() =>
		localStorage.getItem("hi-blue:sessions/0xV11X/engine.dat"),
	);
	expect(engineAfter).toBe(
		expectedSeededEngineBytes(RETIRED_SCHEMA_WITH_ARCHIVED_BUILD),
	);
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

	await page.locator("#sessions-new").click();

	await expect(page.locator('main[data-view="start"]')).toBeAttached();
	await expect(page.locator("#start-screen")).toBeVisible();

	const activeId = await page.evaluate(() =>
		localStorage.getItem("hi-blue:active-session"),
	);
	expect(activeId).not.toBe("0xAAAA");
	expect(activeId).toMatch(/^0x[0-9A-Fa-f]{4}$/i);

	await expectNoPageErrors(page, pageErrors);
});
