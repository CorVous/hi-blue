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
import { dispatchAiTurn } from "./dispatcher";
import {
	advancePhase,
	advanceRound,
	appendMessage,
	getActivePhase,
	isAiLockedOut,
	resolveChatLockouts,
	triggerChatLockout,
} from "./engine";
import { buildOpenAiMessages } from "./openai-message-builder";
import { buildAiContext, buildConeSnapshot } from "./prompt-builder";
import type { OpenAiMessage, RoundLLMProvider } from "./round-llm-provider";
import { parseToolCallArguments } from "./tool-registry";
import type {
	AiId,
	AiTurnAction,
	GameState,
	RoundActionRecord,
	RoundResult,
	ToolName,
	ToolRoundtripMessage,
} from "./types";

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

/**
 * Configuration for the mid-phase chat-lockout event.
 *
 * Inject this into `runRound` to make randomness deterministic in tests.
 *
 * @param rng              Returns a value in [0, 1). Used to pick which AI to lock.
 * @param lockoutTriggerRound  The round number (post-advance) at which to fire the lockout.
 * @param lockoutDuration  How many rounds the lockout lasts (resolves after this many).
 */
export interface ChatLockoutConfig {
	rng: () => number;
	lockoutTriggerRound: number;
	lockoutDuration: number;
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
 * @param chatLockoutConfig  Optional config for the mid-phase chat-lockout event.
 * @param initiative  Optional turn-order permutation. Must be a permutation of
 *   all AI ids in `game.personas`. When absent, defaults to `Object.keys(game.personas)`.
 * @param priorToolRoundtrip  Per-AI tool roundtrip from the previous round.
 *   Passed into buildOpenAiMessages to re-inject the protocol messages required
 *   by OpenAI's tool-use spec.
 * @param priorConeSnapshots  Per-AI canonical cone snapshots from the previous
 *   round, used by `buildAiContext` to emit a `<whats_new>` diff in each AI's
 *   per-round user message.
 * @param completionSink  Optional per-AI sink for the assistant text produced
 *   by each LLM call. Used by GameSession to capture completions for pacing.
 * @param onAiDelta  Optional per-AI live-delta callback. Fires synchronously
 *   inside the SSE parser loop for each text chunk arriving from the wire.
 *   Never called for locked-out AIs or mock providers that ignore onDelta.
 */
export async function runRound(
	game: GameState,
	addressed: AiId,
	playerMessage: string,
	provider: RoundLLMProvider,
	chatLockoutConfig?: ChatLockoutConfig,
	initiative?: AiId[],
	priorToolRoundtrip?: Partial<Record<AiId, ToolRoundtripMessage>>,
	completionSink?: (aiId: AiId, text: string) => void,
	onAiDelta?: (aiId: AiId, text: string) => void,
	priorConeSnapshots?: Partial<Record<AiId, string>>,
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
				round: getActivePhase(state).round,
				actor: aiId,
				kind: "lockout",
				description: `${state.personas[aiId]?.name ?? aiId} is locked out`,
			});
			// Sink gets empty string for locked AI
			completionSink?.(aiId, "");
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
		const messages = buildOpenAiMessages(
			ctx,
			priorRoundtrip,
			getActivePhase(state).round,
		);

		// Compute legal tools for this AI given current game state
		const tools = availableTools(state, aiId);

		// Call the provider
		let { assistantText, toolCalls, costUsd } = await provider.streamRound(
			messages,
			tools,
			onAiDelta ? (text) => onAiDelta(aiId, text) : undefined,
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
						'You produced text but did not emit a tool call, so blue did not see it. Re-emit your previous reply now as a `message({to: "blue", content: ...})` call.',
				},
			];
			const retry = await provider.streamRound(
				retryMessages,
				tools,
				onAiDelta ? (text) => onAiDelta(aiId, text) : undefined,
			);
			assistantText = retry.assistantText;
			toolCalls = retry.toolCalls;
			if (retry.costUsd !== undefined) {
				costUsd = (costUsd ?? 0) + retry.costUsd;
			}
		}

		// Capture completion text
		completionSink?.(aiId, assistantText);

		// Translate the result into an AiTurnAction.
		// Iterate all toolCalls from this response; route by name into two slots:
		//   - message slot (at most one accepted `message`-named call)
		//   - action slot  (at most one accepted non-message call)
		// Duplicates within either slot and parse-failures are recorded as
		// tool_failure records and included in the roundtrip.
		const action: AiTurnAction = { aiId };

		// Slot guards: track whether each slot has been accepted
		let messageAssigned = false;
		let actionAssigned = false;

		// ID of the accepted non-message action call (needed to match dispatcher result)
		let acceptedActionCallId: string | undefined;

		// Roundtrip accumulators — built inline, applied after dispatch
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

		const round = getActivePhase(state).round;
		const actorName = state.personas[aiId]?.name ?? aiId;

		for (const tc of toolCalls) {
			const parseResult = parseToolCallArguments(
				tc.name as ToolName,
				tc.argumentsJson,
			);

			if (!parseResult.ok) {
				// Parse-failed call: always goes to roundtrip as failure, never to action.*
				const failDesc = `${actorName} tried to ${tc.name} but failed: ${parseResult.reason}`;
				roundActions.push({
					round,
					actor: aiId,
					kind: "tool_failure",
					description: failDesc,
				});
				recordedAssistantToolCalls.push({
					id: tc.id,
					name: tc.name,
					argumentsJson: tc.argumentsJson,
				});
				recordedToolResults.push({
					tool_call_id: tc.id,
					success: false,
					description: failDesc,
					reason: parseResult.reason,
				});
			} else if (tc.name === "message") {
				if (!messageAssigned) {
					// Accept into message slot
					const msgArgs = parseResult.args as { to: string; content: string };
					action.message = { to: msgArgs.to, content: msgArgs.content };
					messageAssigned = true;
					// Do NOT add to recordedAssistantToolCalls here — we decide post-dispatch
					// whether the message succeeded (row 3 vs row 4 of the table).
				} else {
					// Duplicate message slot — reject as tool_failure
					const dupDesc = `${actorName} tried to send more than one message in a turn: only one message tool call per turn`;
					roundActions.push({
						round,
						actor: aiId,
						kind: "tool_failure",
						description: dupDesc,
					});
					recordedAssistantToolCalls.push({
						id: tc.id,
						name: tc.name,
						argumentsJson: tc.argumentsJson,
					});
					recordedToolResults.push({
						tool_call_id: tc.id,
						success: false,
						description: dupDesc,
						reason: "only one message tool call per turn",
					});
				}
			} else {
				// Non-message tool call
				if (!actionAssigned) {
					// Accept into action slot
					action.toolCall = {
						name: tc.name as ToolName,
						args: parseResult.args as Record<string, string>,
					};
					actionAssigned = true;
					acceptedActionCallId = tc.id;
					// Add to roundtrip accumulators — result filled in post-dispatch
					recordedAssistantToolCalls.push({
						id: tc.id,
						name: tc.name,
						argumentsJson: tc.argumentsJson,
					});
					// Placeholder — will be updated with actual success/description after dispatch
					recordedToolResults.push({
						tool_call_id: tc.id,
						success: false,
						description: "",
					});
				} else {
					// Duplicate action slot — reject as tool_failure
					const dupDesc = `${actorName} tried to take more than one action in a turn: only one action tool call per turn`;
					roundActions.push({
						round,
						actor: aiId,
						kind: "tool_failure",
						description: dupDesc,
					});
					recordedAssistantToolCalls.push({
						id: tc.id,
						name: tc.name,
						argumentsJson: tc.argumentsJson,
					});
					recordedToolResults.push({
						tool_call_id: tc.id,
						success: false,
						description: dupDesc,
						reason: "only one action tool call per turn",
					});
				}
			}
		}

		// Free-form assistantText without a message tool call → treat as
		// pass. The one-shot retry above already fired; reaching this branch
		// with non-empty text means the retry also failed to emit a tool
		// call (#254).
		if (!action.toolCall && !action.message) {
			if (assistantText && isDevHost()) {
				console.log(
					`[dev] ${aiId} emitted free-form text without a tool call (dropped after retry):`,
					assistantText,
				);
			}
			action.pass = true;
		}

		// Dispatch through the existing dispatcher
		const dispatchResult = dispatchAiTurn(
			state,
			action,
			costUsd !== undefined ? { costUsd } : {},
		);
		state = dispatchResult.game;

		// Collect records produced by this dispatch (examine produces none)
		for (const record of dispatchResult.records) {
			roundActions.push(record);
		}

		// Post-dispatch: resolve the accepted message call's roundtrip status.
		// Successful message: EXCLUDE from roundtrip (replays via conversationLog per ADR 0007).
		// Failed message (invalid recipient): INCLUDE in roundtrip with failure result.
		let msgFailRecord: RoundActionRecord | undefined;
		if (messageAssigned && action.message !== undefined) {
			// Find whether the dispatcher produced a tool_failure for the message slot.
			// dispatcher.ts applies message before toolCall (P0-1 swap), so the message
			// dispatch record comes first. The message failure is identified by the
			// "tried to message" text in the description (matches dispatcher.ts line).
			msgFailRecord = dispatchResult.records.find(
				(r) =>
					r.kind === "tool_failure" &&
					r.description.includes("tried to message"),
			);
			if (msgFailRecord) {
				// Message failed — include in roundtrip so model sees the rejection next round
				const acceptedMsgTc = toolCalls.find((tc) => tc.name === "message");
				if (acceptedMsgTc) {
					recordedAssistantToolCalls.unshift({
						id: acceptedMsgTc.id,
						name: acceptedMsgTc.name,
						argumentsJson: acceptedMsgTc.argumentsJson,
					});
					recordedToolResults.unshift({
						tool_call_id: acceptedMsgTc.id,
						success: false,
						description: msgFailRecord.description,
					});
				}
			}
			// If message succeeded: do NOT add to roundtrip (ADR 0007).
		}

		// Post-dispatch: resolve the accepted action call's result in the roundtrip.
		if (actionAssigned && acceptedActionCallId !== undefined) {
			const actionResultIdx = recordedToolResults.findIndex(
				(r) => r.tool_call_id === acceptedActionCallId && r.description === "",
			);
			if (actionResultIdx >= 0) {
				if (dispatchResult.actorPrivateToolResult !== undefined) {
					// examine: private result fed back to actor only
					const { description, success } =
						dispatchResult.actorPrivateToolResult;
					recordedToolResults[actionResultIdx] = {
						tool_call_id: acceptedActionCallId,
						success,
						description,
					};
				} else {
					// Normal tool: find the tool_success or tool_failure record from dispatcher.
					// If the message also failed, dispatchResult.records has BOTH a msg-failure
					// record and the action's record. Skip the message failure record (already
					// identified as msgFailRecord) and look for the action's record, which is
					// either tool_success or a tool_failure NOT from the message slot.
					const toolRecord = dispatchResult.records.find(
						(r) =>
							(r.kind === "tool_success" || r.kind === "tool_failure") &&
							r !== msgFailRecord,
					);
					const success = toolRecord?.kind === "tool_success";
					const description = toolRecord?.description ?? "";
					recordedToolResults[actionResultIdx] = {
						tool_call_id: acceptedActionCallId,
						success,
						description,
					};
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
	}

	// 3. Advance the round counter
	state = advanceRound(state);

	// 4. Mid-phase chat-lockout
	let chatLockoutTriggered: RoundResult["chatLockoutTriggered"] | undefined;
	let chatLockoutsResolved: AiId[] | undefined;

	if (chatLockoutConfig) {
		const { rng, lockoutTriggerRound, lockoutDuration } = chatLockoutConfig;
		const currentRound = getActivePhase(state).round;

		const alreadyHasLockout = getActivePhase(state).chatLockouts.size > 0;
		if (currentRound === lockoutTriggerRound && !alreadyHasLockout) {
			const aiIndex = Math.floor(rng() * aiOrder.length);
			const targetAi = aiOrder[aiIndex] as AiId;
			const resolveAtRound = currentRound + lockoutDuration;
			state = triggerChatLockout(state, targetAi, resolveAtRound);
			chatLockoutTriggered = {
				aiId: targetAi,
				message: `${state.personas[targetAi]?.name ?? targetAi} is unresponsive…`,
			};
		}

		const phaseBefore = getActivePhase(state);
		const expiredAis: AiId[] = [];
		for (const [aiId, resolveAtRound] of phaseBefore.chatLockouts) {
			if (phaseBefore.round >= resolveAtRound) {
				expiredAis.push(aiId);
			}
		}
		if (expiredAis.length > 0) {
			state = resolveChatLockouts(state);
			chatLockoutsResolved = expiredAis;
		}
	}

	// 5. Check win condition
	const activePhaseAfterRound = getActivePhase(state);
	let phaseEnded = false;

	if (activePhaseAfterRound.winCondition?.(activePhaseAfterRound)) {
		phaseEnded = true;
		state = advancePhase(state, activePhaseAfterRound.nextPhaseConfig);
	}

	const result: RoundResult = {
		round: activePhaseAfterRound.round,
		actions: roundActions,
		phaseEnded,
		gameEnded: state.isComplete,
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
