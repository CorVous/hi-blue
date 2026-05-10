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
import { buildAiContext } from "./prompt-builder";
import type { RoundLLMProvider } from "./round-llm-provider";
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
 *   all AI ids in `game.personas`. When absent, defaults to `Object.keys(game.personas)`.
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

		// Build OpenAI messages for this AI
		const ctx = buildAiContext(state, aiId);
		const priorRoundtrip = priorToolRoundtrip?.[aiId];
		const messages = buildOpenAiMessages(ctx, priorRoundtrip, addressed);

		// Compute legal tools for this AI given current game state
		const tools = availableTools(state, aiId);

		// Call the provider
		const { assistantText, toolCalls, costUsd } = await provider.streamRound(
			messages,
			tools,
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
				if (tc.name === "message") {
					// message tool: route to action.message, not action.toolCall
					const msgArgs = parseResult.args as { to: string; content: string };
					action.message = { to: msgArgs.to, content: msgArgs.content };
				} else {
					action.toolCall = {
						name: tc.name as ToolName,
						args: parseResult.args as Record<string, string>,
					};
				}
			} else {
				// Parse failed — synthesise a tool_failure record without dispatching
				const round = getActivePhase(state).round;
				const failureRecord: RoundActionRecord = {
					round,
					actor: aiId,
					kind: "tool_failure",
					description: `${state.personas[aiId]?.name ?? aiId} tried to ${tc.name} but failed: ${parseResult.reason}`,
				};
				roundActions.push(failureRecord);

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
						description: `${state.personas[aiId]?.name ?? aiId} tried to ${tc.name} but failed: ${parseResult.reason}`,
						reason: parseResult.reason,
					})),
				};

				// Parse failed → pass
				action.pass = true;
			}
		}

		// Free-form assistantText without a message tool call → treat as pass (drop the text)
		if (!action.toolCall && !action.message) {
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

		// Record tool roundtrip for this AI if a tool call was successfully parsed
		if (
			toolCalls.length > 0 &&
			(action.toolCall || action.message) &&
			toolCallId !== undefined
		) {
			if (dispatchResult.actorPrivateToolResult !== undefined) {
				// examine: private result — NOT added to roundActions; only fed back to actor
				const { description, success } = dispatchResult.actorPrivateToolResult;
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
						},
					],
				};
			} else if (action.toolCall) {
				// Normal (non-message) tool: record the roundtrip so the next round
				// can replay tool_calls + tool results in the OpenAI message sequence.
				// The `message` tool is intentionally excluded here: the sent message
				// is already replayed via the conversationLog as an `assistant` content
				// turn. Recording a roundtrip for `message` would produce two consecutive
				// `assistant` turns in the next round (one from the log, one from the
				// priorToolRoundtrip), violating the OpenAI/OpenRouter message protocol.
				const toolRecord = dispatchResult.records.find(
					(r) => r.kind === "tool_success" || r.kind === "tool_failure",
				);
				const success = toolRecord?.kind === "tool_success";
				const description = toolRecord?.description ?? "";

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
						},
					],
				};
			}
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

	return { nextState: state, result, toolRoundtrip: newToolRoundtrip };
}
