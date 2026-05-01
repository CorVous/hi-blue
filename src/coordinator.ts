import { parseAiTurnAction } from "./action-parser";
import { buildAiContext } from "./context-builder";
import { dispatchAiTurn } from "./dispatcher";
import {
	advanceRound,
	appendChat,
	getActivePhase,
	isAiLockedOut,
} from "./engine";
import type { AiId, GameState, RoundResult } from "./types";

// ---------------------------------------------------------------------------
// LLMProvider extension for per-AI routing
// ---------------------------------------------------------------------------

/**
 * Extended interface that accepts an optional aiId so coordinators can
 * route different prompts (and mock responses) per AI.
 */
export interface CoordinatorLLMProvider {
	streamCompletion(userMessage: string, aiId?: AiId): AsyncIterable<string>;
}

/**
 * Mock LLM provider for coordinator tests.
 * Accepts a per-AI scripted reply map and an optional fallback.
 */
export class PerAiMockLLMProvider implements CoordinatorLLMProvider {
	private readonly replies: Partial<Record<AiId, string>>;
	private readonly fallback: string;

	constructor(replies: Partial<Record<AiId, string>>, fallback = "[PASS]") {
		this.replies = replies;
		this.fallback = fallback;
	}

	async *streamCompletion(
		_userMessage: string,
		aiId?: AiId,
	): AsyncIterable<string> {
		const response =
			(aiId !== undefined ? this.replies[aiId] : undefined) ?? this.fallback;
		// Yield word-by-word like the existing MockLLMProvider
		const tokens = response
			.split(" ")
			.flatMap((word, i, arr) => (i < arr.length - 1 ? [word, " "] : [word]));
		for (const token of tokens) {
			yield token;
		}
	}
}

// ---------------------------------------------------------------------------
// Lockout copy (placeholder; final lines come from content slice #18)
// ---------------------------------------------------------------------------

const LOCKOUT_LINE: Record<AiId, string> = {
	red: "…I find I have nothing more to say for now.",
	green: "…I have said all I can for the moment.",
	blue: "…My thoughts have run their course.",
};

// ---------------------------------------------------------------------------
// RoundCoordinator
// ---------------------------------------------------------------------------

export interface RoundOutcome {
	result: RoundResult;
	nextState: GameState;
}

const AI_ORDER: readonly AiId[] = ["red", "green", "blue"] as const;

/**
 * Runs all three AIs for a single round and returns the updated GameState
 * and a RoundResult summary.
 *
 * - Player message is appended to the addressed AI's chat history first.
 * - Each AI gets a context-aware prompt, produces a raw string, which is
 *   parsed into an AiTurnAction and dispatched through the engine.
 * - Locked-out AIs are skipped; their turn produces a chat lockout line
 *   that is added to the player-facing chat only (not the action log).
 * - After all AI turns, the round counter is incremented.
 */
export class RoundCoordinator {
	private readonly provider: CoordinatorLLMProvider;

	constructor(provider: CoordinatorLLMProvider) {
		this.provider = provider;
	}

	async runRound(
		game: GameState,
		playerMessage: string,
		addressedAi: AiId,
	): Promise<RoundOutcome> {
		// Append player message to the addressed AI's chat history
		let state = appendChat(game, addressedAi, {
			role: "player",
			content: playerMessage,
		});

		const roundActions: RoundResult["actions"] = [];

		for (const aiId of AI_ORDER) {
			if (isAiLockedOut(state, aiId)) {
				// Locked out: emit an in-character line to the player chat
				const lockoutLine = LOCKOUT_LINE[aiId];
				state = appendChat(state, aiId, {
					role: "ai",
					content: lockoutLine,
				});
				// No action-log entry; lockout is not an "action"
				continue;
			}

			// Build context and collect full LLM response
			const ctx = buildAiContext(state, aiId);
			const prompt = ctx.toSystemPrompt();
			let rawResponse = "";
			for await (const token of this.provider.streamCompletion(prompt, aiId)) {
				rawResponse += token;
			}

			// Parse raw response into a structured action
			const action = parseAiTurnAction(aiId, rawResponse);

			// Dispatch through engine (handles chat, whisper, pass, budget)
			const dispatch = dispatchAiTurn(state, action);
			state = dispatch.game;

			// Collect the new action log entries from this turn
			const phase = getActivePhase(state);
			const newEntries = phase.actionLog.slice(roundActions.length);
			roundActions.push(...newEntries);
		}

		// Advance round counter
		state = advanceRound(state);

		const phase = getActivePhase(state);

		const result: RoundResult = {
			round: phase.round,
			actions: roundActions,
			phaseEnded: false,
			gameEnded: false,
		};

		return { result, nextState: state };
	}
}
