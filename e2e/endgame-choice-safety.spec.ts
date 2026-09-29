import { expect, type Page, test } from "@playwright/test";
import {
	classifyJsonRequest,
	expectNoPageErrors,
	goToGame,
	parseRequestBody,
	pickerOkSessionFiles,
} from "./helpers";

const SESSION_B = "0xBBBB";
const NEW_ROOM_SETTLE_MS = 1_000;

async function reachEndgame(page: Page): Promise<string> {
	const { names } = await goToGame(page, {
		url: "/?winImmediately=1",
		sse: ["hello"],
	});
	await page.fill("#prompt", `*${names[0]} hello`);
	await page.click("#send");
	await expect(page.locator("#endgame")).toBeVisible({ timeout: 15_000 });
	const endedSessionId = await activeSessionId(page);
	if (endedSessionId === null) throw new Error("e2e: no active session");
	return endedSessionId;
}

function activeSessionId(page: Page): Promise<string | null> {
	return page.evaluate(() => localStorage.getItem("hi-blue:active-session"));
}

function listSessionIds(page: Page, prefix: string): Promise<string[]> {
	return page.evaluate((storagePrefix) => {
		const ids = new Set<string>();
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key?.startsWith(storagePrefix)) continue;
			const id = key.slice(storagePrefix.length).split("/")[0];
			if (id) ids.add(id);
		}
		return [...ids].sort();
	}, prefix);
}

async function seedSessionB(page: Page): Promise<void> {
	await page.evaluate(
		({ id, files }) => {
			for (const [name, content] of Object.entries(files)) {
				localStorage.setItem(`hi-blue:sessions/${id}/${name}`, content);
			}
		},
		{ id: SESSION_B, files: pickerOkSessionFiles("2025-02-01T10:00:00.000Z") },
	);
}

function readSessionBFiles(page: Page): Promise<string[]> {
	return page.evaluate((id) => {
		const prefix = `hi-blue:sessions/${id}/`;
		return ["meta.json", "red.txt", "engine.dat"].map(
			(name) => localStorage.getItem(prefix + name) ?? "",
		);
	}, SESSION_B);
}

async function holdNewRoomGeneration(page: Page) {
	let requests = 0;
	let release: () => void = () => undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/v1/chat/completions", async (route, request) => {
		if (
			classifyJsonRequest(parseRequestBody(request)) === "dual-content-pack"
		) {
			requests++;
			await released;
		}
		await route.fallback();
	});
	return { release: () => release(), requestCount: () => requests };
}

async function loadSessionBFromPicker(page: Page): Promise<void> {
	await page.locator("#sessions-icon").click();
	const rowB = page.locator(`.session-row[data-session-id="${SESSION_B}"]`);
	await rowB.locator(".ops button", { hasText: "[ load ]" }).click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached();
	await expect(page.locator("#panels")).toContainText("Red");
}

for (const choice of [
	{ name: "Same daemons", button: "#endgame-same-daemons-btn" },
	{ name: "Continue", button: "#endgame-continue-btn" },
]) {
	test(`${choice.name} leaves a session the player loaded meanwhile untouched`, async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));
		await page.addInitScript(() => {
			localStorage.setItem("openrouter_key", "sk-or-test-key");
		});

		const endedSessionId = await reachEndgame(page);
		await seedSessionB(page);
		const sessionBBefore = await readSessionBFiles(page);
		const generation = await holdNewRoomGeneration(page);

		await page.locator(choice.button).click();
		await expect.poll(generation.requestCount).toBeGreaterThan(0);
		await loadSessionBFromPicker(page);

		const newRoomServed = page.waitForResponse((response) =>
			response.url().endsWith("/v1/chat/completions"),
		);
		generation.release();
		await newRoomServed;
		await page.waitForTimeout(NEW_ROOM_SETTLE_MS);

		expect(await activeSessionId(page)).toBe(SESSION_B);
		expect(await readSessionBFiles(page)).toEqual(sessionBBefore);
		expect(await listSessionIds(page, "hi-blue:sessions/")).toEqual(
			[endedSessionId, SESSION_B].sort(),
		);
		expect(await listSessionIds(page, "hi-blue:archive/")).toEqual([]);
		await expect(page.locator('main[data-view="game"]')).toBeAttached();
		await expect(page.locator("#endgame")).toBeHidden();

		await expectNoPageErrors(page, pageErrors);
	});
}

for (const choice of [
	{ name: "New daemons", button: "#endgame-new-daemons-btn" },
	{ name: "Same daemons", button: "#endgame-same-daemons-btn" },
]) {
	test(`${choice.name} keeps the finished game and shows why when archiving fails`, async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		const endedSessionId = await reachEndgame(page);
		await page.evaluate((id) => {
			localStorage.setItem(`hi-blue:sessions/${id}/saving`, "stuck");
		}, endedSessionId);

		await page.locator(choice.button).click();

		await expect(page.locator("#endgame-choice-status")).toContainText(
			"could not archive this game",
			{ timeout: 15_000 },
		);
		await expect(page.locator(choice.button)).toBeEnabled();
		await expect(page.locator("#endgame")).toBeVisible();
		expect(await activeSessionId(page)).toBe(endedSessionId);
		expect(await listSessionIds(page, "hi-blue:sessions/")).toEqual([
			endedSessionId,
		]);

		await expectNoPageErrors(page, pageErrors);
	});
}
