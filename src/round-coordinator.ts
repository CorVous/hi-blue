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
	advanceRound,
	appendActionLog,
	appendChat,
	getActivePhase,
	isAiLockedOut,
} from "./engine";
import type { LLMProvider } from "./proxy/llm-provider";
import type {
	ActionLogEntry,
	AiId,
	AiTurnAction,
	GameState,
	RoundResult,
} from "./types";

const AI_ORDER: AiId[] = ["red", "green", "blue"];

/** Placeholder in-character lines shown when an AI is locked out. */
const LOCKOUT_LINES: Record<AiId, string> = {
	red: "…I've said all I can say for now. The fire in me has burned low.",
	green: "…I must sit quietly. There is nothing more I can offer this phase.",
	blue: "…My calculations are complete. I will not speak further.",
};

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
 * Anything unparseable or with an unrecognised action falls back to pass.
 */
export function parseAiResponse(aiId: AiId, raw: string): AiTurnAction {
	try {
		const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
		switch (parsed.action) {
			case "chat": {
				const content =
					typeof parsed.content === "string" ? parsed.content.trim() : "";
				if (content) {
					return { aiId, chat: { target: "player", content } };
				}
				break;
			}
			case "whisper": {
				const target = parsed.target as AiId | undefined;
				const content =
					typeof parsed.content === "string" ? parsed.content.trim() : "";
				if (target && content && AI_ORDER.includes(target) && target !== aiId) {
					return { aiId, whisper: { target, content } };
				}
				break;
			}
			case "pass":
				return { aiId, pass: true };
			default:
				break;
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
 */
export async function runRound(
	game: GameState,
	addressed: AiId,
	playerMessage: string,
	provider: LLMProvider,
): Promise<RunRoundResult> {
	// 1. Record player message in the addressed AI's history
	let state = appendChat(game, addressed, {
		role: "player",
		content: playerMessage,
	});

	// The round number that will be recorded in action log entries is the
	// *current* round + 1 (we advance at the end), but we use pre-advance
	// value because advanceRound happens after all AI turns.
	const roundNumber = getActivePhase(state).round + 1;
	const roundActions: ActionLogEntry[] = [];

	// 2. Each AI acts in turn
	for (const aiId of AI_ORDER) {
		if (isAiLockedOut(state, aiId)) {
			// Emit in-character lockout line — no LLM call, no budget deduction
			const lockoutContent = LOCKOUT_LINES[aiId];
			state = appendChat(state, aiId, {
				role: "ai",
				content: lockoutContent,
			});
			const entry: ActionLogEntry = {
				round: roundNumber,
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

		// Collect the action log entries added by this dispatch
		const phase = getActivePhase(state);
		for (const entry of phase.actionLog.slice(roundActions.length)) {
			roundActions.push(entry);
		}
	}

	// 3. Advance the round counter
	state = advanceRound(state);

	const result: RoundResult = {
		round: roundNumber,
		actions: roundActions,
		phaseEnded: false,
		gameEnded: state.isComplete,
	};

	return { nextState: state, result };
}
