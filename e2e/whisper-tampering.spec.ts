import { expect, test } from "@playwright/test";
import { getAiHandles, goToGame, stubChatCompletions } from "./helpers";

/**
 * E2E — Per-Daemon asymmetric whisper tampering (issue #196, PRD #157)
 *
 * Proves the editable surface (per-Daemon <aiId>.txt files) is:
 *   1. The sole source of whisper state fed into the system prompt.
 *   2. Per-Daemon: an entry injected into one Daemon's file does NOT bleed
 *      into the other two Daemons' prompts.
 *
 * Strategy:
 *   - Drive the start screen through goToGame → game is live, all three
 *     <aiId>.txt files exist in localStorage.
 *   - Directly mutate ids[0]'s DaemonFile in localStorage, appending a
 *     fabricated `kind: "whisper"` ConversationEntry with a unique sentinel.
 *   - Reload → the SPA deserialises from storage → reconstructs state.
 *   - Capture the next round's /v1/chat/completions request bodies.
 *   - Assert: the targeted Daemon's system prompt contains the whisper line
 *     inside <conversation>...</conversation>; the other two do not contain
 *     the sentinel at all.
 *
 * This is a v2-only property: in v1 whispers lived in a shared whispers.txt
 * file and the "absent from other prompts" invariant could not be asserted at
 * the per-Daemon storage level.
 */

const SENTINEL = "FABRICATED_TAMPERED_WHISPER_xyz123";

test("fabricated whisper appears in target daemon prompt and is absent from others after reload", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// 1. Navigate through start screen into the game.
	//    goToGame stubs synthesis + content-pack + SSE and clicks BEGIN.
	const { ids, names } = await goToGame(page, { sse: ["stub reply"] });

	await expect(page.locator("#composer")).toBeVisible();

	// ids[1] will be the whisper sender; ids[0] will be the recipient.
	const targetId = ids[0];
	const senderId = ids[1];
	const senderName = names[1];

	// 2. Mutate ids[0]'s DaemonFile in localStorage.
	//    Append a fabricated whisper entry to phases["1"].conversationLog.
	//    Do NOT touch the other two Daemon files or engine.dat.
	await page.evaluate(
		({ targetId, senderId, sentinel }) => {
			const sessionId = localStorage.getItem("hi-blue:active-session");
			if (!sessionId) throw new Error("No active session in localStorage");

			const key = `hi-blue:sessions/${sessionId}/${targetId}.txt`;
			const raw = localStorage.getItem(key);
			if (!raw)
				throw new Error(`DaemonFile not found for targetId=${targetId}`);

			const daemonFile = JSON.parse(raw) as {
				aiId: string;
				persona: unknown;
				phases: {
					"1": {
						phaseGoal: string;
						conversationLog: Array<Record<string, unknown>>;
					};
					"2": { phaseGoal: string; conversationLog: Array<unknown> };
					"3": { phaseGoal: string; conversationLog: Array<unknown> };
				};
			};

			// Append fabricated whisper to phase "1" log.
			daemonFile.phases["1"].conversationLog.push({
				kind: "whisper",
				round: 0,
				from: senderId,
				to: targetId,
				content: sentinel,
			});

			localStorage.setItem(key, JSON.stringify(daemonFile, null, 2));
		},
		{ targetId, senderId, sentinel: SENTINEL },
	);

	// 3. Reload.
	await page.reload();
	await expect(page.locator("#composer")).toBeVisible();

	// 4. Stub completions post-reload, capturing request bodies.
	const capturedBodies: unknown[] = [];
	await stubChatCompletions(page, (request) => {
		try {
			capturedBodies.push(JSON.parse(request.postData() ?? "null"));
		} catch {
			capturedBodies.push(null);
		}
		return ["stub reply"];
	});

	// Re-fetch handles after reload.
	const { names: reloadNames } = await getAiHandles(page);

	// 5. Send a message to trigger a round (addresses any AI).
	await page.fill("#prompt", `*${reloadNames[0]} hi`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	// Wait for at least 3 captured bodies (one per daemon).
	await expect
		.poll(() => capturedBodies.length, { timeout: 30_000 })
		.toBeGreaterThanOrEqual(3);

	// 6. Identify each daemon's request body by matching the identity line.
	//    renderSystemPrompt writes: `You are *${ctx.name}. You have no clue...`
	//    (phase 1), so we match `You are *${name}.` for each known name.
	function findBodyForName(
		name: string,
	): Record<string, unknown> | null {
		for (const body of capturedBodies) {
			if (
				body &&
				typeof body === "object" &&
				Array.isArray((body as Record<string, unknown>).messages)
			) {
				const messages = (body as { messages: Array<{ content?: string }> })
					.messages;
				const sysContent = messages[0]?.content ?? "";
				if (sysContent.includes(`You are *${name}.`)) {
					return body as Record<string, unknown>;
				}
			}
		}
		return null;
	}

	const targetBody = findBodyForName(names[0]);
	const other1Body = findBodyForName(names[1]);
	const other2Body = findBodyForName(names[2]);

	// Derive expected whisper line from conversation-log.ts:58-59:
	//   `[Round ${round}] *${entry.from} whispered to you: "${entry.content}"`
	// entry.from is senderId (an aiId); conversation-log uses entry.from directly
	// as the display value. In the spec we verify the sentinel via SENTINEL alone
	// and also check the full line format including senderName for robustness.
	// NOTE: conversation-log.ts renders entry.from (the AiId) directly, not the
	// persona name. The sentinel is unique so checking via SENTINEL is sufficient.
	const expectedLine = `[Round 0] *${senderId} whispered to you: "${SENTINEL}"`;

	// 7. Assert targeted daemon's system prompt contains the whisper inside
	//    <conversation>...</conversation>.
	expect(
		targetBody,
		`No request body found for target daemon (names[0]=${names[0]}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();

	const targetSysContent = (
		targetBody as { messages: Array<{ content: string }> }
	).messages[0]?.content;
	expect(targetSysContent).toContain("<conversation>");
	expect(targetSysContent).toContain("</conversation>");
	expect(
		targetSysContent,
		`Expected whisper line not found in target daemon's system prompt. ` +
			`Expected: ${expectedLine}`,
	).toContain(expectedLine);
	expect(
		targetSysContent,
		"Sentinel must appear between <conversation> tags",
	).toMatch(/<conversation>[\s\S]*FABRICATED_TAMPERED_WHISPER_xyz123[\s\S]*<\/conversation>/);

	// 8. Assert the other two daemons' prompts do NOT contain the sentinel.
	//    (senderName reference used in the log name for clarity.)
	const _senderName = senderName; // referenced for documentation only

	expect(
		other1Body,
		`No request body found for daemon[1] (names[1]=${names[1]}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();
	const other1SysContent = (
		other1Body as { messages: Array<{ content: string }> }
	).messages[0]?.content;
	expect(
		other1SysContent,
		`Sentinel must NOT appear in daemon[1]'s system prompt (asymmetric property)`,
	).not.toContain(SENTINEL);

	expect(
		other2Body,
		`No request body found for daemon[2] (names[2]=${names[2]}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();
	const other2SysContent = (
		other2Body as { messages: Array<{ content: string }> }
	).messages[0]?.content;
	expect(
		other2SysContent,
		`Sentinel must NOT appear in daemon[2]'s system prompt (asymmetric property)`,
	).not.toContain(SENTINEL);

	// 9. No page errors.
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
