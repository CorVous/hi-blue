import { expect, test } from "@playwright/test";
import {
	expectNoPageErrors,
	getAiHandles,
	goToGame,
	stubChatCompletions,
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
 *   2. Decode engine.dat → read personaSpatial (actor positions + facings)
 *      and obstacle positions.
 *   3. Compute a walk plan: find (actorId, direction, witnessId) such that
 *      after the actor walks one cardinal step `direction`, their post-move
 *      cell falls inside the witness's Vista (ADR 0015: the 13-cell radius-2
 *      disk, position-only — a Daemon's facing no longer gates witnesses).
 *      - Try a "direct plan" with the witness where they already stand.
 *      - Otherwise patch engine.dat to relocate the witness entirely, so the
 *        move is seen.
 *   4. Reload (first reload) — after reload, renderGame is called only once
 *      (restore path), so page.fill correctly enables #send.  The engine.dat
 *      and DaemonFiles from step 1 are preserved in localStorage.
 *   5. Re-register the JSON-mode and SSE stubs (route handlers are cleared on
 *      reload).
 *   6. Drive the action round: actor `go <cardinal>`, others pass.
 *   8. Sanity-check: the witness's DaemonFile has a witnessed-event entry.
 *   9. Reload (second reload) → the SPA deserialises from storage → reconstructs.
 *  10. Capture the next round's /v1/chat/completions request bodies.
 *  11. Assert: the witness's system prompt contains the witnessed-event line
 *      inside <conversation>...</conversation>.
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

/**
 * Build a minimal OpenAI-compatible SSE body that emits a single tool call
 * and then closes. The parser in streaming.ts collects tool_calls deltas by
 * index and flushes them on finish_reason:"tool_calls" or [DONE].
 */
function toolCallSseBody(name: string, args: Record<string, string>): string {
	const toolCallChunk = JSON.stringify({
		choices: [
			{
				delta: {
					tool_calls: [
						{
							index: 0,
							id: "call_e2e_tc",
							function: {
								name,
								arguments: JSON.stringify(args),
							},
						},
					],
				},
				finish_reason: null,
			},
		],
	});
	const finishChunk = JSON.stringify({
		choices: [{ delta: {}, finish_reason: "tool_calls" }],
	});
	return `data: ${toolCallChunk}\n\ndata: ${finishChunk}\n\ndata: [DONE]\n\n`;
}

/** SSE body that returns a plain text reply ("stub reply"). */
function stubReplySseBody(): string {
	const chunk = JSON.stringify({
		choices: [{ delta: { content: "stub reply" }, finish_reason: null }],
	});
	return `data: ${chunk}\n\ndata: [DONE]\n\n`;
}

// ── Vista membership (ADR 0015) ──────────────────────────────────────────────

interface GridPosition {
	row: number;
	col: number;
}

type CardinalDirection = "north" | "south" | "east" | "west";
const DIRECTIONS: CardinalDirection[] = ["north", "south", "east", "west"];

function forwardDelta(facing: CardinalDirection): {
	drow: number;
	dcol: number;
} {
	switch (facing) {
		case "north":
			return { drow: -1, dcol: 0 };
		case "south":
			return { drow: 1, dcol: 0 };
		case "east":
			return { drow: 0, dcol: 1 };
		case "west":
			return { drow: 0, dcol: -1 };
	}
}

function inBounds(pos: GridPosition): boolean {
	return pos.row >= 0 && pos.row < 5 && pos.col >= 0 && pos.col < 5;
}

/**
 * The runtime witness gate after the Vista cutover: `cell` is witnessed by an
 * observer at `observer` when it falls inside the radius-2 disk
 * (`dx² + dy² ≤ 4`), where north decreases the row. Facing plays no part.
 */
function inVista(observer: GridPosition, cell: GridPosition): boolean {
	const dy = observer.row - cell.row;
	const dx = cell.col - observer.col;
	return dx * dx + dy * dy <= 4;
}

function posEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

// ── engine.dat codec (inlined from src/spa/persistence/sealed-blob-codec.ts) ──

const OBFUSCATION_KEY = "hi-blue:engine/v1@kJvN3pX8wQmR2sZt";

function deobfuscateEngineBlob(blob: string): string {
	const keyBytes = new TextEncoder().encode(OBFUSCATION_KEY);
	const binary = atob(blob);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] =
			(binary.charCodeAt(i) & 0xff) ^ (keyBytes[i % keyBytes.length] as number);
	}
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// ── Spatial planning ─────────────────────────────────────────────────────────

interface PersonaSpatial {
	position: GridPosition;
	facing: CardinalDirection;
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
 * post-move cell falls inside the witness's Vista (ADR 0015). Facing is not
 * consulted: witness eligibility is position-only.
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

		for (const direction of DIRECTIONS) {
			const delta = forwardDelta(direction);
			const nextPos: GridPosition = {
				row: actorSpatial.position.row + delta.drow,
				col: actorSpatial.position.col + delta.dcol,
			};
			if (!inBounds(nextPos)) continue;
			if (obstacles.some((o) => posEqual(o, nextPos))) continue;

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
	/** The new facing for the witness; the save still carries the field. */
	witnessNewFacing: CardinalDirection;
	roundAtDispatch: 0;
}

/**
 * Last-resort fallback: when no direct plan is possible because the layout is
 * degenerate (every Daemon too far from every neighbour of every actor), patch
 * engine.dat to reposition the witness so a direct witnessed event is possible.
 *
 * Strategy: place the witness 1 cell BEHIND the actor's starting position,
 * facing the same direction as the actor's planned move. The actor's post-move
 * cell is then exactly 2 cardinal steps away — inside the witness's Vista under
 * ADR 0015 (`2² + 0² = 4 ≤ 4`), so the facing is cosmetic.
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

		for (const direction of DIRECTIONS) {
			const fwd = forwardDelta(direction);
			const nextPos: GridPosition = {
				row: actorSpatial.position.row + fwd.drow,
				col: actorSpatial.position.col + fwd.dcol,
			};
			if (!inBounds(nextPos)) continue;
			if (obstacles.some((o) => posEqual(o, nextPos))) continue;

			// Try to place a witness 1 step behind the actor (opposite of direction).
			// The actor starts at actorSpatial.position; 1 step back is:
			const backPos: GridPosition = {
				row: actorSpatial.position.row - fwd.drow,
				col: actorSpatial.position.col - fwd.dcol,
			};

			for (const witnessId of aiIds) {
				if (witnessId === actorId) continue;
				if (!inBounds(backPos)) continue;
				if (obstacles.some((o) => posEqual(o, backPos))) continue;
				// Make sure no other agent (besides the witness we're relocating) is there.
				const blocked = aiIds.some(
					(otherId) =>
						otherId !== witnessId &&
						spatials[otherId] &&
						posEqual((spatials[otherId] as PersonaSpatial).position, backPos),
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
					witnessNewFacing: direction,
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
		const bodyText = request.postData() ?? "null";
		let bodyParsed: {
			stream?: boolean;
			response_format?: unknown;
			messages?: Array<{ content?: string }>;
		} | null = null;
		try {
			bodyParsed = JSON.parse(bodyText) as typeof bodyParsed;
		} catch {
			// ignore
		}

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

/**
 * Poll localStorage until meta.json reflects the given expectedRound for
 * the active phase. After `advanceRound`, phase.round becomes expectedRound.
 */
async function waitForRound(
	page: import("@playwright/test").Page,
	sessionId: string,
	expectedRound: number,
): Promise<void> {
	await page.waitForFunction(
		({
			sid,
			expectedRound: expRound,
		}: {
			sid: string;
			expectedRound: number;
		}) => {
			const metaRaw = localStorage.getItem(`hi-blue:sessions/${sid}/meta.json`);
			if (!metaRaw) return false;
			try {
				const meta = JSON.parse(metaRaw) as { round?: number };
				return (meta.round ?? 0) >= expRound;
			} catch {
				return false;
			}
		},
		{ sid: sessionId, expectedRound },
		{ timeout: 30_000 },
	);
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
	const storageInfo = await page.evaluate(() => {
		const sessionId = localStorage.getItem("hi-blue:active-session");
		if (!sessionId) throw new Error("No active session in localStorage");
		const engineBlob = localStorage.getItem(
			`hi-blue:sessions/${sessionId}/engine.dat`,
		);
		if (!engineBlob) throw new Error("engine.dat not found in localStorage");
		return { engineBlob, sessionId };
	});

	const engineJson = deobfuscateEngineBlob(storageInfo.engineBlob);
	const engineData = JSON.parse(engineJson) as {
		personaSpatial: Record<string, PersonaSpatial>;
		contentPacksA: Array<{
			obstacles: Array<{ holder: GridPosition | null }>;
		}>;
		contentPacksB: Array<{
			obstacles: Array<{ holder: GridPosition | null }>;
		}>;
		activePackId: "A" | "B";
	};

	const phase1Spatial = engineData.personaSpatial as
		| Record<string, PersonaSpatial>
		| undefined;
	if (!phase1Spatial || Object.keys(phase1Spatial).length === 0)
		throw new Error("No phase 1 spatial data in engine.dat");

	const activePacks =
		engineData.activePackId === "B"
			? engineData.contentPacksB
			: engineData.contentPacksA;
	const phase1Pack = activePacks[0];
	const obstaclePositions: GridPosition[] = (phase1Pack?.obstacles ?? [])
		.map((o) => o.holder)
		.filter((h): h is GridPosition => h !== null);

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
	// Either reorient the witness (facing-only patch) or, when the layout makes
	// witnessing geometrically impossible, relocate them next to the actor.
	// The actual witnessed-event is still produced by a live go tool call in
	// step 7; only the starting spatial layout is patched.
	if (plan.kind === "patch") {
		const patchPlan = plan;
		await page.evaluate(
			({
				sid,
				wId,
				newPos,
				newFacing,
				engineKey,
			}: {
				sid: string;
				wId: string;
				newPos: { row: number; col: number };
				newFacing: string;
				engineKey: string;
			}) => {
				const key = `hi-blue:sessions/${sid}/engine.dat`;
				const blob = localStorage.getItem(key);
				if (!blob) throw new Error("engine.dat not found");

				// Inline decode
				const keyBytes = new TextEncoder().encode(engineKey);
				const binary = atob(blob);
				const bytes = new Uint8Array(binary.length);
				for (let i = 0; i < binary.length; i++) {
					bytes[i] =
						(binary.charCodeAt(i) & 0xff) ^
						(keyBytes[i % keyBytes.length] as number);
				}
				const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
				const data = JSON.parse(json) as {
					personaSpatial: Record<
						string,
						Record<
							string,
							{ position: { row: number; col: number }; facing: string }
						>
					>;
				};

				// Patch witness position in phase "1"
				const phase1 = data.personaSpatial["1"];
				if (!phase1?.[wId]) throw new Error(`No spatial for ${wId}`);
				(
					phase1[wId] as {
						position: { row: number; col: number };
						facing: string;
					}
				).position = newPos;
				(
					phase1[wId] as {
						position: { row: number; col: number };
						facing: string;
					}
				).facing = newFacing;

				// Inline encode
				const patchedJson = JSON.stringify(data);
				const patchBytes = new TextEncoder().encode(patchedJson);
				for (let i = 0; i < patchBytes.length; i++) {
					patchBytes[i] =
						(patchBytes[i] as number) ^
						(keyBytes[i % keyBytes.length] as number);
				}
				let binOut = "";
				for (let i = 0; i < patchBytes.length; i++) {
					binOut += String.fromCharCode(patchBytes[i] as number);
				}
				localStorage.setItem(key, btoa(binOut));
			},
			{
				sid: storageInfo.sessionId,
				wId: witnessId,
				newPos: patchPlan.witnessNewPosition,
				newFacing: patchPlan.witnessNewFacing,
				engineKey: OBFUSCATION_KEY,
			},
		);
	}

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
	// so the planned direction is sent verbatim, not resolved against facing.
	await armRoute(page, actorName, toolCallSseBody("go", { direction }));

	// Address the actor.
	await page.locator("#prompt").fill(`*${actorName} go ${direction}!`);
	await expect(page.locator("#send")).toBeEnabled({ timeout: 15_000 });
	await page.locator("#send").click();

	// Wait for the round to advance: meta.round becomes roundAtDispatch + 1
	await waitForRound(page, storageInfo.sessionId, roundAtDispatch + 1);

	// ── 9. Sanity-check: witness DaemonFile has witnessed-event entry ──────────
	const witnessFileCheck = await page.evaluate(
		({ sid, wId, aId }: { sid: string; wId: string; aId: string }) => {
			const key = `hi-blue:sessions/${sid}/${wId}.txt`;
			const raw = localStorage.getItem(key);
			if (!raw) return { found: false, log: [] as unknown[] };
			const df = JSON.parse(raw) as {
				conversationLog: Array<{ kind: string; actor?: string }>;
			};
			const log = df.conversationLog;
			const found = log.some(
				(e) => e.kind === "witnessed-event" && e.actor === aId,
			);
			return { found, log };
		},
		{ sid: storageInfo.sessionId, wId: witnessId, aId: actorId },
	);

	expect(
		witnessFileCheck.found,
		`Expected a witnessed-event entry in witness's DaemonFile before reload. ` +
			`conversationLog: ${JSON.stringify(witnessFileCheck.log, null, 2)}`,
	).toBe(true);

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
	// conversation-log.ts renders direction relative to witness's facing.
	// Compute the relative direction from the plan's absolute cardinal.
	const CARDINALS = ["north", "east", "south", "west"];
	const RELATIVES = ["forward", "right", "back", "left"];

	// Determine the witness's effective facing after any plan-driven mutations.
	let witnessFacing: CardinalDirection;
	if (plan.kind === "patch") {
		witnessFacing = plan.witnessNewFacing;
	} else {
		// "direct": no mutation, use phase1 snapshot
		witnessFacing =
			(phase1Spatial?.[witnessId] as PersonaSpatial | undefined)?.facing ??
			"north";
	}

	const facingIdx = CARDINALS.indexOf(witnessFacing);
	const dirIdx = CARDINALS.indexOf(direction);
	const relativeDirection =
		RELATIVES[(dirIdx - facingIdx + 4) % 4] ?? direction;
	const expectedLine = `[Round ${roundAtDispatch}] You watch *${actorId} walk ${relativeDirection}.`;

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

	// ── 16. No page errors ────────────────────────────────────────────────────
	await expectNoPageErrors(page, pageErrors);
});
