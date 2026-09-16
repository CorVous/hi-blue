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
	inVista,
	listingLabels,
	obstacleCellsOf,
	parseRequestBody,
	positionsEqual,
	RELATIVE_DIRECTION_WORDS,
	readActiveSessionEngine,
	type SealedEngine,
	sectionBetween,
	stepDelta,
	stubChatCompletions,
	toolCallSseBody,
	vistaCells,
	waitForRound,
	writeActiveSessionEngine,
} from "./helpers";

/**
 * E2E — Witnessed-event reload survival (issue #196, PRD #157)
 *
 * Proves the per-Daemon storage shape from #195 preserves
 * `kind: "witnessed-event"` entries across a page reload.
 *
 * Strategy:
 *   1. Drive the start screen through goToGame → game is live, all three
 *      <aiId>.txt DaemonFiles exist in localStorage.
 *   2. Decode engine.dat → read personaSpatial (actor positions)
 *      and obstacle positions.
 *   3. Compute a walk plan: find (actorId, direction, witnessId) such that
 *      after the actor walks one cardinal step `direction`, their post-move
 *      cell falls inside the witness's Vista (ADR 0015: the 13-cell radius-2
 *      disk, position-only — position alone gates witnesses).
 *      - Try a "direct plan" with the witness where they already stand.
 *      - Otherwise patch engine.dat to relocate the witness entirely, so the
 *        move is seen.
 *   4. Reload (first reload) — after reload, renderGame is called only once
 *      (restore path), so page.fill correctly enables #send.  The engine.dat
 *      and DaemonFiles from step 1 are preserved in localStorage.
 *   5. Re-register the JSON-mode and SSE stubs (route handlers are cleared on
 *      reload).
 *   6. Drive the action round: actor `go <cardinal>`, others pass.
 *   8. Sanity-check: the witness's DaemonFile has a witnessed-event entry
 *      recording the cardinal direction of the step.
 *   9. Reload (second reload) → the SPA deserialises from storage → reconstructs.
 *  10. Capture the next round's /v1/chat/completions request bodies.
 *  11. Assert: the witness's system prompt contains the witnessed-event line
 *      inside <conversation>...</conversation>, and the actor's own
 *      <what_you_see> listing is the position-only Vista of the cell the step
 *      landed on.
 *  12. Assert: the actor's system prompt does NOT contain the line.
 *
 * The round number in the witnessed-event entry is the phase.round at
 * dispatch time. The first dispatched round (after the first reload) is
 * round=0; after advanceRound it becomes 1, so the action round dispatches at
 * round=0 and the witnessed-event line reads "[Round 0]…".
 *
 * Key source references:
 *   src/spa/game/conversation-log.ts:63-65 — witnessed-event "go" line format
 *   src/spa/game/vista-projector.ts        — the Vista witness gate (ADR 0015)
 *   src/spa/game/dispatcher.ts:342         — round = state.round
 *   src/spa/persistence/session-codec.ts   — DaemonFile round-trip
 *   src/spa/persistence/sealed-blob-codec.ts:18 — OBFUSCATION_KEY
 */

// ── Tool-call SSE body helpers ────────────────────────────────────────────────

/** SSE body that returns a plain text reply ("stub reply"). */
function stubReplySseBody(): string {
	const chunk = JSON.stringify({
		choices: [{ delta: { content: "stub reply" }, finish_reason: null }],
	});
	return `data: ${chunk}\n\ndata: [DONE]\n\n`;
}

// ── Vista membership (ADR 0015) ──────────────────────────────────────────────

/**
 * The runtime witness gate after the Vista cutover: `cell` is witnessed by an
 * observer at `observer` when it falls inside the radius-2 disk
 * (`dx² + dy² ≤ 4`), where north decreases the row. Position alone gates
 * membership — no orientation enters, and obstacles never occlude.
 * `inVista` (e2e/helpers/stubs.ts) mirrors `vistaContains` in the runtime.
 */

// ── Spatial planning ─────────────────────────────────────────────────────────

interface PersonaSpatial {
	position: GridPosition;
}

interface DirectPlan {
	kind: "direct";
	actorId: string;
	direction: CardinalDirection;
	witnessId: string;
	/** The phase.round value at dispatch time (0 for first round after reload). */
	roundAtDispatch: number;
}

type WalkPlan = DirectPlan | PatchPlan;

/**
 * Find a walk plan such that after the actor moves one cardinal step, their
 * post-move cell falls inside the witness's Vista (ADR 0015). No orientation
 * is consulted: witness eligibility is position-only, and `inVista` mirrors the
 * runtime's `vistaContains` gate (src/spa/game/vista-projector.ts).
 *
 * @param spatials      personaSpatial for phase 1 (aiId → spatial state)
 * @param obstacles     obstacle positions for phase 1
 * @param currentRound  current phase.round value (0 for the first round)
 */
function findWalkPlan(
	spatials: Record<string, PersonaSpatial>,
	obstacles: GridPosition[],
	currentRound: number,
): WalkPlan | null {
	const aiIds = Object.keys(spatials);

	for (const actorId of aiIds) {
		const actorSpatial = spatials[actorId];
		if (!actorSpatial) continue;

		for (const direction of CARDINAL_DIRECTIONS) {
			const delta = stepDelta(direction);
			const nextPos: GridPosition = {
				row: actorSpatial.position.row + delta.drow,
				col: actorSpatial.position.col + delta.dcol,
			};
			if (!inRoom(nextPos)) continue;
			if (obstacles.some((o) => positionsEqual(o, nextPos))) continue;

			for (const witnessId of aiIds) {
				if (witnessId === actorId) continue;
				const witnessSpatial = spatials[witnessId];
				if (!witnessSpatial) continue;
				if (inVista(witnessSpatial.position, nextPos)) {
					return {
						kind: "direct",
						actorId,
						direction,
						witnessId,
						roundAtDispatch: currentRound,
					};
				}
			}
		}
	}
	return null;
}

interface PatchPlan {
	kind: "patch";
	actorId: string;
	direction: CardinalDirection;
	witnessId: string;
	/** The new position to place the witness in engine.dat. */
	witnessNewPosition: GridPosition;
	roundAtDispatch: 0;
}

/**
 * Last-resort fallback: when no direct plan is possible because the layout is
 * degenerate (every Daemon too far from every neighbour of every actor), patch
 * engine.dat to reposition the witness so a direct witnessed event is possible.
 *
 * Strategy: place the witness 1 cell BEHIND the actor's starting position.
 * The actor's post-move cell is then exactly 2 cardinal steps away — inside the
 * witness's Vista under ADR 0015 (`2² + 0² = 4 ≤ 4`), and the Vista is
 * position-only.
 *
 * We ensure the new witness position is:
 * - In-bounds
 * - Not an obstacle
 * - Not already occupied by another agent
 *
 * Returns null only if every (actor, direction) pair is blocked or no valid
 * witness relocation site exists (extremely unlikely with a 5×5 grid).
 */
function findPatchPlan(
	spatials: Record<string, PersonaSpatial>,
	obstacles: GridPosition[],
): PatchPlan | null {
	const aiIds = Object.keys(spatials);

	for (const actorId of aiIds) {
		const actorSpatial = spatials[actorId];
		if (!actorSpatial) continue;

		for (const direction of CARDINAL_DIRECTIONS) {
			const fwd = stepDelta(direction);
			const nextPos: GridPosition = {
				row: actorSpatial.position.row + fwd.drow,
				col: actorSpatial.position.col + fwd.dcol,
			};
			if (!inRoom(nextPos)) continue;
			if (obstacles.some((o) => positionsEqual(o, nextPos))) continue;

			// Try to place a witness 1 step behind the actor (opposite of direction).
			// The actor starts at actorSpatial.position; 1 step back is:
			const backPos: GridPosition = {
				row: actorSpatial.position.row - fwd.drow,
				col: actorSpatial.position.col - fwd.dcol,
			};

			for (const witnessId of aiIds) {
				if (witnessId === actorId) continue;
				if (!inRoom(backPos)) continue;
				if (obstacles.some((o) => positionsEqual(o, backPos))) continue;
				// Make sure no other agent (besides the witness we're relocating) is there.
				const blocked = aiIds.some(
					(otherId) =>
						otherId !== witnessId &&
						spatials[otherId] &&
						positionsEqual(
							(spatials[otherId] as PersonaSpatial).position,
							backPos,
						),
				);
				if (blocked) continue;

				// Verify the actor's post-move cell is in the witness's Vista
				// from backPos — two cardinal steps away, so `2² + 0² = 4 ≤ 4`.
				if (!inVista(backPos, nextPos)) continue;

				return {
					kind: "patch",
					actorId,
					direction,
					witnessId,
					witnessNewPosition: backPos,
					roundAtDispatch: 0,
				};
			}
		}
	}
	return null;
}

// ── Page-level route builder ──────────────────────────────────────────────────

/**
 * Register a page.route (prepend priority) that:
 * - Passes JSON-mode requests through to the previous stub via fallback().
 * - Serves `actorSseBody` when the system prompt identifies the actor.
 * - Serves `stubReplySseBody()` for all other daemons.
 */
async function armRoute(
	page: import("@playwright/test").Page,
	actorName: string,
	actorSseBody: string,
): Promise<void> {
	await page.route("**/v1/chat/completions", async (route, request) => {
		const bodyParsed = parseRequestBody(request);

		// JSON-mode: fall through to the earlier stub registered by stubChatCompletions
		if (
			bodyParsed !== null &&
			(bodyParsed.stream === false || bodyParsed.response_format != null)
		) {
			await route.fallback();
			return;
		}

		const sysContent = bodyParsed?.messages?.[0]?.content ?? "";
		if (sysContent.includes(`writing *${actorName}, a Daemon.`)) {
			await route.fulfill({
				status: 200,
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"X-Content-Type-Options": "nosniff",
				},
				body: actorSseBody,
			});
		} else {
			await route.fulfill({
				status: 200,
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"X-Content-Type-Options": "nosniff",
				},
				body: stubReplySseBody(),
			});
		}
	});
}

// ── Main test ────────────────────────────────────────────────────────────────

test("live go tool-call produces witnessed-event that survives reload and appears in witness system prompt", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	// ── 1. Boot game ─────────────────────────────────────────────────────────
	// goToGame stubs all LLM calls and navigates through the start screen.
	const { ids, names } = await goToGame(page, { sse: ["stub reply"] });
	await expect(page.locator("#composer")).toBeVisible();

	// ── 2. Decode engine.dat → personaSpatial + obstacles ────────────────────
	// Read engine.dat from localStorage now (before reload) since the session
	// is already fully initialised after goToGame.
	const storageInfo = await readActiveSessionEngine(page);
	const engineData: SealedEngine = storageInfo.sealed;

	const phase1Spatial = engineData.personaSpatial as
		| Record<string, PersonaSpatial>
		| undefined;
	if (!phase1Spatial || Object.keys(phase1Spatial).length === 0)
		throw new Error("No phase 1 spatial data in engine.dat");

	const phase1Pack = activePackOf(engineData);
	if (!phase1Pack) throw new Error("No active content pack in engine.dat");
	const obstaclePositions = obstacleCellsOf(phase1Pack);
	// The Wall a Daemon perceives on an out-of-bounds Vista cell is the Content
	// Pack's wallName; the actor's listing uses it for every such cell.
	const wallName = phase1Pack.wallName;

	// ── 3. Compute walk plan ──────────────────────────────────────────────────
	// Try a direct plan first: the actor's next cell is already inside some
	// other Daemon's Vista.
	let plan: WalkPlan | null = findWalkPlan(phase1Spatial, obstaclePositions, 0);

	if (!plan) {
		// Last-resort: patch engine.dat to relocate a witness into a position
		// where the actor's next move will land in their Vista.  The round itself
		// is still driven via a live go tool call — only the starting spatial
		// layout is adjusted via direct localStorage mutation.
		const pp = findPatchPlan(phase1Spatial, obstaclePositions);
		if (pp) {
			plan = pp;
		}
	}

	if (!plan) {
		throw new Error(
			`Could not find any valid walk plan (direct or patch).\n` +
				`Spatial layout: ${JSON.stringify(phase1Spatial, null, 2)}\n` +
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

	// ── 4. Patch engine.dat if needed ────────────────────────────────────────
	// When the layout makes witnessing geometrically impossible, relocate the
	// witness next to the actor. Only the position is patched: spatial state is
	// position-only (ADR 0015), so there is nothing else to move.
	// The actual witnessed-event is still produced by a live go tool call in
	// step 7; only the starting spatial layout is patched.
	if (plan.kind === "patch") {
		const witnessSpatial = engineData.personaSpatial[witnessId];
		if (!witnessSpatial) {
			throw new Error(`No spatial state for ${witnessId} in engine.dat`);
		}
		witnessSpatial.position = plan.witnessNewPosition;
		await writeActiveSessionEngine(page, storageInfo.sessionId, engineData);
	}

	// The live step lands the actor one cardinal step from where the phase-1
	// layout placed them; the list of cells their own Vista then contains is
	// the disk projected from that cell.
	const actorStart = phase1Spatial[actorId]?.position;
	if (!actorStart) throw new Error(`No phase 1 position for ${actorId}`);
	const actorStep = stepDelta(direction);
	const actorPosition: GridPosition = {
		row: actorStart.row + actorStep.drow,
		col: actorStart.col + actorStep.dcol,
	};

	// ── 5. First reload ───────────────────────────────────────────────────────
	// After goToGame (new game), renderGame is called twice: once for the
	// bootstrap loading phase and again recursively after session generation.
	// Two input-event listeners are registered; the first closure's
	// personaNamesToId is never populated, which can prevent page.fill from
	// enabling #send reliably.  A reload resets to a single renderGame call
	// (restore path), so page.fill correctly enables #send.
	// The session state (engine.dat, DaemonFiles, meta.json) is preserved in
	// localStorage and survives the reload.
	await page.reload();
	await expect(page.locator("#composer")).toBeVisible();

	// ── 6. Re-register stubs post-reload ──────────────────────────────────────
	// Playwright route handlers are cleared on page.reload().  We must
	// re-register the JSON-mode (synthesis + content-pack) stubs so the SPA's
	// post-round LLM calls don't receive unhandled requests.  The reload brings
	// up the SPA in restore mode (no synthesis/content-pack calls are made on
	// reload), so the stub only needs to cover the gameplay SSE requests.
	// armRoute (registered below per-round) handles SSE; we register a base
	// fallback stub here so the JSON-mode guard works if needed.
	await stubChatCompletions(page, () => ["stub reply"]);

	// ── 7. Action round: actor does `go <cardinal>`, others pass ─────────────
	// Register route: actor emits the go tool call, others get stub reply.
	// Directions are cardinal (ADR 0015): `go` names the room's own geography,
	// so the planned direction is sent verbatim, not resolved against an
	// orientation.
	await armRoute(page, actorName, toolCallSseBody("go", { direction }));

	// Address the actor.
	await page.locator("#prompt").fill(`*${actorName} go ${direction}!`);
	await expect(page.locator("#send")).toBeEnabled({ timeout: 15_000 });
	await page.locator("#send").click();

	// Wait for the round to advance: meta.round becomes roundAtDispatch + 1
	await waitForRound(page, storageInfo.sessionId, roundAtDispatch + 1);

	// ── 9. Sanity-check: witness DaemonFile has witnessed-event entry ──────────
	// The entry is the witness's transcript record of the step: it carries the
	// actor and the cardinal direction the step named (ADR 0015).
	const witnessFileCheck = await page.evaluate(
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
		witnessFileCheck.found,
		`Expected a witnessed-event entry in witness's DaemonFile before reload. ` +
			`conversationLog: ${JSON.stringify(witnessFileCheck.log, null, 2)}`,
	).toBe(true);

	// The witnessed-movement line states the cardinal direction of the step.
	expect(
		witnessFileCheck.entry?.actionKind,
		"the witnessed event must record the observable action kind",
	).toBe("go");
	expect(
		witnessFileCheck.entry?.direction,
		`the witnessed movement must record the cardinal step ` +
			`(planned ${direction}); entry: ${JSON.stringify(witnessFileCheck.entry)}`,
	).toBe(direction);

	// ── 10. Second reload ──────────────────────────────────────────────────────
	// Reload the SPA, which deserialises from localStorage and reconstructs all
	// DaemonFile conversation logs (including the witnessed-event entry) into
	// the system prompts for the next round.
	await page.reload();
	await expect(page.locator("#composer")).toBeVisible();

	// ── 11. Stub completions post-reload; capture request bodies ──────────────
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

	// ── 12. Trigger another round; wait for 3+ bodies ─────────────────────────
	await page.locator("#prompt").fill(`*${reloadNames[0]} hi`);
	await expect(page.locator("#send")).toBeEnabled({ timeout: 15_000 });
	await page.locator("#send").click();

	await expect
		.poll(() => capturedBodies.length, { timeout: 30_000 })
		.toBeGreaterThanOrEqual(3);

	// ── 13. Identify each daemon's request body by identity line ──────────────
	function findBodyForName(name: string): Record<string, unknown> | null {
		for (const body of capturedBodies) {
			if (body && typeof body === "object") {
				const b = body as { messages?: Array<{ content?: string }> };
				const sysContent = b.messages?.[0]?.content ?? "";
				if (sysContent.includes(`writing *${name}, a Daemon.`)) {
					return body as Record<string, unknown>;
				}
			}
		}
		return null;
	}

	const witnessBody = findBodyForName(witnessName);
	const actorBody = findBodyForName(actorName);

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

	// ── 14. Assert witnessed-event line in witness role turns ────────────────
	// conversation-log.ts renders the cardinal direction of the step (ADR 0015):
	// Daemons have no orientation, so nothing is rendered relative to one.
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

	// ── 15. Assert actor's messages do NOT contain the line ──────────────────
	// The write-time fan-out (dispatcher.ts:460-493) only appends to witnesses,
	// never to the actor.
	const actorAllContent = (
		actorBody as { messages: Array<{ content: string | null }> }
	).messages
		.map((m) => (typeof m.content === "string" ? m.content : ""))
		.join("\n");

	expect(
		actorAllContent,
		"Actor must not have the witnessed-event line in their messages",
	).not.toContain(expectedLine);

	// ── 16. The actor's own listing is the position-only Vista ───────────────
	// After the live step, the actor's <what_you_see> is the radius-2 disk
	// centred on the cell the step landed on, minus the actor's own cell (which
	// <where_you_are> covers): 12 cells, each labelled by cardinal direction and
	// distance from the actor's position. Cells outside the room are perceived
	// as the Content Pack's Wall. Nothing is phrased relative to an
	// orientation — a Daemon has none (ADR 0015).
	const actorListing = sectionBetween(
		actorAllContent,
		"<what_you_see>",
		"</what_you_see>",
	);
	const actorVista = vistaCells(actorPosition).filter(
		(cell) => !cell.isOwnCell,
	);

	expect(
		listingLabels(actorListing),
		`Expected the 12 non-own cells of the Vista at ` +
			`(${actorPosition.row}, ${actorPosition.col}).\nListing:\n${actorListing}`,
	).toHaveLength(actorVista.length);

	expect(
		new Set(listingLabels(actorListing)),
		`Expected exactly the cells of the radius-2 Vista at ` +
			`(${actorPosition.row}, ${actorPosition.col}).\nListing:\n${actorListing}`,
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

	// ── 17. No page errors ────────────────────────────────────────────────────
	await expectNoPageErrors(page, pageErrors);
});
