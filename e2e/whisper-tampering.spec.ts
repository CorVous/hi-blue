import { expect, test } from "@playwright/test";
import { getAiHandles, goToGame, stubChatCompletions } from "./helpers";

/**
 * E2E — Per-Daemon asymmetric message tampering (issue #213)
 *
 * Proves the editable surface (per-Daemon <aiId>.txt files) is:
 *   1. The sole source of message state fed into the system prompt.
 *   2. Per-Daemon: an entry injected into one Daemon's file does NOT bleed
 *      into the other two Daemons' prompts.
 *
 * Strategy:
 *   - Drive the start screen through goToGame → game is live, all three
 *     <aiId>.txt files exist in localStorage.
 *   - Directly mutate ids[0]'s DaemonFile in localStorage, appending a
 *     fabricated `kind: "message"` ConversationEntry with a unique sentinel.
 *   - Reload → the SPA deserialises from storage → reconstructs state.
 *   - Capture the next round's /v1/chat/completions request bodies.
 *   - Assert: the targeted Daemon's system prompt contains the message line
 *     inside <conversation>...</conversation>; the other two do not contain
 *     the sentinel at all.
 *
 * This is a per-Daemon property: entries injected into one Daemon's file
 * do not appear in other Daemons' prompts.
 */

const SENTINEL = "FABRICATED_TAMPERED_WHISPER_xyz123";

test("fabricated message appears in target daemon prompt and is absent from others after reload", async ({
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

			// Append fabricated message entry to phase "1" log.
			daemonFile.phases["1"].conversationLog.push({
				kind: "message",
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
	//    renderSystemPrompt writes: `You are *${ctx.name}, a Daemon. You have no clue...`
	//    (phase 1), so we match `You are *${name}, a Daemon.` for each known name.
	function findBodyForName(name: string): Record<string, unknown> | null {
		for (const body of capturedBodies) {
			if (
				body &&
				typeof body === "object" &&
				Array.isArray((body as Record<string, unknown>).messages)
			) {
				const messages = (body as { messages: Array<{ content?: string }> })
					.messages;
				const sysContent = messages[0]?.content ?? "";
				if (sysContent.includes(`You are *${name}, a Daemon.`)) {
					return body as Record<string, unknown>;
				}
			}
		}
		return null;
	}

	const targetBody = findBodyForName(names[0]);
	const other1Body = findBodyForName(names[1]);
	const other2Body = findBodyForName(names[2]);

	// Conversation rendering moved out of the system prompt into role turns
	// (prompt-cache restructure). Incoming peer messages are rendered as
	// `*<from>: <content>` user turns by openai-message-builder. The sentinel
	// uniquely identifies the fabricated whisper.
	const expectedLine = `*${senderId}: ${SENTINEL}`;
	const _senderName = senderName; // referenced for log clarity only

	function flattenContents(body: Record<string, unknown> | null): string {
		if (!body) return "";
		const messages = (body as { messages: Array<{ content?: unknown }> })
			.messages;
		return messages
			.map((m) => (typeof m.content === "string" ? m.content : ""))
			.join("\n");
	}

	// 7. Assert targeted daemon's role turns contain the whisper.
	expect(
		targetBody,
		`No request body found for target daemon (names[0]=${names[0]}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();

	const targetAllContent = flattenContents(targetBody);
	expect(
		targetAllContent,
		`Expected message line not found in target daemon's role turns. ` +
			`Expected: ${expectedLine}`,
	).toContain(expectedLine);

	// 8. Assert the other two daemons' messages do NOT contain the sentinel.
	expect(
		other1Body,
		`No request body found for daemon[1] (names[1]=${names[1]}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();
	expect(
		flattenContents(other1Body),
		`Sentinel must NOT appear in daemon[1]'s messages (asymmetric property)`,
	).not.toContain(SENTINEL);

	expect(
		other2Body,
		`No request body found for daemon[2] (names[2]=${names[2]}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();
	expect(
		flattenContents(other2Body),
		`Sentinel must NOT appear in daemon[2]'s messages (asymmetric property)`,
	).not.toContain(SENTINEL);

	// 9. No page errors.
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
