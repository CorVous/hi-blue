/**
 * Round Coordinator
 *
 * Orchestrates a single game round: all three AIs act in turn.
 * For each AI:
 *   1. If locked out, emit an in-character lockout line (no LLM call).
 *   2. Otherwise, build OpenAI messages via buildOpenAiMessages, call streamRound
 *      on the RoundLLMProvider, translate the result into an AiTurnAction, and
 *      dispatch through the existing dispatcher.
 * After all three AIs act, advance the round counter.
 *
 * The player's message is appended to the addressed AI's chat history
 * before the round begins. Non-addressed AIs do not see the player message.
 *
 * The tool roundtrip for each AI (prior assistant tool_calls + results) is
 * accepted as input and updated after each AI acts, then returned in RunRoundResult
 * so the caller (GameSession) can persist it across rounds.
 */

import { availableTools } from "./available-tools";
import {
	applyComplicationResult,
	decrementComplicationCountdown,
	resolveExpiredChatLockouts,
	resolveExpiredDirectives,
	tickComplication,
} from "./complication-engine";
import { projectCone } from "./cone-projector";
import { dispatchAiTurn } from "./dispatcher";
import {
	advanceRound,
	appendMessage,
	appendPrivateSystemNotice,
	appendWitnessedConvergence,
	FAREWELL_LINE,
	isAiLockedOut,
	resolveToolDisables,
} from "./engine";
import { buildOpenAiMessages } from "./openai-message-builder";
import { buildAiContext, buildConeSnapshot } from "./prompt-builder";
import type { OpenAiMessage, RoundLLMProvider } from "./round-llm-provider";
import {
	drawDirectiveText,
	formatDirectiveDelivery,
	formatDirectiveExpiry,
	formatDirectiveRevocation,
} from "./sysadmin-directive";
import { parseToolCallArguments } from "./tool-registry";
import type {
	AiId,
	AiTurnAction,
	ConversationEntry,
	GameState,
	GridPosition,
	RoundActionRecord,
	RoundResult,
	ToolName,
	ToolRoundtripMessage,
} from "./types";
import {
	checkConvergenceTier,
	checkLoseCondition,
	checkWinCondition,
} from "./win-condition";

// Match the SPA dev-host gate used in src/spa/routes/game.ts. The
// `typeof` guard keeps this safe in test environments that don't stub
// the build-time constant.
function isDevHost(): boolean {
	return (
		typeof __WORKER_BASE_URL__ !== "undefined" &&
		__WORKER_BASE_URL__ === "http://localhost:8787" &&
		typeof location !== "undefined" &&
		location.origin === __WORKER_BASE_URL__
	);
}

export interface RunRoundResult {
	nextState: GameState;
	result: RoundResult;
	/**
	 * Updated tool roundtrip data keyed by AI id.
	 * Non-empty only for AIs that emitted tool calls this round.
	 * The caller should persist this and pass it back on the next runRound call.
	 */
	toolRoundtrip: Partial<Record<AiId, ToolRoundtripMessage>>;
	/**
	 * Per-AI canonical cone snapshot captured at the moment that AI's prompt
	 * was built this round. The caller should persist this and pass it back as
	 * `priorConeSnapshots` on the next runRound call so each AI's next prompt
	 * can include a `<whats_new>` diff against its own last view.
	 */
	coneSnapshots: Partial<Record<AiId, string>>;
}

/**
 * Run a single round.
 *
 * @param game    Current game state (must have an active phase).
 * @param addressed  The AI the player's message is directed at.
 * @param playerMessage  The player's raw message text.
 * @param provider  RoundLLMProvider (browser or mock).
 * @param rng  Optional RNG for the complication engine. Defaults to Math.random.
 *   Inject a deterministic function in tests to control complication draws.
 * @param initiative  Optional turn-order permutation. Must be a permutation of
 *   all AI ids in `game.personas`. When absent, defaults to `Object.keys(game.personas)`.
 * @param priorToolRoundtrip  Per-AI tool roundtrip from the previous round.
 *   Passed into buildOpenAiMessages to re-inject the protocol messages required
 *   by OpenAI's tool-use spec.
 * @param completionSink  Optional per-AI sink for the assistant text produced
 *   by each LLM call. Used by GameSession to capture completions for pacing.
 * @param onAiDelta  Optional per-AI live-delta callback. Fires synchronously
 *   inside the SSE parser loop for each text chunk arriving from the wire.
 *   Never called for locked-out AIs or mock providers that ignore onDelta.
 * @param priorConeSnapshots  Per-AI canonical cone snapshots from the previous
 *   round, used by `buildAiContext` to emit a `<whats_new>` diff in each AI's
 *   per-round user message.
 * @param onAiTurnComplete  Optional per-AI "turn finished" callback. Fires
 *   exactly once per AI in initiative order, AFTER any drift-to-silence
 *   retry (#254) has resolved and after dispatch. Fires for locked-out
 *   AIs too (so callers can clear per-AI UI state uniformly).
 * @param onAiDrift  Optional per-AI drift-to-silence callback. Fires when a
 *   daemon's turn drifts (produces text without a tool call) and the retry
 *   resolves. Fires exactly once per drifted AI, after retry completes,
 *   with a recovered flag indicating whether the retry rescued the turn
 *   (recovered=true means a tool call landed; recovered=false means it also
 *   dropped to pass).
 */
export async function runRound(
	game: GameState,
	addressed: AiId,
	playerMessage: string,
	provider: RoundLLMProvider,
	rng: () => number = Math.random,
	initiative?: AiId[],
	priorToolRoundtrip?: Partial<Record<AiId, ToolRoundtripMessage>>,
	completionSink?: (aiId: AiId, text: string) => void,
	onAiDelta?: (aiId: AiId, text: string) => void,
	priorConeSnapshots?: Partial<Record<AiId, string>>,
	onAiTurnComplete?: (aiId: AiId) => void,
	onAiDrift?: (aiId: AiId, recovered: boolean) => void,
): Promise<RunRoundResult> {
	const aiOrder = Object.keys(game.personas);

	// Validate initiative if provided.
	if (initiative !== undefined) {
		const sorted = [...initiative].sort();
		const expected = [...aiOrder].sort();
		if (
			sorted.length !== expected.length ||
			sorted.some((id, i) => id !== expected[i])
		) {
			throw new Error(
				`initiative must be a permutation of ${JSON.stringify(aiOrder)}, got: ${JSON.stringify(initiative)}`,
			);
		}
	}

	const turnOrder = initiative ?? aiOrder;

	// 1. Record player message in the addressed AI's history
	let state = appendMessage(game, "blue", addressed, playerMessage);

	const roundActions: RoundActionRecord[] = [];

	// Track tool roundtrip produced this round (to be returned to caller)
	const newToolRoundtrip: Partial<Record<AiId, ToolRoundtripMessage>> = {};

	// Track cone snapshots captured at prompt-build time this round (returned
	// to caller so the next round's prompt can render a `<whats_new>` diff).
	const newConeSnapshots: Partial<Record<AiId, string>> = {};

	// 2. Each AI acts in turn
	for (const aiId of turnOrder) {
		if (isAiLockedOut(state, aiId)) {
			// Emit lockout line — no LLM call, no budget deduction.
			const lockoutContent = `${state.personas[aiId]?.name ?? aiId} is unresponsive…`;
			state = appendMessage(state, aiId, "blue", lockoutContent);
			roundActions.push({
				round: state.round,
				actor: aiId,
				kind: "lockout",
				description: `${state.personas[aiId]?.name ?? aiId} is locked out`,
			});
			// Sink gets empty string for locked AI
			completionSink?.(aiId, "");
			onAiTurnComplete?.(aiId);
			continue;
		}

		// Build OpenAI messages for this AI. Pass the prior-round cone snapshot
		// so the per-round user turn can prepend a `<whats_new>` diff.
		const priorSnapshot = priorConeSnapshots?.[aiId];
		const ctx = buildAiContext(
			state,
			aiId,
			priorSnapshot !== undefined ? { prevConeSnapshot: priorSnapshot } : {},
		);
		// Capture the snapshot we just built against — the caller stores this
		// and passes it back as priorConeSnapshots next round.
		newConeSnapshots[aiId] = buildConeSnapshot(ctx);
		const priorRoundtrip = priorToolRoundtrip?.[aiId];
		const messages = buildOpenAiMessages(ctx, priorRoundtrip, state.round);

		// Compute legal tools for this AI given current game state
		const tools = availableTools(state, aiId, state.activeComplications);

		// Call the provider
		let { assistantText, toolCalls, costUsd } = await provider.streamRound(
			messages,
			tools,
			onAiDelta ? (text) => onAiDelta(aiId, text) : undefined,
			aiId,
		);

		// Drift-to-silence recovery (#254): if the model returned free-form
		// text with no tool call, retry once with a tightening nudge before
		// falling through to the drop-to-pass branch below. The retry's
		// input — the dropped first attempt and the nudge — stays in
		// `retryMessages` only; it never enters game state, the
		// conversation log, or the persisted tool roundtrip.
		if (assistantText && toolCalls.length === 0) {
			const retryMessages: OpenAiMessage[] = [
				...messages,
				{ role: "assistant", content: assistantText },
				{
					role: "user",
					content:
						"You produced text but did not emit a tool call, so no one received it. Re-emit your previous reply now as a `message({to: <recipient>, content: ...})` tool call, addressed to whoever you originally intended to speak to.",
				},
			];
			const retry = await provider.streamRound(
				retryMessages,
				tools,
				onAiDelta ? (text) => onAiDelta(aiId, text) : undefined,
				aiId,
			);
			assistantText = retry.assistantText;
			toolCalls = retry.toolCalls;
			if (retry.costUsd !== undefined) {
				costUsd = (costUsd ?? 0) + retry.costUsd;
			}
			// Fire drift callback after retry resolves, indicating whether
			// the retry rescued the turn (tool call landed).
			const recovered = retry.toolCalls.length > 0;
			onAiDrift?.(aiId, recovered);
		}

		// Capture completion text
		completionSink?.(aiId, assistantText);

		// Translate the result into an AiTurnAction.
		// Iterate all toolCalls from this response. Multiple `message` calls
		// are all accepted (dispatched in emission order). At most one
		// non-`message` call is accepted into the action slot; duplicates and
		// parse-failures are recorded as tool_failure and included in the
		// roundtrip.
		const action: AiTurnAction = { aiId };

		// Tracks emission order so we can rebuild the roundtrip's
		// assistantToolCalls in the order the model produced them.
		type PendingEntry =
			| {
					kind: "parseFail";
					tc: { id: string; name: string; argumentsJson: string };
					description: string;
					reason: string;
			  }
			| {
					kind: "message";
					tc: { id: string; name: string; argumentsJson: string };
			  }
			| {
					kind: "actionAccepted";
					tc: { id: string; name: string; argumentsJson: string };
			  }
			| {
					kind: "actionRejected";
					tc: { id: string; name: string; argumentsJson: string };
					description: string;
					reason: string;
			  };
		const pending: PendingEntry[] = [];

		let actionAssigned = false;

		const round = state.round;
		const actorName = state.personas[aiId]?.name ?? aiId;

		for (const tc of toolCalls) {
			const parseResult = parseToolCallArguments(
				tc.name as ToolName,
				tc.argumentsJson,
			);
			const tcTriple = {
				id: tc.id,
				name: tc.name,
				argumentsJson: tc.argumentsJson,
			};

			if (!parseResult.ok) {
				const failDesc = `${actorName} tried to ${tc.name} but failed: ${parseResult.reason}`;
				roundActions.push({
					round,
					actor: aiId,
					kind: "tool_failure",
					description: failDesc,
				});
				pending.push({
					kind: "parseFail",
					tc: tcTriple,
					description: failDesc,
					reason: parseResult.reason,
				});
			} else if (tc.name === "message") {
				const msgArgs = parseResult.args as { to: string; content: string };
				action.messages = action.messages ?? [];
				action.messages.push({
					to: msgArgs.to as AiId | "blue",
					content: msgArgs.content,
					toolCallId: tcTriple.id, // Preserve tool call ID for history rendering
					toolArgumentsJson: tcTriple.argumentsJson, // Preserve arguments for history rendering
				});
				pending.push({ kind: "message", tc: tcTriple });
			} else if (!actionAssigned) {
				action.toolCall = {
					name: tc.name as ToolName,
					args: parseResult.args as Record<string, string>,
				};
				actionAssigned = true;
				pending.push({ kind: "actionAccepted", tc: tcTriple });
			} else {
				// Duplicate action slot — reject as tool_failure
				const dupDesc = `${actorName} tried to take more than one action in a turn: only one action tool call per turn`;
				roundActions.push({
					round,
					actor: aiId,
					kind: "tool_failure",
					description: dupDesc,
				});
				pending.push({
					kind: "actionRejected",
					tc: tcTriple,
					description: dupDesc,
					reason: "only one action tool call per turn",
				});
			}
		}

		// Free-form assistantText without any tool call → treat as pass. The
		// one-shot retry above already fired; reaching this branch with
		// non-empty text means the retry also failed to emit a tool call (#254).
		if (!action.toolCall && action.messages === undefined) {
			if (assistantText && isDevHost()) {
				console.log(
					`[dev] ${aiId} emitted free-form text without a tool call (dropped after retry):`,
					assistantText,
				);
			}
			action.pass = true;
		}

		// Snapshot locked-out set before dispatch to detect budget exhaustion.
		const lockedOutBefore = new Set(state.lockedOut);

		// Dispatch through the existing dispatcher
		const dispatchResult = dispatchAiTurn(
			state,
			action,
			costUsd !== undefined ? { costUsd } : {},
		);
		state = dispatchResult.game;

		// Farewell line: emitted exactly once when a Daemon's budget is just exhausted.
		const justExhausted =
			!lockedOutBefore.has(aiId) && state.lockedOut.has(aiId);
		if (justExhausted) {
			const personaName = state.personas[aiId]?.name ?? aiId;
			const farewellContent = FAREWELL_LINE(personaName);
			state = appendMessage(state, aiId, "blue", farewellContent);
			roundActions.push({
				round: state.round,
				actor: aiId,
				kind: "message",
				description: farewellContent,
			});
		}

		// Collect records produced by this dispatch (examine produces none)
		for (const record of dispatchResult.records) {
			roundActions.push(record);
		}

		// Pair dispatcher records back to their originating tool calls.
		// dispatcher.ts emits exactly one record per entry in action.messages,
		// in order, followed by (if action accepted) one record for the
		// non-message action — except for examine, which produces no record
		// and feeds back via actorPrivateToolResult instead.
		const messageRecordCount = action.messages?.length ?? 0;
		const messageRecords = dispatchResult.records.slice(0, messageRecordCount);
		const actionRecord =
			actionAssigned && dispatchResult.actorPrivateToolResult === undefined
				? dispatchResult.records[messageRecordCount]
				: undefined;

		// Now walk pending in emission order and build the roundtrip.
		const recordedAssistantToolCalls: Array<{
			id: string;
			name: string;
			argumentsJson: string;
		}> = [];
		const recordedToolResults: Array<{
			tool_call_id: string;
			success: boolean;
			description: string;
			reason?: string;
		}> = [];

		/** Helper to append a tool-call entry to the actor's conversation log. */
		function appendToolCallEntry(
			entry: (typeof pending)[number],
			success: boolean,
			description: string,
			coneDelta?: string,
		) {
			const toolCallEntry: ConversationEntry = {
				kind: "tool-call",
				round: state.round,
				aiId: aiId,
				toolCallId: entry.tc.id,
				toolArgumentsJson: entry.tc.argumentsJson,
				toolName: entry.tc.name,
				result: description,
				success,
				...(coneDelta !== undefined ? { coneDelta } : {}),
			};
			state = {
				...state,
				conversationLogs: {
					...state.conversationLogs,
					[aiId]: [...(state.conversationLogs[aiId] ?? []), toolCallEntry],
				},
			};
		}

		let nextMessageIdx = 0;
		for (const entry of pending) {
			if (entry.kind === "parseFail") {
				recordedAssistantToolCalls.push(entry.tc);
				recordedToolResults.push({
					tool_call_id: entry.tc.id,
					success: false,
					description: entry.description,
					reason: entry.reason,
				});
				appendToolCallEntry(entry, false, entry.description);
			} else if (entry.kind === "actionRejected") {
				recordedAssistantToolCalls.push(entry.tc);
				recordedToolResults.push({
					tool_call_id: entry.tc.id,
					success: false,
					description: entry.description,
					reason: entry.reason,
				});
				appendToolCallEntry(entry, false, entry.description);
			} else if (entry.kind === "message") {
				const rec = messageRecords[nextMessageIdx++];
				if (rec?.kind === "tool_failure") {
					// Failed message — include in roundtrip so model sees the rejection next round
					recordedAssistantToolCalls.push(entry.tc);
					recordedToolResults.push({
						tool_call_id: entry.tc.id,
						success: false,
						description: rec.description,
					});
				}
				// Successful message: EXCLUDE from roundtrip (replays via conversationLog per ADR 0007).
			} else {
				// actionAccepted
				recordedAssistantToolCalls.push(entry.tc);
				if (dispatchResult.actorPrivateToolResult !== undefined) {
					// examine: private result fed back to actor only
					const { description, success } =
						dispatchResult.actorPrivateToolResult;
					recordedToolResults.push({
						tool_call_id: entry.tc.id,
						success,
						description,
					});
					appendToolCallEntry(entry, success, description);
				} else {
					const success = actionRecord?.kind === "tool_success";
					const description = actionRecord?.description ?? "";
					recordedToolResults.push({
						tool_call_id: entry.tc.id,
						success,
						description,
					});
					appendToolCallEntry(
						entry,
						success,
						description,
						dispatchResult.actorConeDelta,
					);
				}
			}
		}

		// Save roundtrip only when there are entries to replay.
		// msg-success-only (row 1) and pass (no calls) produce empty lists → no entry.
		// This preserves the #213 fix: no spurious double-assistant turn for message-only turns.
		if (recordedAssistantToolCalls.length > 0) {
			newToolRoundtrip[aiId] = {
				assistantToolCalls: recordedAssistantToolCalls,
				toolResults: recordedToolResults,
			};
		}

		// Per-AI "turn finished" signal — fires after dispatch, after any
		// drift-to-silence retry (#254). Callers use this for per-daemon UI
		// state that should track the coordinator's serial progress through
		// the initiative order (e.g., stripping panel spinners staged).
		onAiTurnComplete?.(aiId);
	}

	// 3. Advance the round counter
	state = advanceRound(state);

	// 4. Complication engine tick (chat lockouts, tool disables, etc. via complication-engine)
	let chatLockoutTriggered: RoundResult["chatLockoutTriggered"] | undefined;
	let chatLockoutsResolved: AiId[] | undefined;

	const complicationResult = tickComplication(state, rng);
	if (complicationResult !== null) {
		const { fired } = complicationResult;
		if (fired.kind === "sysadmin_directive") {
			const target = fired.target;
			const directiveText = drawDirectiveText(rng);

			// Revoke any pre-existing directive for this target before issuing the new one.
			const existing = state.activeComplications.find(
				(c): c is Extract<typeof c, { kind: "sysadmin_directive" }> =>
					c.kind === "sysadmin_directive" && c.target === target,
			);
			if (existing) {
				state = appendMessage(
					state,
					"sysadmin",
					target,
					formatDirectiveRevocation(existing.directive),
				);
				state = {
					...state,
					activeComplications: state.activeComplications.filter(
						(c) => !(c.kind === "sysadmin_directive" && c.target === target),
					),
				};
			}

			// Apply engine result (resets countdown, appends new entry with directive: "").
			state = applyComplicationResult(state, complicationResult, rng);

			// Patch the just-appended entry with the real directive text.
			const comps = state.activeComplications.map((c) =>
				c.kind === "sysadmin_directive" && c.target === target
					? {
							...c,
							directive: directiveText,
						}
					: c,
			);
			state = { ...state, activeComplications: comps };

			// Deliver directive message to the target Daemon only.
			state = appendMessage(
				state,
				"sysadmin",
				target,
				formatDirectiveDelivery(directiveText),
			);
		} else {
			state = applyComplicationResult(state, complicationResult, rng);
			if (fired.kind === "chat_lockout") {
				chatLockoutTriggered = {
					aiId: fired.target,
					message: `${state.personas[fired.target]?.name ?? fired.target} is unresponsive…`,
				};
			}
		}
	} else {
		state = decrementComplicationCountdown(state);
	}

	// 4b. Resolve expired tool disables and notify the affected daemons
	{
		const { game: resolvedGame, resolved } = resolveToolDisables(state);
		state = resolvedGame;
		for (const { target, tool } of resolved) {
			state = appendPrivateSystemNotice(
				state,
				target,
				`Sysadmin: Your ${tool} tool has been restored.`,
			);
		}
	}

	// 4c. Resolve expired chat lockouts
	{
		const { nextState: stateAfterResolve, resolvedAiIds } =
			resolveExpiredChatLockouts(state);
		state = stateAfterResolve;
		if (resolvedAiIds.length > 0) {
			chatLockoutsResolved = resolvedAiIds;
		}
	}

	// 4d. Resolve expired sysadmin directives and notify the targeted daemons
	{
		const { nextState: stateAfterResolve, resolved } =
			resolveExpiredDirectives(state);
		state = stateAfterResolve;
		for (const { target, directive } of resolved) {
			state = appendMessage(
				state,
				"sysadmin",
				target,
				formatDirectiveExpiry(directive),
			);
		}
	}

	// 4e. End-of-round convergence evaluation.
	// Walk pending convergence objectives; compute tier; fan out witnessed-convergence entries.
	for (const objective of state.objectives) {
		if (objective.kind !== "convergence") continue;
		if (objective.satisfactionState !== "pending") continue;

		const { tier, spaceId } = checkConvergenceTier(
			objective,
			state.world,
			state.personaSpatial,
		);

		if (tier === 0) continue;

		const spaceEntity = state.world.entities.find((e) => e.id === spaceId);
		const spaceCell =
			spaceEntity &&
			typeof spaceEntity.holder === "object" &&
			spaceEntity.holder !== null
				? (spaceEntity.holder as GridPosition)
				: null;

		if (!spaceCell) continue;

		// Split fan-out (#336): Daemons standing on the space cell receive the
		// first-person actor flavor on a dedicated channel; cone-witnesses NOT
		// on the cell receive the third-person witness flavor. No Daemon
		// receives both.
		const witnessFlavor =
			tier === 1
				? (spaceEntity?.convergenceTier1Flavor ?? "Something stirs here.")
				: (spaceEntity?.convergenceTier2Flavor ?? "Two presences converge.");
		const actorFlavor =
			tier === 1
				? (spaceEntity?.convergenceTier1ActorFlavor ??
					"You linger here; the place feels poised for company.")
				: (spaceEntity?.convergenceTier2ActorFlavor ??
					"You stand here; another presence shares the place with you.");

		for (const [daemonId, spatial] of Object.entries(state.personaSpatial)) {
			const isOccupant =
				spatial.position.row === spaceCell.row &&
				spatial.position.col === spaceCell.col;
			const cone = projectCone(spatial.position, spatial.facing);
			const witnessesCell = cone.some(
				(cell) =>
					cell.position.row === spaceCell.row &&
					cell.position.col === spaceCell.col,
			);
			if (!isOccupant && !witnessesCell) continue;

			const entry: Extract<
				ConversationEntry,
				{ kind: "witnessed-convergence" }
			> = {
				kind: "witnessed-convergence",
				round: state.round,
				spaceId,
				tier,
				flavor: isOccupant ? actorFlavor : witnessFlavor,
				audience: isOccupant ? "actor" : "witness",
			};
			state = appendWitnessedConvergence(state, daemonId, entry);
		}

		// Tier 2: satisfy the objective immediately.
		if (tier === 2) {
			state = {
				...state,
				objectives: state.objectives.map((o) =>
					o.id === objective.id
						? { ...o, satisfactionState: "satisfied" as const }
						: o,
				),
			};
		}
	}

	// 5. Check win/lose conditions — win takes priority.
	let gameEnded = false;
	if (checkWinCondition(state.world, state.objectives)) {
		state = { ...state, isComplete: true, outcome: "win" };
		gameEnded = true;
	} else if (checkLoseCondition(state.lockedOut, Object.keys(state.personas))) {
		state = { ...state, isComplete: true, outcome: "lose" };
		gameEnded = true;
	}

	const result: RoundResult = {
		round: state.round,
		actions: roundActions,
		phaseEnded: false,
		gameEnded,
		...(chatLockoutTriggered !== undefined ? { chatLockoutTriggered } : {}),
		...(chatLockoutsResolved !== undefined ? { chatLockoutsResolved } : {}),
	};

	return {
		nextState: state,
		result,
		toolRoundtrip: newToolRoundtrip,
		coneSnapshots: newConeSnapshots,
	};
}
