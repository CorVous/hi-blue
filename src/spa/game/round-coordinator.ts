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

import { dispatchAiTurn } from "./dispatcher";
import {
	advancePhase,
	advanceRound,
	appendActionLog,
	appendChat,
	getActivePhase,
	isAiLockedOut,
	resolveChatLockouts,
	triggerChatLockout,
} from "./engine";
import { buildOpenAiMessages } from "./openai-message-builder";
import { buildAiContext } from "./prompt-builder";
import type { RoundLLMProvider } from "./round-llm-provider";
import { parseToolCallArguments, TOOL_DEFINITIONS } from "./tool-registry";
import type {
	ActionLogEntry,
	AiId,
	AiTurnAction,
	GameState,
	RoundResult,
	ToolName,
	ToolRoundtripMessage,
} from "./types";

const AI_ORDER: AiId[] = ["red", "green", "blue"];

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
 *   all three AI ids ["red","green","blue"]. When absent, defaults to AI_ORDER.
 * @param priorToolRoundtrip  Per-AI tool roundtrip from the previous round.
 *   Passed into buildOpenAiMessages to re-inject the protocol messages required
 *   by OpenAI's tool-use spec.
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
): Promise<RunRoundResult> {
	// Validate initiative if provided.
	if (initiative !== undefined) {
		const sorted = [...initiative].sort();
		const expected = [...AI_ORDER].sort();
		if (
			sorted.length !== expected.length ||
			sorted.some((id, i) => id !== expected[i])
		) {
			throw new Error(
				`initiative must be a permutation of ["red","green","blue"], got: ${JSON.stringify(initiative)}`,
			);
		}
	}

	const turnOrder = initiative ?? AI_ORDER;

	// 1. Record player message in the addressed AI's history
	let state = appendChat(game, addressed, {
		role: "player",
		content: playerMessage,
	});

	// Snapshot how many log entries already exist before this round starts.
	const logOffsetBeforeRound = getActivePhase(state).actionLog.length;
	const roundActions: ActionLogEntry[] = [];

	// Track tool roundtrip produced this round (to be returned to caller)
	const newToolRoundtrip: Partial<Record<AiId, ToolRoundtripMessage>> = {};

	// 2. Each AI acts in turn
	for (const aiId of turnOrder) {
		if (isAiLockedOut(state, aiId)) {
			// Emit lockout line — no LLM call, no budget deduction.
			const lockoutContent = `${state.personas[aiId].name} is unresponsive…`;
			state = appendChat(state, aiId, {
				role: "ai",
				content: lockoutContent,
			});
			const entry: ActionLogEntry = {
				round: getActivePhase(state).round,
				actor: aiId,
				type: "chat",
				target: "player",
				description: `${state.personas[aiId].name} is locked out`,
			};
			state = appendActionLog(state, entry);
			roundActions.push(entry);
			// Sink gets empty string for locked AI
			completionSink?.(aiId, "");
			continue;
		}

		// Build OpenAI messages for this AI
		const ctx = buildAiContext(state, aiId);
		const priorRoundtrip = priorToolRoundtrip?.[aiId];
		const messages = buildOpenAiMessages(ctx, priorRoundtrip);

		// Call the provider
		const { assistantText, toolCalls } = await provider.streamRound(
			messages,
			TOOL_DEFINITIONS,
			onAiDelta ? (text) => onAiDelta(aiId, text) : undefined,
		);

		// Capture completion text
		completionSink?.(aiId, assistantText);

		// Translate the result into an AiTurnAction
		const action: AiTurnAction = { aiId };

		// Handle tool call (take first tool call if present)
		let toolCallId: string | undefined;
		const [tc] = toolCalls;
		if (tc !== undefined) {
			toolCallId = tc.id;
			const parseResult = parseToolCallArguments(
				tc.name as ToolName,
				tc.argumentsJson,
			);

			if (parseResult.ok) {
				action.toolCall = {
					name: tc.name as ToolName,
					args: parseResult.args as Record<string, string>,
				};
			} else {
				// Parse failed — synthesise a tool_failure directly without dispatching
				const round = getActivePhase(state).round;
				const failureEntry: ActionLogEntry = {
					round,
					actor: aiId,
					type: "tool_failure",
					toolName: tc.name,
					args: {},
					reason: parseResult.reason,
					description: `${state.personas[aiId].name} tried to ${tc.name} but failed: ${parseResult.reason}`,
				};
				state = appendActionLog(state, failureEntry);
				roundActions.push(failureEntry);

				// Record the tool failure in the roundtrip for the next round
				newToolRoundtrip[aiId] = {
					assistantToolCalls: toolCalls.map((c) => ({
						id: c.id,
						name: c.name,
						argumentsJson: c.argumentsJson,
					})),
					toolResults: toolCalls.map((c) => ({
						tool_call_id: c.id,
						success: false,
						description: `${state.personas[aiId].name} tried to ${tc.name} but failed: ${parseResult.reason}`,
						reason: parseResult.reason,
					})),
				};

				// Fall through: still handle assistantText below as a pass/chat
				action.pass = true;
			}
		}

		// Handle assistant text (chat or pass)
		if (assistantText?.trim()) {
			action.chat = { target: "player", content: assistantText };
		} else if (!action.toolCall) {
			// No text and no valid tool call → pass
			action.pass = true;
		}

		// Dispatch through the existing dispatcher
		const dispatchResult = dispatchAiTurn(state, action);
		state = dispatchResult.game;

		// Collect only the entries added by this dispatch
		const phase = getActivePhase(state);
		const newEntries = phase.actionLog.slice(
			logOffsetBeforeRound + roundActions.length,
		);
		for (const entry of newEntries) {
			roundActions.push(entry);
		}

		// Record tool roundtrip for this AI if a tool call was successfully parsed
		if (toolCalls.length > 0 && action.toolCall && toolCallId !== undefined) {
			// Find the tool result from the action log entries added by dispatch
			const toolSuccess = newEntries.find(
				(e) => e.type === "tool_success" || e.type === "tool_failure",
			);
			const success = toolSuccess?.type === "tool_success";
			const description = toolSuccess?.description ?? "";
			const reason =
				toolSuccess?.type === "tool_failure" ? toolSuccess.reason : undefined;

			newToolRoundtrip[aiId] = {
				assistantToolCalls: toolCalls.map((c) => ({
					id: c.id,
					name: c.name,
					argumentsJson: c.argumentsJson,
				})),
				toolResults: [
					{
						tool_call_id: toolCallId,
						success,
						description,
						...(reason !== undefined ? { reason } : {}),
					},
				],
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
			const aiIndex = Math.floor(rng() * AI_ORDER.length);
			const targetAi = AI_ORDER[aiIndex] as AiId;
			const resolveAtRound = currentRound + lockoutDuration;
			state = triggerChatLockout(state, targetAi, resolveAtRound);
			chatLockoutTriggered = {
				aiId: targetAi,
				message: `${state.personas[targetAi].name} is unresponsive…`,
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

	return { nextState: state, result, toolRoundtrip: newToolRoundtrip };
}
