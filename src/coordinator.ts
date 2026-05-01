import { parseAiTurnAction } from "./action-parser";
import { buildAiContext } from "./context-builder";
import { dispatchAiTurn } from "./dispatcher";
import {
	advancePhase,
	advanceRound,
	appendChat,
	getActivePhase,
	isAiLockedOut,
	updateActivePhase,
} from "./engine";
import type {
	AiId,
	ChatLockout,
	GameState,
	PhaseConfig,
	RoundResult,
} from "./types";

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

export interface RoundCoordinatorOptions {
	/**
	 * Probability (0-1) that a chat-lockout event triggers at the start of
	 * each round when no lockout is currently active.
	 * Default: 0 (opt-in only; production behaviour enabled by content slice #18).
	 */
	triggerProbabilityPerRound?: number;
	/**
	 * Number of rounds the chat-lockout lasts once triggered.
	 * Default: 2.
	 */
	chatLockoutDuration?: number;
	/**
	 * Injected RNG for deterministic testing. Default: Math.random.
	 */
	rng?: () => number;
	/**
	 * All three phase configs, in order. Used to look up the win condition for
	 * the currently active phase and to supply the next-phase config when
	 * advancing. When omitted, phase progression never triggers automatically.
	 */
	phaseConfigs?: [PhaseConfig, PhaseConfig, PhaseConfig];
}

const AI_ORDER: readonly AiId[] = ["red", "green", "blue"] as const;

/**
 * Runs all three AIs for a single round and returns the updated GameState
 * and a RoundResult summary.
 *
 * - Player message is appended to the addressed AI's chat history first,
 *   UNLESS the addressed AI is currently chat-locked (in which case the
 *   message is silently dropped server-side; the UI prevents sending).
 * - Each AI gets a context-aware prompt, produces a raw string, which is
 *   parsed into an AiTurnAction and dispatched through the engine.
 * - Budget-locked-out AIs are skipped; their turn produces an in-character
 *   lockout line added to the player-facing chat only (not the action log).
 * - Chat-locked AIs still receive their full turn (whispers, tools, etc.);
 *   only the player to AI chat channel is blocked.
 * - After all AI turns, the round counter is incremented.
 */
export class RoundCoordinator {
	private readonly provider: CoordinatorLLMProvider;
	private readonly triggerProbabilityPerRound: number;
	private readonly chatLockoutDuration: number;
	private readonly rng: () => number;
	private readonly phaseConfigs: [PhaseConfig, PhaseConfig, PhaseConfig] | undefined;

	constructor(
		provider: CoordinatorLLMProvider,
		options: RoundCoordinatorOptions = {},
	) {
		this.provider = provider;
		this.triggerProbabilityPerRound = options.triggerProbabilityPerRound ?? 0;
		this.chatLockoutDuration = options.chatLockoutDuration ?? 2;
		this.rng = options.rng ?? Math.random;
		this.phaseConfigs = options.phaseConfigs;
	}

	/**
	 * Check or update chat-lockout state at the start of a round.
	 * - Clears an expired lockout (endRound <= current round).
	 * - Possibly starts a new lockout if none is active and RNG fires.
	 */
	private applyLockoutLogic(game: GameState): GameState {
		const phase = getActivePhase(game);
		const currentRound = phase.round;

		// Step 1: clear expired lockout
		let updatedGame = game;
		if (
			phase.chatLockout !== undefined &&
			phase.chatLockout.endRound <= currentRound
		) {
			updatedGame = updateActivePhase(updatedGame, (p) => {
				const { chatLockout: _removed, ...rest } = p;
				return rest;
			});
		}

		// Step 2: possibly trigger a new lockout
		const phaseAfterClear = getActivePhase(updatedGame);
		if (
			phaseAfterClear.chatLockout === undefined &&
			this.rng() < this.triggerProbabilityPerRound
		) {
			const aiIndex = Math.floor(this.rng() * AI_ORDER.length);
			const lockedAiId = AI_ORDER[aiIndex] as AiId;
			const lockout: ChatLockout = {
				aiId: lockedAiId,
				startRound: currentRound,
				endRound: currentRound + this.chatLockoutDuration,
			};
			updatedGame = updateActivePhase(updatedGame, (p) => ({
				...p,
				chatLockout: lockout,
			}));
		}

		return updatedGame;
	}

	async runRound(
		game: GameState,
		playerMessage: string,
		addressedAi: AiId,
	): Promise<RoundOutcome> {
		// Apply chat-lockout logic at round start (clear expired, possibly trigger new)
		let state = this.applyLockoutLogic(game);

		// Check if the addressed AI is chat-locked; if so, skip appending player msg
		const phase0 = getActivePhase(state);
		const chatLockedAiId = phase0.chatLockout?.aiId;
		if (chatLockedAiId !== addressedAi) {
			// Not chat-locked: append player message normally
			state = appendChat(state, addressedAi, {
				role: "player",
				content: playerMessage,
			});
		}
		// If chat-locked: silently drop the player message (no-op)

		const roundActions: RoundResult["actions"] = [];

		for (const aiId of AI_ORDER) {
			if (isAiLockedOut(state, aiId)) {
				// Budget-locked out: emit an in-character line to the player chat
				const lockoutLine = LOCKOUT_LINE[aiId];
				state = appendChat(state, aiId, {
					role: "ai",
					content: lockoutLine,
				});
				// No action-log entry; lockout is not an "action"
				continue;
			}

			// Chat-locked AIs still get their full turn (whispers, tools, budget, etc.)
			// Only the player to AI chat channel is affected (handled above).

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

		let phaseEnded = false;
		let gameEnded = false;

		// Win-condition check — runs after the round is complete
		if (this.phaseConfigs) {
			const activePhaseNumber = phase.phaseNumber;
			const activeConfig = this.phaseConfigs[
				activePhaseNumber - 1
			] as PhaseConfig;
			const winCondition = activeConfig.winCondition;

			if (winCondition?.(phase, phase.world)) {
				if (activePhaseNumber === 3) {
					// Phase 3 complete → game over
					state = { ...state, isComplete: true };
					gameEnded = true;
				} else {
					// Phase 1 or 2 complete → advance to next phase
					const nextPhaseNumber = (activePhaseNumber + 1) as 2 | 3;
					const nextConfig = this.phaseConfigs[
						nextPhaseNumber - 1
					] as PhaseConfig;
					state = advancePhase(state, nextConfig);
					phaseEnded = true;
				}
			}
		}

		const result: RoundResult = {
			round: phase.round,
			actions: roundActions,
			phaseEnded,
			gameEnded,
		};

		return { result, nextState: state };
	}
}
