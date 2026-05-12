import { expect, test } from "@playwright/test";
import { getAiHandles, goToGame, stubChatCompletions } from "./helpers";

// XOR obfuscation key for engine.dat (matches sealed-blob-codec.ts)
const OBFUSCATION_KEY = "hi-blue:engine/v1@kJvN3pX8wQmR2sZt";

test("chat lockout disables send for locked-out AI and is silent to player", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// 1. Boot game — chat lockout is now complication-driven, not a URL affordance.
	const { ids } = await goToGame(page, { sse: ["greetings"] });

	// 2. Inject a chat_lockout complication for ids[0] directly into engine.dat.
	//    This simulates the complication engine having fired a lockout mid-game.
	await page.evaluate(
		({ targetId, key }) => {
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
				{ kind: "chat_lockout", target: targetId, resolveAtRound: 100 },
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
		{ targetId: ids[0], key: OBFUSCATION_KEY },
	);

	// 3. Reload so the game restores the injected lockout from storage.
	await page.reload();
	await stubChatCompletions(page, ["greetings"]);
	await expect(page.locator("#composer")).toBeVisible();

	const { names: reloadNames } = await getAiHandles(page);

	// 4. Typing *<locked AI> should disable Send.
	await page.fill("#prompt", `*${reloadNames[0]} hi`);
	await expect(page.locator("#send")).toBeDisabled();

	// 5. Lockout is silent — no in-character lockout line in the transcript.
	const firstTranscript = page.locator(`[data-transcript="${ids[0]}"]`);
	await expect(firstTranscript).not.toContainText("unresponsive");

	// 6. Addressing a non-locked AI still enables Send.
	await page.fill("#prompt", `*${reloadNames[1]} hi`);
	await expect(page.locator("#send")).toBeEnabled();

	// No page errors.
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
