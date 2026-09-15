import { expect, test } from "@playwright/test";
import {
	activePackOf,
	CARDINAL_DIRECTIONS,
	expectNoPageErrors,
	type GridPosition,
	getAiHandles,
	goToGame,
	inRoom,
	isGridPosition,
	listingLabels,
	type ParsedBody,
	parseRequestBody,
	positionsEqual,
	RELATIVE_DIRECTION_WORDS,
	readActiveSessionEngine,
	readActiveSessionFiles,
	readDaemonFile,
	type SealedEngine,
	sectionBetween,
	stepDelta,
	stubChatCompletions,
	toolCallSseBody,
	vistaCells,
	waitForRound,
	waitForSavedPosition,
	writeActiveSessionEngine,
} from "./helpers";

/**
 * AI completions returned by the stub, keyed by call index (0 = first, 1 = second, 2 = third
 * for default initiative order).  We keep them short to minimise token-pacing delay.
 */
const STUB_COMPLETION = "stub reply";

/** SSE response headers the SPA's streaming parser expects. */
const SSE_HEADERS = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache",
	"X-Content-Type-Options": "nosniff",
};

/** The last captured `/v1/chat/completions` body whose system prompt names `name`. */
function findLastBodyForName(bodies: unknown[], name: string): ParsedBody {
	for (let i = bodies.length - 1; i >= 0; i--) {
		const body = bodies[i] as ParsedBody;
		const sysContent = body?.messages?.[0]?.content ?? "";
		if (sysContent.includes(`writing *${name}, a Daemon.`)) return body;
	}
	return null;
}

/** Every message content of a captured request body, joined for substring checks. */
function joinedContent(body: ParsedBody): {
	all: string;
	system: string;
	tools: string;
} {
	const messages = body?.messages ?? [];
	const contentOf = (m: { content?: string }) => m.content ?? "";
	return {
		all: messages.map(contentOf).join("\n"),
		system: messages.find((m) => m.role === "system")?.content ?? "",
		tools: messages
			.filter((m) => m.role === "tool")
			.map(contentOf)
			.join("\n"),
	};
}

/** Point one persisted entity at a holder (a Daemon id, or a grid cell). */
function setEntityHolder(
	sealed: SealedEngine,
	entityId: string,
	holder: string | GridPosition,
): void {
	const entity = sealed.world.entities.find((e) => e.id === entityId);
	if (!entity) throw new Error(`No entity ${entityId} in engine.dat`);
	entity.holder = holder;
}

/** The holder of one persisted entity. */
function entityHolderOf(sealed: SealedEngine, entityId: string): unknown {
	return sealed.world.entities.find((e) => e.id === entityId)?.holder;
}

test("game state and transcripts persist across mid-round reload", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// Navigate through the start screen into the game.
	// goToGame stubs synthesis + content-pack + SSE and clicks BEGIN.
	const { names, ids } = await goToGame(page, { sse: [STUB_COMPLETION] });

	// Wait for the SPA game route to mount (the composer form is present)
	await expect(page.locator("#composer")).toBeVisible();

	// Address first AI via *<name> mention and send a message
	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	// Wait for the round to complete and the save to land. The save runs AFTER
	// the encoder loop processes all events, so we poll localStorage directly
	// rather than the transcript (which fills via live deltas earlier).
	// (Post-#107 the send button does NOT re-enable after submit because the
	// prompt is cleared and an empty prompt has no *mention → sendEnabled=false.)
	// Post-#173: BEGIN also saves engine.dat at round=0 on commit, so we can no
	// longer use engine.dat !== null as the "round complete" signal.  Instead we
	// wait for meta.round to advance to ≥ 1, which proves a full round was committed.
	await page.waitForFunction(
		() => {
			const sessionId = localStorage.getItem("hi-blue:active-session");
			if (!sessionId) return false;
			const metaRaw = localStorage.getItem(
				`hi-blue:sessions/${sessionId}/meta.json`,
			);
			if (!metaRaw) return false;
			try {
				const meta = JSON.parse(metaRaw) as { round?: number };
				return typeof meta.round === "number" && meta.round >= 1;
			} catch {
				return false;
			}
		},
		{ timeout: 15_000 },
	);

	// ── Assert localStorage was written ────────────────────────────────────────

	const { sessionId, metaRaw } = await page.evaluate(() => {
		const sid = localStorage.getItem("hi-blue:active-session");
		const meta = sid
			? localStorage.getItem(`hi-blue:sessions/${sid}/meta.json`)
			: null;
		return { sessionId: sid, metaRaw: meta };
	});
	expect(sessionId, "active-session pointer must be set").not.toBeNull();
	expect(metaRaw, "meta.json must be written").not.toBeNull();

	const meta = JSON.parse(metaRaw as string) as {
		phase: number;
		round: number;
		createdAt: string;
		lastSavedAt: string;
	};
	expect(meta.round).toBeGreaterThanOrEqual(1);

	// ── Capture pre-reload values ───────────────────────────────────────────────

	const preReloadTranscript = await page
		.locator(`[data-transcript="${ids[0]}"]`)
		.textContent();
	expect(preReloadTranscript).toBeTruthy();
	// The player's message must appear in the transcript. Post-#214 the leading
	// `*<handle>` mention is stripped before render, so the displayed line is
	// `> hello`, not `> *<handle> hello`.
	expect(preReloadTranscript).toContain("> hello");
	// The stub completion must appear in the addressed panel
	expect(preReloadTranscript).toContain(STUB_COMPLETION);

	const preReloadBudgets: Record<string, string> = {};
	for (const aiId of ids) {
		const el = page.locator(`.ai-panel[data-ai="${aiId}"] .panel-budget`);
		preReloadBudgets[aiId] = (await el.getAttribute("data-budget")) ?? "";
	}

	// ── Reload ──────────────────────────────────────────────────────────────────

	await page.reload();

	// Wait for SPA to remount after reload
	await expect(page.locator("#composer")).toBeVisible();

	// After reload we need to stub again for the restored session (the route
	// intercept was only on the previous page context).
	await stubChatCompletions(page, [STUB_COMPLETION]);

	// After reload, fetch handles again — procedural names persist via saved persona.name.
	const { ids: reloadIds } = await getAiHandles(page);

	// ── Assert transcripts restored ─────────────────────────────────────────────

	const postReloadTranscript = await page
		.locator(`[data-transcript="${reloadIds[0]}"]`)
		.textContent();
	expect(postReloadTranscript).toContain("> hello");
	expect(postReloadTranscript).toContain(STUB_COMPLETION);
	expect(postReloadTranscript).toBe(preReloadTranscript);

	// ── Assert budgets restored ─────────────────────────────────────────────────

	for (const aiId of reloadIds) {
		const el = page.locator(`.ai-panel[data-ai="${aiId}"] .panel-budget`);
		const postBudget = await el.getAttribute("data-budget");
		expect(postBudget, `${aiId} budget must match after reload`).toBe(
			preReloadBudgets[aiId],
		);
	}

	// ── No page errors ──────────────────────────────────────────────────────────

	await expectNoPageErrors(page, pageErrors);
});

test("a schema 12 session reloads with position, inventory, content state, conversation and perception changes intact", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { ids, names } = await goToGame(page, { sse: [STUB_COMPLETION] });
	await expect(page.locator("#composer")).toBeVisible();

	// ── 1. A newly created session is sealed at session schema 12 ──────────────
	const created = await readActiveSessionEngine(page);
	expect(
		created.sealed.schemaVersion,
		"a new session must stamp session schema 12",
	).toBe(12);

	const actorId = ids[0];
	const actorName = names[0];
	const actorStart = created.sealed.personaSpatial[actorId]?.position;
	expect(
		actorStart,
		`engine.dat must carry a position for ${actorId}`,
	).toBeTruthy();
	if (!actorStart) throw new Error(`No position for ${actorId} in engine.dat`);

	const createdPack = activePackOf(created.sealed);
	if (!createdPack) throw new Error("No active content pack in engine.dat");
	expect(createdPack.setting.length).toBeGreaterThan(0);

	// ── 2. Plan one live cardinal step the dispatcher will accept ─────────────
	// Obstacles block a step; bounds and everything else the dispatcher rules on
	// is mirrored by the helpers.
	const obstacleCells = (createdPack.entities ?? [])
		.filter((entity) => entity.kind === "obstacle")
		.map((entity) => entity.holder)
		.filter(isGridPosition);
	const direction = CARDINAL_DIRECTIONS.find((candidate) => {
		const delta = stepDelta(candidate);
		const next = {
			row: actorStart.row + delta.drow,
			col: actorStart.col + delta.dcol,
		};
		return (
			inRoom(next) && !obstacleCells.some((cell) => positionsEqual(cell, next))
		);
	});
	if (!direction) throw new Error(`No legal cardinal step for ${actorId}`);
	const step = stepDelta(direction);
	const destination: GridPosition = {
		row: actorStart.row + step.drow,
		col: actorStart.col + step.dcol,
	};

	// ── 3. Seed the two states a round cannot reach deterministically ─────────
	// Inventory: an entity held by a Daemon (a holder that is an AiId, not a
	// cell). Perception change: an item resting on the destination cell, so the
	// live step's diskDelta is guaranteed non-empty. Both are written the way
	// the SPA writes them — obfuscated engine.dat — and everything asserted
	// after this point runs through the live runtime.
	const items = created.sealed.world.entities.filter(
		(entity) => entity.kind === "interesting_object",
	);
	expect(
		items.length,
		"the stub Content Pack places two decoys",
	).toBeGreaterThanOrEqual(2);
	const heldItem = items[0];
	const destinationItem = items[1];
	if (!heldItem || !destinationItem) {
		throw new Error("the stub Content Pack must place two decoys");
	}
	const seeded = structuredClone(created.sealed);
	setEntityHolder(seeded, heldItem.id, actorId);
	setEntityHolder(seeded, destinationItem.id, destination);
	await writeActiveSessionEngine(page, created.sessionId, seeded);

	// ── 4. Reload so the restored session is the seeded state ─────────────────
	await page.reload();
	await expect(page.locator("#composer")).toBeVisible();

	// ── 5. Live `go` round: the actor walks one cardinal step ────────────────
	const capturedBodies: unknown[] = [];
	await stubChatCompletions(page, (request) => {
		capturedBodies.push(parseRequestBody(request));
		return [STUB_COMPLETION];
	});
	let goPending = true;
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		// JSON-mode (synthesis / content-pack) calls belong to the base stub.
		if (
			body !== null &&
			(body.stream === false || body.response_format != null)
		) {
			await route.fallback();
			return;
		}
		const sysContent = body?.messages?.[0]?.content ?? "";
		if (goPending && sysContent.includes(`writing *${actorName}, a Daemon.`)) {
			goPending = false;
			await route.fulfill({
				status: 200,
				headers: SSE_HEADERS,
				body: toolCallSseBody("go", { direction }),
			});
			return;
		}
		await route.fallback();
	});

	await page.locator("#prompt").fill(`*${actorName} go ${direction}!`);
	await expect(page.locator("#send")).toBeEnabled({ timeout: 15_000 });
	await page.locator("#send").click();

	// engine.dat is written last in the save order, so wait for the step to
	// reach it rather than for meta.json (which lands first).
	await waitForSavedPosition(page, created.sessionId, actorId, destination);

	// ── 6. The live step is in the committed save ─────────────────────────────
	const afterGo = await readActiveSessionEngine(page);
	expect(afterGo.sealed.schemaVersion).toBe(12);
	expect(
		afterGo.sealed.personaSpatial[actorId]?.position,
		"the live step must persist the actor's position",
	).toEqual(destination);

	const actorFile = await readDaemonFile(page, created.sessionId, actorId);
	const goEntry = actorFile.conversationLog.find(
		(entry) => entry.kind === "tool-call" && entry.toolName === "go",
	);
	expect(
		goEntry,
		`the actor's DaemonFile must record the go tool call: ` +
			`${JSON.stringify(actorFile.conversationLog)}`,
	).toBeTruthy();
	expect(goEntry?.success, "the live step must have succeeded").toBe(true);
	expect(
		goEntry?.diskDelta ?? "",
		"the step must persist its perception change (diskDelta)",
	).toContain(destinationItem.name);

	// The pack the restored round will read: a Setting Shift during the step
	// switches the active pack (the stub packs share their entity names).
	const restoredPack = activePackOf(afterGo.sealed) ?? createdPack;

	// ── 7. Reload → the restored session feeds the round's results back ──────
	await page.reload();
	await expect(page.locator("#composer")).toBeVisible();

	capturedBodies.length = 0;
	await stubChatCompletions(page, (request) => {
		capturedBodies.push(parseRequestBody(request));
		return [STUB_COMPLETION];
	});
	const { names: reloadNames } = await getAiHandles(page);
	await page.locator("#prompt").fill(`*${reloadNames[0]} hi`);
	await expect(page.locator("#send")).toBeEnabled({ timeout: 15_000 });
	await page.locator("#send").click();
	await expect
		.poll(() => capturedBodies.length, { timeout: 30_000 })
		.toBeGreaterThanOrEqual(3);

	const actorBody = findLastBodyForName(capturedBodies, actorName);
	expect(
		actorBody,
		`No request body found for ${actorName} after reload. ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();
	if (!actorBody) throw new Error(`No request body for ${actorName}`);
	const content = joinedContent(actorBody);

	// ── 8. Position: the restored Vista is centred on the persisted cell ─────
	// The listing is the radius-2 disk minus the actor's own cell (which
	// <where_you_are> covers), labelled by cardinal direction and distance from
	// the actor's position; out-of-bounds cells are the Content Pack's Wall.
	const listing = sectionBetween(
		content.all,
		"<what_you_see>",
		"</what_you_see>",
	);
	const expectedCells = vistaCells(destination).filter(
		(cell) => !cell.isOwnCell,
	);
	expect(
		listingLabels(listing),
		`Expected the 12 non-own cells of the Vista at ` +
			`(${destination.row}, ${destination.col}).\nListing:\n${listing}`,
	).toHaveLength(expectedCells.length);
	expect(
		new Set(listingLabels(listing)),
		`Expected exactly the cells of the radius-2 Vista at ` +
			`(${destination.row}, ${destination.col}).\nListing:\n${listing}`,
	).toEqual(new Set(expectedCells.map((cell) => cell.label)));
	for (const cell of expectedCells) {
		if (!cell.isWall) continue;
		expect(
			listing,
			`Out-of-bounds cell "${cell.label}" must be listed as a Wall`,
		).toContain(`- ${cell.label}: ${restoredPack.wallName}`);
	}
	expect(
		listing,
		"A Daemon's listing must not phrase anything relative to an orientation",
	).not.toMatch(RELATIVE_DIRECTION_WORDS);

	// The seeded item rests on the cell the step landed on, so it reads as the
	// actor's own cell — which is only true if the restored position is that cell.
	const cellLine =
		content.all
			.split("\n")
			.find((line) => line.startsWith("Your cell contains:")) ?? "";
	expect(
		cellLine,
		`The restored position must be the cell the step landed on.\n${content.all}`,
	).toContain(destinationItem.name);

	// ── 9. Inventory: an entity held by a Daemon round-trips as a held item ──
	const holdingLine =
		content.all
			.split("\n")
			.find((line) => line.startsWith("You are holding:")) ?? "";
	expect(
		holdingLine,
		`The held entity must restore as inventory.\n${content.all}`,
	).toContain(heldItem.name);

	// ── 10. Content state: an authored pack still supplies the setting ───────
	// A Setting Shift may have swapped A for B during either round, so the
	// prompt must still carry one of the two authored settings.
	const authoredSettings = [
		created.sealed.contentPacksA?.[0]?.setting,
		created.sealed.contentPacksB?.[0]?.setting,
	].filter((setting): setting is string => typeof setting === "string");
	expect(content.system).toContain("<setting>");
	expect(
		authoredSettings.some((setting) => content.system.includes(setting)),
		`Expected an authored setting in the system prompt.\n` +
			`Settings: ${JSON.stringify(authoredSettings)}\n${content.system}`,
	).toBe(true);

	// ── 11. Conversation: the round-0 line survives the reload ───────────────
	expect(content.all).toContain(`[Round 0] blue dms you: go ${direction}!`);

	// ── 12. Perception changes: the persisted diskDelta still enriches the ──
	// ──     actor's tool result after reload                               ──
	expect(
		content.tools,
		"the persisted perception change must reappear as a <noticed> block",
	).toContain("<noticed>");
	expect(content.tools).toContain(destinationItem.name);

	// ── 13. The re-saved session carries no retired state ───────────────────
	// A real round trip must not write the retired per-Daemon orientation key
	// or the retired Content-Pack anchor key into any saved byte.
	await waitForRound(page, created.sessionId, 2);
	const saved = await readActiveSessionFiles(page);
	const savedBytes = [
		saved.meta,
		...Object.values(saved.daemons),
		saved.engineJson,
	].join("\n");
	expect(savedBytes).not.toMatch(/facing/i);
	expect(savedBytes).not.toMatch(/landmark/i);

	// The state the round trip carries is still there in the re-saved engine.
	const resaved = await readActiveSessionEngine(page);
	expect(resaved.sealed.schemaVersion).toBe(12);
	expect(resaved.sealed.personaSpatial[actorId]?.position).toEqual(destination);
	expect(entityHolderOf(resaved.sealed, heldItem.id)).toBe(actorId);
	expect(entityHolderOf(resaved.sealed, destinationItem.id)).toEqual(
		destination,
	);
	expect(
		authoredSettings,
		"the re-saved active pack must still be one of the authored packs",
	).toContain(activePackOf(resaved.sealed)?.setting);

	// ── No page errors ──────────────────────────────────────────────────────
	await expectNoPageErrors(page, pageErrors);
});
