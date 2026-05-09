import { expect, test } from "@playwright/test";
import { getAiHandles, goToGame, stubChatCompletions } from "./helpers";

/**
 * E2E — Witnessed-event reload survival (issue #196, PRD #157)
 *
 * Proves the per-Daemon storage shape from #195 preserves
 * `kind: "witnessed-event"` entries across a page reload.
 *
 * Strategy:
 *   1. Drive the start screen through goToGame → game is live, all three
 *      <aiId>.txt DaemonFiles exist in localStorage.
 *   2. Directly inject a `kind: "witnessed-event"` entry into ids[1]'s
 *      (the witness's) DaemonFile, simulating what dispatcher.ts:460-493
 *      would write when it fans out a cone-visible physical action.
 *      The actor is ids[0]; the action is `go { direction: "north" }`.
 *   3. Reload → the SPA deserialises from storage → reconstructs state.
 *   4. Capture the next round's /v1/chat/completions request bodies.
 *   5. Assert: the witness's system prompt contains the witnessed-event line
 *      inside <conversation>...</conversation>.
 *   6. Assert: the actor's system prompt does NOT contain the witnessed-event
 *      line (actors get a private tool-result string, not a witnessed-event
 *      entry — the write-time fan-out only targets witnesses).
 *
 * The injection bypasses the game engine to avoid spatial-state layout luck
 * (the stub content pack returns aiStarts:{}, giving daemons no positions,
 * so live `go` tool calls would fail dispatcher validation). It still exercises
 * the full deserialization and prompt-rendering path from per-Daemon DaemonFile
 * → conversationLogs → buildConversationLog → <conversation> block, which is
 * the v2-only property: in v1 there was no per-Daemon storage for
 * witnessed-events.
 *
 * Key source references:
 *   src/spa/game/conversation-log.ts:63-65 — witnessed-event "go" line format
 *   src/spa/game/dispatcher.ts:460-493     — write-time cone fan-out
 *   src/spa/persistence/session-codec.ts:351-357 — DaemonFile round-trip
 */

test("fabricated witnessed-event entry survives reload and appears in witness system prompt", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// ── 1. Boot game ──────────────────────────────────────────────────────────
	const { ids, names } = await goToGame(page, { sse: ["stub reply"] });

	await expect(page.locator("#composer")).toBeVisible();

	// ids[0] = actor; ids[1] = witness; ids[2] = bystander (untouched)
	const actorId = ids[0];
	const witnessId = ids[1];
	const witnessName = names[1];
	const DIRECTION = "north";

	// ── 2. Inject a witnessed-event entry into the witness's DaemonFile ───────
	// This simulates what dispatcher.ts:460-493 would write when the actor
	// does `go { direction: "north" }` and the actor's post-move cell falls
	// inside the witness's 5-cell cone.
	await page.evaluate(
		({
			witnessId,
			actorId,
			direction,
		}: {
			witnessId: string;
			actorId: string;
			direction: string;
		}) => {
			const sessionId = localStorage.getItem("hi-blue:active-session");
			if (!sessionId) throw new Error("No active session in localStorage");

			const key = `hi-blue:sessions/${sessionId}/${witnessId}.txt`;
			const raw = localStorage.getItem(key);
			if (!raw)
				throw new Error(`DaemonFile not found for witnessId=${witnessId}`);

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

			// Append a fabricated witnessed-event to phase "1" log.
			// Shape matches dispatcher.ts:473-491 witness entry construction.
			daemonFile.phases["1"].conversationLog.push({
				kind: "witnessed-event",
				round: 1,
				actor: actorId,
				actionKind: "go",
				direction,
			});

			localStorage.setItem(key, JSON.stringify(daemonFile, null, 2));
		},
		{ witnessId, actorId, direction: DIRECTION },
	);

	// ── 3. Reload ──────────────────────────────────────────────────────────────
	await page.reload();
	await expect(page.locator("#composer")).toBeVisible();

	// ── 4. Stub completions post-reload; capture request bodies ───────────────
	const capturedBodies: unknown[] = [];
	await stubChatCompletions(page, (request) => {
		try {
			capturedBodies.push(JSON.parse(request.postData() ?? "null"));
		} catch {
			capturedBodies.push(null);
		}
		return ["stub reply"];
	});

	const { names: reloadNames } = await getAiHandles(page);

	// ── 5. Trigger a round; wait for 3+ bodies ─────────────────────────────────
	await page.fill("#prompt", `*${reloadNames[0]} hi`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	await expect
		.poll(() => capturedBodies.length, { timeout: 30_000 })
		.toBeGreaterThanOrEqual(3);

	// ── 6. Identify each daemon's request body by identity line ───────────────
	// renderSystemPrompt (prompt-builder.ts:148-154) writes:
	//   phase 1: `You are *${name}. You have no clue where you are…`
	// so matching `You are *${name}.` covers both phase 1 and later phases.
	function findBodyForName(
		bodies: unknown[],
		name: string,
	): Record<string, unknown> | null {
		for (const body of bodies) {
			if (body && typeof body === "object") {
				const b = body as { messages?: Array<{ content?: string }> };
				const sysContent = b.messages?.[0]?.content ?? "";
				if (sysContent.includes(`You are *${name}.`)) {
					return body as Record<string, unknown>;
				}
			}
		}
		return null;
	}

	const witnessBody = findBodyForName(capturedBodies, witnessName);
	const actorBody = findBodyForName(capturedBodies, names[0]);

	expect(
		witnessBody,
		`No request body found for witness (${witnessName}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();

	expect(
		actorBody,
		`No request body found for actor (${names[0]}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();

	// ── 7. Build expected witnessed-event line ────────────────────────────────
	// conversation-log.ts:63-65:
	//   case "go":
	//     return `[Round ${round}] You watch *${actorSub} walk ${direction}.`;
	// where actorSub = `*${entry.actor}` (the AiId, not the name)
	const expectedLine = `[Round 1] You watch *${actorId} walk ${DIRECTION}.`;

	// ── 8. Assert witness's system prompt contains the witnessed-event line ────
	const witnessSysContent = (
		witnessBody as { messages: Array<{ content: string }> }
	).messages[0]?.content;

	expect(witnessSysContent).toContain("<conversation>");
	expect(witnessSysContent).toContain("</conversation>");
	expect(
		witnessSysContent,
		`Expected witnessed-event line not found in witness system prompt. ` +
			`Expected: "${expectedLine}"`,
	).toContain(expectedLine);
	expect(
		witnessSysContent,
		"Witnessed-event line must appear between <conversation> tags",
	).toMatch(
		new RegExp(
			`<conversation>[\\s\\S]*${expectedLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*</conversation>`,
		),
	);

	// ── 9. Assert actor's system prompt does NOT contain the line ─────────────
	// The write-time fan-out (dispatcher.ts:460-493) only appends to witnesses,
	// never to the actor. The actor gets a private tool-result string instead.
	const actorSysContent = (
		actorBody as { messages: Array<{ content: string }> }
	).messages[0]?.content;

	expect(
		actorSysContent,
		"Actor must not have the witnessed-event line in their system prompt",
	).not.toContain(expectedLine);

	// ── 10. No page errors ────────────────────────────────────────────────────
	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
