/**
 * Round Coordinator
 *
 * Orchestrates a single game round: all three AIs act in turn.
 * For each AI:
 *   1. If locked out, emit an in-character lockout line (no LLM call).
 *   2. Otherwise, build the AI's context, call the LLM provider, parse the
 *      response into an AiTurnAction, and dispatch it through the existing
 *      dispatcher.
 * After all three AIs act, advance the round counter.
 *
 * The player's message is appended to the addressed AI's chat history
 * before the round begins. Non-addressed AIs do not see the player message.
 */

import { buildAiContext } from "./context-builder";
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
import type { LLMProvider } from "./proxy/llm-provider";
import type {
	ActionLogEntry,
	AiId,
	AiTurnAction,
	GameState,
	RoundResult,
	ToolName,
} from "./types";

const AI_ORDER: AiId[] = ["red", "green", "blue"];

/** Placeholder in-character lines shown when an AI is locked out (budget). */
const LOCKOUT_LINES: Record<AiId, string> = {
	red: "…I've said all I can say for now. The fire in me has burned low.",
	green: "…I must sit quietly. There is nothing more I can offer this phase.",
	blue: "…My calculations are complete. I will not speak further.",
};

/**
 * In-character lines shown to the player when their chat channel to an AI is
 * temporarily locked out (distinct from budget-exhaustion lockout).
 * Final copy comes from slice #18; these are placeholders.
 */
const CHAT_LOCKOUT_LINES: Record<AiId, string> = {
	red: "…The flames have gone quiet. Ember withdraws — you cannot reach her right now.",
	green: "…Sage has turned inward. This channel is closed for a time.",
	blue: "…Frost has gone silent. Your messages cannot reach him just now.",
};

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
}

/**
 * Parses a raw LLM completion string into an AiTurnAction.
 *
 * Expected JSON shape (any extra fields are ignored):
 *   { "action": "chat",    "content": "…" }
 *   { "action": "whisper", "target": "<aiId>", "content": "…" }
 *   { "action": "pass" }
 *
 * An optional toolCall field may accompany any action:
 *   { "action": "chat", "content": "…", "toolCall": { "name": "pick_up", "args": { "item": "flower" } } }
 *
 * Anything unparseable or with an unrecognised action falls back to pass.
 * An unrecognised toolCall.name is passed through; the dispatcher will
 * validate and log a tool_failure with reason "Unknown tool".
 */
export function parseAiResponse(aiId: AiId, raw: string): AiTurnAction {
	try {
		const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;

		// Parse optional toolCall field
		let toolCall: AiTurnAction["toolCall"] | undefined;
		if (parsed.toolCall && typeof parsed.toolCall === "object") {
			const tc = parsed.toolCall as Record<string, unknown>;
			if (typeof tc.name === "string" && tc.name.length > 0) {
				const args =
					tc.args && typeof tc.args === "object"
						? (tc.args as Record<string, string>)
						: {};
				// Cast to ToolName — dispatcher will reject unknown names via validateToolCall
				toolCall = {
					name: tc.name as ToolName,
					args,
				};
			}
		}

		switch (parsed.action) {
			case "chat": {
				const content =
					typeof parsed.content === "string" ? parsed.content.trim() : "";
				if (content) {
					return {
						aiId,
						chat: { target: "player", content },
						...(toolCall ? { toolCall } : {}),
					};
				}
				break;
			}
			case "whisper": {
				const target = parsed.target as AiId | undefined;
				const content =
					typeof parsed.content === "string" ? parsed.content.trim() : "";
				if (target && content && AI_ORDER.includes(target) && target !== aiId) {
					return {
						aiId,
						whisper: { target, content },
						...(toolCall ? { toolCall } : {}),
					};
				}
				break;
			}
			case "pass":
				return { aiId, pass: true, ...(toolCall ? { toolCall } : {}) };
			default:
				break;
		}
		// If we have a toolCall but the action was unrecognised, still dispatch it
		if (toolCall) {
			return { aiId, pass: true, toolCall };
		}
	} catch {
		// not JSON — fall through to pass
	}
	return { aiId, pass: true };
}

/** Collect all tokens from the provider into a single string. */
async function collectCompletion(
	provider: LLMProvider,
	prompt: string,
): Promise<string> {
	const parts: string[] = [];
	for await (const token of provider.streamCompletion(prompt)) {
		parts.push(token);
	}
	return parts.join("");
}

/**
 * Run a single round.
 *
 * @param game    Current game state (must have an active phase).
 * @param addressed  The AI the player's message is directed at.
 * @param playerMessage  The player's raw message text.
 * @param provider  LLM provider (real or mock).
 * @param chatLockoutConfig  Optional config for the mid-phase chat-lockout event.
 *   When provided, the coordinator will trigger a lockout at `lockoutTriggerRound`
 *   using `rng` to select which AI to lock, lasting `lockoutDuration` rounds.
 */
export async function runRound(
	game: GameState,
	addressed: AiId,
	playerMessage: string,
	provider: LLMProvider,
	chatLockoutConfig?: ChatLockoutConfig,
): Promise<RunRoundResult> {
	// 1. Record player message in the addressed AI's history
	let state = appendChat(game, addressed, {
		role: "player",
		content: playerMessage,
	});

	// Snapshot how many log entries already exist before this round starts.
	// The phase actionLog is cumulative across rounds, so we must offset into
	// it correctly when slicing new entries after each AI acts.
	const logOffsetBeforeRound = getActivePhase(state).actionLog.length;
	const roundActions: ActionLogEntry[] = [];

	// 2. Each AI acts in turn
	for (const aiId of AI_ORDER) {
		if (isAiLockedOut(state, aiId)) {
			// Emit in-character lockout line — no LLM call, no budget deduction.
			// Use getActivePhase(state).round for consistency with dispatchAiTurn,
			// which also reads the pre-advance phase.round value.
			const lockoutContent = LOCKOUT_LINES[aiId];
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
			continue;
		}

		// Build context and call provider
		const ctx = buildAiContext(state, aiId);
		const systemPrompt = ctx.toSystemPrompt();
		const raw = await collectCompletion(provider, systemPrompt);

		// Parse the response into an action
		const action = parseAiResponse(aiId, raw);

		// Dispatch through the existing dispatcher (handles budget deduction,
		// appendChat, appendWhisper, appendActionLog, etc.)
		const dispatchResult = dispatchAiTurn(state, action);
		state = dispatchResult.game;

		// Collect only the entries added by this dispatch. The log is cumulative
		// across rounds, so offset by both the pre-round baseline and the entries
		// we've already collected within this round.
		const phase = getActivePhase(state);
		for (const entry of phase.actionLog.slice(
			logOffsetBeforeRound + roundActions.length,
		)) {
			roundActions.push(entry);
		}
	}

	// 3. Advance the round counter
	state = advanceRound(state);

	// 4. Mid-phase chat-lockout: trigger at the configured round, resolve expired ones.
	let chatLockoutTriggered: RoundResult["chatLockoutTriggered"] | undefined;
	let chatLockoutsResolved: AiId[] | undefined;

	if (chatLockoutConfig) {
		const { rng, lockoutTriggerRound, lockoutDuration } = chatLockoutConfig;
		const currentRound = getActivePhase(state).round;

		// Trigger a new lockout if this is the designated round and no lockout
		// is already active for any AI (we lock at most one AI per phase).
		const alreadyHasLockout = getActivePhase(state).chatLockouts.size > 0;
		if (currentRound === lockoutTriggerRound && !alreadyHasLockout) {
			const aiIndex = Math.floor(rng() * AI_ORDER.length);
			const targetAi = AI_ORDER[aiIndex] as AiId;
			const resolveAtRound = currentRound + lockoutDuration;
			state = triggerChatLockout(state, targetAi, resolveAtRound);
			chatLockoutTriggered = {
				aiId: targetAi,
				message: CHAT_LOCKOUT_LINES[targetAi],
			};
		}

		// Resolve any lockouts that have expired this round.
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

	// 5. Check win condition against the post-round phase state.
	//    If met, advance to the next phase (or mark game complete).
	const activePhaseAfterRound = getActivePhase(state);
	let phaseEnded = false;

	if (activePhaseAfterRound.winCondition?.(activePhaseAfterRound)) {
		phaseEnded = true;
		state = advancePhase(state, activePhaseAfterRound.nextPhaseConfig);
	}

	const result: RoundResult = {
		round: activePhaseAfterRound.round, // post-advance value = completed round number
		actions: roundActions,
		phaseEnded,
		gameEnded: state.isComplete,
		...(chatLockoutTriggered !== undefined ? { chatLockoutTriggered } : {}),
		...(chatLockoutsResolved !== undefined ? { chatLockoutsResolved } : {}),
	};

	return { nextState: state, result };
}
