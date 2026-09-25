import { expect, test } from "@playwright/test";
import {
	activePackOf,
	CARDINAL_DIRECTIONS,
	type CardinalDirection,
	expectNoPageErrors,
	type GridPosition,
	getAiHandles,
	goToGame,
	inRoom,
	isGridPosition,
	isJsonModeRequest,
	isRequestForDaemon,
	listingLabels,
	type ParsedBody,
	parseRequestBody,
	positionsEqual,
	RELATIVE_DIRECTION_WORDS,
	readActiveSessionEngine,
	readActiveSessionFiles,
	readDaemonFile,
	renderedPlayerLine,
	type SealedEngine,
	SSE_HEADERS,
	sectionBetween,
	stepDelta,
	stubChatCompletions,
	toolCallSseBody,
	vistaCells,
	waitForFirstRoundSaved,
	waitForRound,
	waitForSavedPosition,
	writeActiveSessionEngine,
} from "./helpers";

const STUB_COMPLETION = "stub reply";

const LIVE_SESSION_SCHEMA_VERSION = 12;

const ROUNDS_PLAYED_BY_THE_ROUND_TRIP = 2;

const RETIRED_ORIENTATION_KEY = /facing/i;

const RETIRED_CONTENT_PACK_ANCHOR_KEY = /landmark/i;

function cellOneStepFrom(
	start: GridPosition,
	direction: CardinalDirection,
): GridPosition {
	const delta = stepDelta(direction);
	return { row: start.row + delta.drow, col: start.col + delta.dcol };
}

function firstLegalCardinalStep(
	start: GridPosition,
	obstacleCells: GridPosition[],
): { direction: CardinalDirection; destination: GridPosition } | null {
	for (const direction of CARDINAL_DIRECTIONS) {
		const destination = cellOneStepFrom(start, direction);
		const blocked = obstacleCells.some((cell) =>
			positionsEqual(cell, destination),
		);
		if (inRoom(destination) && !blocked) return { direction, destination };
	}
	return null;
}

function lineStartingWith(text: string, prefix: string): string {
	return text.split("\n").find((line) => line.startsWith(prefix)) ?? "";
}

function findLastBodyForDaemon(
	bodies: ParsedBody[],
	daemonName: string,
): ParsedBody {
	for (let i = bodies.length - 1; i >= 0; i--) {
		const body = bodies[i] ?? null;
		if (isRequestForDaemon(body, daemonName)) return body;
	}
	return null;
}

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

function setEntityHolder(
	sealed: SealedEngine,
	entityId: string,
	holder: string | GridPosition,
): void {
	const entity = sealed.world.entities.find((e) => e.id === entityId);
	if (!entity) throw new Error(`No entity ${entityId} in engine.dat`);
	entity.holder = holder;
}

function entityHolderOf(sealed: SealedEngine, entityId: string): unknown {
	return sealed.world.entities.find((e) => e.id === entityId)?.holder;
}

test("game state and transcripts persist across mid-round reload", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { names, ids } = await goToGame(page, { sse: [STUB_COMPLETION] });

	await expect(page.locator("#composer")).toBeVisible();

	await page.fill("#prompt", `*${names[0]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	await waitForFirstRoundSaved(page);

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

	const preReloadTranscript = await page
		.locator(`[data-transcript="${ids[0]}"]`)
		.textContent();
	expect(preReloadTranscript).toBeTruthy();
	expect(preReloadTranscript).toContain(renderedPlayerLine("hello"));
	expect(preReloadTranscript).toContain(STUB_COMPLETION);

	const preReloadBudgets: Record<string, string> = {};
	for (const aiId of ids) {
		const el = page.locator(`.ai-panel[data-ai="${aiId}"] .panel-budget`);
		preReloadBudgets[aiId] = (await el.getAttribute("data-budget")) ?? "";
	}

	await page.reload();

	await expect(page.locator("#composer")).toBeVisible();

	await stubChatCompletions(page, [STUB_COMPLETION]);

	const { ids: reloadIds } = await getAiHandles(page);

	const postReloadTranscript = await page
		.locator(`[data-transcript="${reloadIds[0]}"]`)
		.textContent();
	expect(postReloadTranscript).toContain(renderedPlayerLine("hello"));
	expect(postReloadTranscript).toContain(STUB_COMPLETION);
	expect(postReloadTranscript).toBe(preReloadTranscript);

	for (const aiId of reloadIds) {
		const el = page.locator(`.ai-panel[data-ai="${aiId}"] .panel-budget`);
		const postBudget = await el.getAttribute("data-budget");
		expect(postBudget, `${aiId} budget must match after reload`).toBe(
			preReloadBudgets[aiId],
		);
	}

	await expectNoPageErrors(page, pageErrors);
});

test("a live-schema session reloads with position, inventory, content state, conversation and perception changes intact", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { ids, names } = await goToGame(page, { sse: [STUB_COMPLETION] });
	await expect(page.locator("#composer")).toBeVisible();

	const created = await readActiveSessionEngine(page);
	expect(
		created.sealed.schemaVersion,
		"a new session must stamp the live session schema",
	).toBe(LIVE_SESSION_SCHEMA_VERSION);

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

	const obstacleCells = (createdPack.entities ?? [])
		.filter((entity) => entity.kind === "obstacle")
		.map((entity) => entity.holder)
		.filter(isGridPosition);
	const plannedStep = firstLegalCardinalStep(actorStart, obstacleCells);
	if (!plannedStep) throw new Error(`No legal cardinal step for ${actorId}`);
	const { direction, destination } = plannedStep;

	const stubDecoys = created.sealed.world.entities.filter(
		(entity) => entity.kind === "interesting_object",
	);
	expect(
		stubDecoys.length,
		"the stub Content Pack places two decoys",
	).toBeGreaterThanOrEqual(2);
	const heldItem = stubDecoys[0];
	const destinationItem = stubDecoys[1];
	if (!heldItem || !destinationItem) {
		throw new Error("the stub Content Pack must place two decoys");
	}
	const seeded = structuredClone(created.sealed);
	setEntityHolder(seeded, heldItem.id, actorId);
	setEntityHolder(seeded, destinationItem.id, destination);
	await writeActiveSessionEngine(page, created.sessionId, seeded);

	await page.reload();
	await expect(page.locator("#composer")).toBeVisible();

	const capturedBodies: ParsedBody[] = [];
	await stubChatCompletions(page, (request) => {
		capturedBodies.push(parseRequestBody(request));
		return [STUB_COMPLETION];
	});
	let goToolCallServed = false;
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		if (isJsonModeRequest(body)) {
			await route.fallback();
			return;
		}
		if (!goToolCallServed && isRequestForDaemon(body, actorName)) {
			goToolCallServed = true;
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

	await waitForSavedPosition(page, created.sessionId, actorId, destination);

	const afterGo = await readActiveSessionEngine(page);
	expect(afterGo.sealed.schemaVersion).toBe(LIVE_SESSION_SCHEMA_VERSION);
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

	const packAfterAnySettingShift = activePackOf(afterGo.sealed) ?? createdPack;

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

	const actorBody = findLastBodyForDaemon(capturedBodies, actorName);
	expect(
		actorBody,
		`No request body found for ${actorName} after reload. ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();
	if (!actorBody) throw new Error(`No request body for ${actorName}`);
	const content = joinedContent(actorBody);

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
		).toContain(`- ${cell.label}: ${packAfterAnySettingShift.wallName}`);
	}
	expect(
		listing,
		"A Daemon's listing must not phrase anything relative to an orientation",
	).not.toMatch(RELATIVE_DIRECTION_WORDS);

	const cellLine = lineStartingWith(content.all, "Your cell contains:");
	expect(
		cellLine,
		`The restored position must be the cell the step landed on.\n${content.all}`,
	).toContain(destinationItem.name);

	const holdingLine = lineStartingWith(content.all, "You are holding:");
	expect(
		holdingLine,
		`The held entity must restore as inventory.\n${content.all}`,
	).toContain(heldItem.name);

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

	expect(content.all).toContain(`[Round 0] blue dms you: go ${direction}!`);

	expect(
		content.tools,
		"the persisted perception change must reappear as a <noticed> block",
	).toContain("<noticed>");
	expect(content.tools).toContain(destinationItem.name);

	await waitForRound(page, created.sessionId, ROUNDS_PLAYED_BY_THE_ROUND_TRIP);
	const saved = await readActiveSessionFiles(page);
	const savedBytes = [
		saved.meta,
		...Object.values(saved.daemons),
		saved.engineJson,
	].join("\n");
	expect(savedBytes).not.toMatch(RETIRED_ORIENTATION_KEY);
	expect(savedBytes).not.toMatch(RETIRED_CONTENT_PACK_ANCHOR_KEY);

	const resaved = await readActiveSessionEngine(page);
	expect(resaved.sealed.schemaVersion).toBe(LIVE_SESSION_SCHEMA_VERSION);
	expect(resaved.sealed.personaSpatial[actorId]?.position).toEqual(destination);
	expect(entityHolderOf(resaved.sealed, heldItem.id)).toBe(actorId);
	expect(entityHolderOf(resaved.sealed, destinationItem.id)).toEqual(
		destination,
	);
	expect(
		authoredSettings,
		"the re-saved active pack must still be one of the authored packs",
	).toContain(activePackOf(resaved.sealed)?.setting);

	await expectNoPageErrors(page, pageErrors);
});
