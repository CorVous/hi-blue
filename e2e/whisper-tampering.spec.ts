import { expect, type Page, test } from "@playwright/test";
import {
	expectNoPageErrors,
	getAiHandles,
	goToGame,
	isRequestForDaemon,
	type ParsedBody,
	parseRequestBody,
	stubChatCompletions,
} from "./helpers";

const SENTINEL = "FABRICATED_TAMPERED_WHISPER_xyz123";

const FABRICATED_ENTRY_ROUND = 0;

async function appendFabricatedMessageToDaemonFile(
	page: Page,
	message: { from: string; to: string; content: string; round: number },
): Promise<void> {
	await page.evaluate(({ from, to, content, round }) => {
		const sessionId = localStorage.getItem("hi-blue:active-session");
		if (!sessionId) throw new Error("No active session in localStorage");

		const key = `hi-blue:sessions/${sessionId}/${to}.txt`;
		const raw = localStorage.getItem(key);
		if (!raw) throw new Error(`DaemonFile not found for targetId=${to}`);

		const daemonFile = JSON.parse(raw) as {
			aiId: string;
			persona: unknown;
			conversationLog: Array<Record<string, unknown>>;
		};

		daemonFile.conversationLog.push({
			kind: "message",
			round,
			from,
			to,
			content,
		});

		localStorage.setItem(key, JSON.stringify(daemonFile, null, 2));
	}, message);
}

function joinedMessageContents(body: ParsedBody): string {
	return (body?.messages ?? [])
		.map((m) => (typeof m.content === "string" ? m.content : ""))
		.join("\n");
}

test("fabricated message appears in target daemon prompt and is absent from others after reload", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { ids, names } = await goToGame(page, { sse: ["stub reply"] });

	await expect(page.locator("#composer")).toBeVisible();

	const targetId = ids[0];
	const senderId = ids[1];

	await appendFabricatedMessageToDaemonFile(page, {
		from: senderId,
		to: targetId,
		content: SENTINEL,
		round: FABRICATED_ENTRY_ROUND,
	});

	await page.reload();
	await expect(page.locator("#composer")).toBeVisible();

	const capturedBodies: ParsedBody[] = [];
	await stubChatCompletions(page, (request) => {
		capturedBodies.push(parseRequestBody(request));
		return ["stub reply"];
	});

	const { names: reloadNames } = await getAiHandles(page);

	await page.fill("#prompt", `*${reloadNames[0]} hi`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	await expect
		.poll(() => capturedBodies.length, { timeout: 30_000 })
		.toBeGreaterThanOrEqual(3);

	const findBodyForDaemon = (daemonName: string): ParsedBody =>
		capturedBodies.find((body) => isRequestForDaemon(body, daemonName)) ?? null;

	const targetBody = findBodyForDaemon(names[0]);
	const other1Body = findBodyForDaemon(names[1]);
	const other2Body = findBodyForDaemon(names[2]);

	const expectedLine = `[Round ${FABRICATED_ENTRY_ROUND}] *${senderId} dms you: ${SENTINEL}`;

	expect(
		targetBody,
		`No request body found for target daemon (names[0]=${names[0]}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();

	const targetAllContent = joinedMessageContents(targetBody);
	expect(
		targetAllContent,
		`Expected message line not found in target daemon's role turns. ` +
			`Expected: ${expectedLine}`,
	).toContain(expectedLine);

	expect(
		other1Body,
		`No request body found for daemon[1] (names[1]=${names[1]}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();
	expect(
		joinedMessageContents(other1Body),
		`Sentinel must NOT appear in daemon[1]'s messages (asymmetric property)`,
	).not.toContain(SENTINEL);

	expect(
		other2Body,
		`No request body found for daemon[2] (names[2]=${names[2]}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();
	expect(
		joinedMessageContents(other2Body),
		`Sentinel must NOT appear in daemon[2]'s messages (asymmetric property)`,
	).not.toContain(SENTINEL);

	await expectNoPageErrors(page, pageErrors);
});
