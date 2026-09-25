import { expect, type Page, test } from "@playwright/test";
import {
	ENGINE_OBFUSCATION_KEY,
	expectNoPageErrors,
	getAiHandles,
	goToGame,
	stubChatCompletions,
} from "./helpers";

const ROUND_BEYOND_THIS_TEST = 100;

async function injectChatLockoutIntoEngineDat(
	page: Page,
	targetId: string,
): Promise<void> {
	await page.evaluate(
		({ targetId, key, resolveAtRound }) => {
			const sessionId = localStorage.getItem("hi-blue:active-session");
			if (!sessionId) throw new Error("No active session");
			const raw = localStorage.getItem(
				`hi-blue:sessions/${sessionId}/engine.dat`,
			);
			if (!raw) throw new Error("engine.dat missing");

			const keyBytes = Array.from(new TextEncoder().encode(key));
			const iso = atob(raw);
			const decoded = new Uint8Array(
				Array.from(iso).map(
					(c, i) => c.charCodeAt(0) ^ (keyBytes[i % keyBytes.length] ?? 0),
				),
			);
			const json = new TextDecoder("utf-8").decode(decoded);
			const sealed = JSON.parse(json) as {
				activeComplications?: Array<Record<string, unknown>>;
			};

			sealed.activeComplications = [
				...(sealed.activeComplications ?? []),
				{ kind: "chat_lockout", target: targetId, resolveAtRound },
			];

			const newJson = JSON.stringify(sealed);
			const newBytes = Array.from(new TextEncoder().encode(newJson));
			const xored = newBytes.map(
				(b, i) => b ^ (keyBytes[i % keyBytes.length] ?? 0),
			);
			let out = "";
			for (const b of xored) out += String.fromCharCode(b);
			localStorage.setItem(
				`hi-blue:sessions/${sessionId}/engine.dat`,
				btoa(out),
			);
		},
		{
			targetId,
			key: ENGINE_OBFUSCATION_KEY,
			resolveAtRound: ROUND_BEYOND_THIS_TEST,
		},
	);
}

test("a lockout restored from storage mutes the panel before any typing, disables send for that AI, and is silent to the player", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { ids } = await goToGame(page, { sse: ["greetings"] });

	await injectChatLockoutIntoEngineDat(page, ids[0]);

	await page.reload();
	await stubChatCompletions(page, ["greetings"]);
	await expect(page.locator("#composer")).toBeVisible();

	const { names: reloadNames } = await getAiHandles(page);

	const lockedPanel = page.locator(`.ai-panel[data-ai="${ids[0]}"]`);
	await expect(lockedPanel).toHaveClass(/panel--locked/);
	await expect(lockedPanel).toHaveAttribute("aria-disabled", "true");

	await page.fill("#prompt", `*${reloadNames[0]} hi`);
	await expect(page.locator("#send")).toBeDisabled();

	const lockedTranscript = page.locator(`[data-transcript="${ids[0]}"]`);
	await expect(lockedTranscript).not.toContainText("unresponsive");

	await page.fill("#prompt", `*${reloadNames[1]} hi`);
	await expect(page.locator("#send")).toBeEnabled();

	await expectNoPageErrors(page, pageErrors);
});
