import { expect, type Page, test } from "@playwright/test";
import {
	activePackOf,
	CARDINAL_DIRECTIONS,
	type CardinalDirection,
	expectNoPageErrors,
	type GridPosition,
	getAiHandles,
	goToGame,
	inRoom,
	inVista,
	isJsonModeRequest,
	isRequestForDaemon,
	listingLabels,
	obstacleCellsOf,
	type ParsedBody,
	parseRequestBody,
	positionsEqual,
	RELATIVE_DIRECTION_WORDS,
	readActiveSessionEngine,
	type SealedEngine,
	SSE_HEADERS,
	sectionBetween,
	stepDelta,
	stubChatCompletions,
	toolCallSseBody,
	vistaCells,
	waitForRound,
	writeActiveSessionEngine,
} from "./helpers";

const FIRST_ROUND_AFTER_RELOAD = 0;

function stubReplySseBody(): string {
	const chunk = JSON.stringify({
		choices: [{ delta: { content: "stub reply" }, finish_reason: null }],
	});
	return `data: ${chunk}\n\ndata: [DONE]\n\n`;
}

function cellOneStepFrom(
	start: GridPosition,
	direction: CardinalDirection,
): GridPosition {
	const delta = stepDelta(direction);
	return { row: start.row + delta.drow, col: start.col + delta.dcol };
}

function cellOneStepBehind(
	start: GridPosition,
	direction: CardinalDirection,
): GridPosition {
	const delta = stepDelta(direction);
	return { row: start.row - delta.drow, col: start.col - delta.dcol };
}

function isOpenRoomCell(
	cell: GridPosition,
	obstacles: GridPosition[],
): boolean {
	return inRoom(cell) && !obstacles.some((o) => positionsEqual(o, cell));
}

interface PersonaSpatial {
	position: GridPosition;
}

interface DirectPlan {
	kind: "direct";
	actorId: string;
	direction: CardinalDirection;
	witnessId: string;
	roundAtDispatch: number;
}

interface PatchPlan {
	kind: "patch";
	actorId: string;
	direction: CardinalDirection;
	witnessId: string;
	witnessNewPosition: GridPosition;
	roundAtDispatch: typeof FIRST_ROUND_AFTER_RELOAD;
}

type WalkPlan = DirectPlan | PatchPlan;

function findDirectPlan(
	spatials: Record<string, PersonaSpatial>,
	obstacles: GridPosition[],
	roundAtDispatch: number,
): DirectPlan | null {
	const aiIds = Object.keys(spatials);

	for (const actorId of aiIds) {
		const actorSpatial = spatials[actorId];
		if (!actorSpatial) continue;

		for (const direction of CARDINAL_DIRECTIONS) {
			const actorDestination = cellOneStepFrom(
				actorSpatial.position,
				direction,
			);
			if (!isOpenRoomCell(actorDestination, obstacles)) continue;

			for (const witnessId of aiIds) {
				if (witnessId === actorId) continue;
				const witnessSpatial = spatials[witnessId];
				if (!witnessSpatial) continue;
				if (inVista(witnessSpatial.position, actorDestination)) {
					return {
						kind: "direct",
						actorId,
						direction,
						witnessId,
						roundAtDispatch,
					};
				}
			}
		}
	}
	return null;
}

function findWitnessRelocationPlan(
	spatials: Record<string, PersonaSpatial>,
	obstacles: GridPosition[],
): PatchPlan | null {
	const aiIds = Object.keys(spatials);

	for (const actorId of aiIds) {
		const actorSpatial = spatials[actorId];
		if (!actorSpatial) continue;

		for (const direction of CARDINAL_DIRECTIONS) {
			const actorDestination = cellOneStepFrom(
				actorSpatial.position,
				direction,
			);
			if (!isOpenRoomCell(actorDestination, obstacles)) continue;

			const cellBehindActor = cellOneStepBehind(
				actorSpatial.position,
				direction,
			);

			for (const witnessId of aiIds) {
				if (witnessId === actorId) continue;
				if (!isOpenRoomCell(cellBehindActor, obstacles)) continue;
				const occupiedByAnotherDaemon = aiIds.some(
					(otherId) =>
						otherId !== witnessId &&
						spatials[otherId] &&
						positionsEqual(
							(spatials[otherId] as PersonaSpatial).position,
							cellBehindActor,
						),
				);
				if (occupiedByAnotherDaemon) continue;

				if (!inVista(cellBehindActor, actorDestination)) continue;

				return {
					kind: "patch",
					actorId,
					direction,
					witnessId,
					witnessNewPosition: cellBehindActor,
					roundAtDispatch: FIRST_ROUND_AFTER_RELOAD,
				};
			}
		}
	}
	return null;
}

async function routeGoToolCallToActorOnly(
	page: Page,
	actorName: string,
	actorSseBody: string,
): Promise<void> {
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);

		if (isJsonModeRequest(body)) {
			await route.fallback();
			return;
		}

		await route.fulfill({
			status: 200,
			headers: SSE_HEADERS,
			body: isRequestForDaemon(body, actorName)
				? actorSseBody
				: stubReplySseBody(),
		});
	});
}

async function reloadIntoRestoredSession(page: Page): Promise<void> {
	await page.reload();
	await expect(page.locator("#composer")).toBeVisible();
}

test("live go tool-call produces witnessed-event that survives reload and appears in witness system prompt", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const { ids, names } = await goToGame(page, { sse: ["stub reply"] });
	await expect(page.locator("#composer")).toBeVisible();

	const storageInfo = await readActiveSessionEngine(page);
	const engineData: SealedEngine = storageInfo.sealed;

	const initialSpatial = engineData.personaSpatial as
		| Record<string, PersonaSpatial>
		| undefined;
	if (!initialSpatial || Object.keys(initialSpatial).length === 0)
		throw new Error("No initial spatial data in engine.dat");

	const initialPack = activePackOf(engineData);
	if (!initialPack) throw new Error("No active content pack in engine.dat");
	const obstaclePositions = obstacleCellsOf(initialPack);
	const wallName = initialPack.wallName;

	const plan: WalkPlan | null =
		findDirectPlan(
			initialSpatial,
			obstaclePositions,
			FIRST_ROUND_AFTER_RELOAD,
		) ?? findWitnessRelocationPlan(initialSpatial, obstaclePositions);

	if (!plan) {
		throw new Error(
			`Could not find any valid walk plan (direct or patch).\n` +
				`Spatial layout: ${JSON.stringify(initialSpatial, null, 2)}\n` +
				`Obstacles: ${JSON.stringify(obstaclePositions, null, 2)}\n` +
				`AI ids: ${JSON.stringify(ids)}`,
		);
	}

	const { actorId, direction, witnessId, roundAtDispatch } = plan;
	const actorName = names[ids.indexOf(actorId as (typeof ids)[number])];
	const witnessName = names[ids.indexOf(witnessId as (typeof ids)[number])];

	if (!actorName || !witnessName) {
		throw new Error(
			`Could not resolve names: actorId=${actorId}, witnessId=${witnessId}, ` +
				`ids=${JSON.stringify(ids)}, names=${JSON.stringify(names)}`,
		);
	}

	if (plan.kind === "patch") {
		const witnessSpatial = engineData.personaSpatial[witnessId];
		if (!witnessSpatial) {
			throw new Error(`No spatial state for ${witnessId} in engine.dat`);
		}
		witnessSpatial.position = plan.witnessNewPosition;
		await writeActiveSessionEngine(page, storageInfo.sessionId, engineData);
	}

	const actorStart = initialSpatial[actorId]?.position;
	if (!actorStart) throw new Error(`No initial position for ${actorId}`);
	const actorDestination = cellOneStepFrom(actorStart, direction);

	await reloadIntoRestoredSession(page);

	await stubChatCompletions(page, () => ["stub reply"]);

	await routeGoToolCallToActorOnly(
		page,
		actorName,
		toolCallSseBody("go", { direction }),
	);

	await page.locator("#prompt").fill(`*${actorName} go ${direction}!`);
	await expect(page.locator("#send")).toBeEnabled({ timeout: 15_000 });
	await page.locator("#send").click();

	await waitForRound(page, storageInfo.sessionId, roundAtDispatch + 1);

	const witnessedStep = await page.evaluate(
		({ sid, wId, aId }: { sid: string; wId: string; aId: string }) => {
			const key = `hi-blue:sessions/${sid}/${wId}.txt`;
			const raw = localStorage.getItem(key);
			if (!raw) return { found: false, entry: null, log: [] as unknown[] };
			const df = JSON.parse(raw) as {
				conversationLog: Array<{
					kind: string;
					actor?: string;
					actionKind?: string;
					direction?: string;
				}>;
			};
			const log = df.conversationLog;
			const entry =
				log.find((e) => e.kind === "witnessed-event" && e.actor === aId) ??
				null;
			return { found: entry !== null, entry, log };
		},
		{ sid: storageInfo.sessionId, wId: witnessId, aId: actorId },
	);

	expect(
		witnessedStep.found,
		`Expected a witnessed-event entry in witness's DaemonFile before reload. ` +
			`conversationLog: ${JSON.stringify(witnessedStep.log, null, 2)}`,
	).toBe(true);

	expect(
		witnessedStep.entry?.actionKind,
		"the witnessed event must record the observable action kind",
	).toBe("go");
	expect(
		witnessedStep.entry?.direction,
		`the witnessed movement must record the cardinal step ` +
			`(planned ${direction}); entry: ${JSON.stringify(witnessedStep.entry)}`,
	).toBe(direction);

	await reloadIntoRestoredSession(page);

	const capturedBodies: ParsedBody[] = [];
	await stubChatCompletions(page, (request) => {
		capturedBodies.push(parseRequestBody(request));
		return ["stub reply"];
	});

	const { names: reloadNames } = await getAiHandles(page);

	await page.locator("#prompt").fill(`*${reloadNames[0]} hi`);
	await expect(page.locator("#send")).toBeEnabled({ timeout: 15_000 });
	await page.locator("#send").click();

	await expect
		.poll(() => capturedBodies.length, { timeout: 30_000 })
		.toBeGreaterThanOrEqual(3);

	const findBodyForDaemon = (daemonName: string): ParsedBody =>
		capturedBodies.find((body) => isRequestForDaemon(body, daemonName)) ?? null;

	const witnessBody = findBodyForDaemon(witnessName);
	const actorBody = findBodyForDaemon(actorName);

	expect(
		witnessBody,
		`No request body found for witness (${witnessName}). ` +
			`Captured ${capturedBodies.length} bodies. ` +
			`actorId=${actorId} witnessId=${witnessId}`,
	).not.toBeNull();

	expect(
		actorBody,
		`No request body found for actor (${actorName}). ` +
			`Captured ${capturedBodies.length} bodies.`,
	).not.toBeNull();

	const expectedLine = `[Round ${roundAtDispatch}] You watch *${actorId} walk ${direction}.`;

	const witnessAllContent = (
		witnessBody as { messages: Array<{ content: string | null }> }
	).messages
		.map((m) => (typeof m.content === "string" ? m.content : ""))
		.join("\n");

	expect(
		witnessAllContent,
		`Expected witnessed-event line not found in witness messages. ` +
			`Expected: "${expectedLine}"\n` +
			`plan: ${JSON.stringify(plan)}\n` +
			`actorId=${actorId} direction=${direction} witnessId=${witnessId}`,
	).toContain(expectedLine);

	const actorAllContent = (
		actorBody as { messages: Array<{ content: string | null }> }
	).messages
		.map((m) => (typeof m.content === "string" ? m.content : ""))
		.join("\n");

	expect(
		actorAllContent,
		"Actor must not have the witnessed-event line in their messages",
	).not.toContain(expectedLine);

	const actorListing = sectionBetween(
		actorAllContent,
		"<what_you_see>",
		"</what_you_see>",
	);
	const actorVista = vistaCells(actorDestination).filter(
		(cell) => !cell.isOwnCell,
	);

	expect(
		listingLabels(actorListing),
		`Expected the 12 non-own cells of the Vista at ` +
			`(${actorDestination.row}, ${actorDestination.col}).\nListing:\n${actorListing}`,
	).toHaveLength(actorVista.length);

	expect(
		new Set(listingLabels(actorListing)),
		`Expected exactly the cells of the radius-2 Vista at ` +
			`(${actorDestination.row}, ${actorDestination.col}).\nListing:\n${actorListing}`,
	).toEqual(new Set(actorVista.map((cell) => cell.label)));

	for (const cell of actorVista) {
		if (!cell.isWall) continue;
		expect(
			actorListing,
			`Out-of-bounds cell "${cell.label}" must be listed as a Wall`,
		).toContain(`- ${cell.label}: ${wallName}`);
	}

	expect(
		actorListing,
		"A Daemon's listing must not phrase anything relative to an orientation",
	).not.toMatch(RELATIVE_DIRECTION_WORDS);

	await expectNoPageErrors(page, pageErrors);
});
