import { buildAiContext } from "./context-builder";
import { dispatchAiTurn } from "./dispatcher";
import {
	advanceRound,
	appendChat,
	getChatLockout,
	isAiLockedOut,
	setChatLockout,
	tickChatLockout,
} from "./engine";
import type { AiId, AiTurnAction, GameState } from "./types";

// ─── LLM Provider interface ───────────────────────────────────────────────────

export interface AiResponse {
	type: "chat" | "whisper" | "pass";
	content?: string;
	target?: AiId;
}

export interface LLMProvider {
	complete(context: string, aiId: AiId): Promise<AiResponse>;
}

// ─── Per-AI result returned from a round ─────────────────────────────────────

export interface AiRoundResponse {
	aiId: AiId;
	/** The chat text sent to the player (if the AI chatted and is not chat-locked). */
	chatContent?: string;
	/** Whether this AI was budget-exhaustion locked out (cannot act at all). */
	lockedOut: boolean;
	/** In-character budget-exhaustion lockout explanation (present when lockedOut is true). */
	lockoutMessage?: string;
	/**
	 * Whether this AI's player→AI chat channel is currently chat-locked
	 * (mid-phase event — distinct from budget-exhaustion lockout).
	 * The AI still takes turns; only player-facing chat is suppressed.
	 */
	chatLockedOut?: boolean;
	/**
	 * In-character message displayed when a chat-lockout starts.
	 * Present only when chatLockedOut is true and the lockout was just triggered.
	 */
	chatLockoutMessage?: string;
}

// ─── Round input ──────────────────────────────────────────────────────────────

export interface RoundInput {
	playerMessage: string;
	targetAiId: AiId;
}

// ─── Round output ─────────────────────────────────────────────────────────────

export interface RoundOutput {
	game: GameState;
	aiResponses: AiRoundResponse[];
}

// ─── Coordinator options ──────────────────────────────────────────────────────

export interface RoundCoordinatorOptions {
	/**
	 * Random number generator returning [0, 1).
	 * Injected for deterministic tests; defaults to Math.random in production.
	 */
	rng?: () => number;
}

// ─── In-character lockout lines (placeholder; final lines come from content) ──

/**
 * Budget-exhaustion in-character lockout lines.
 * Used when an AI has spent all its phase budget.
 */
const LOCKOUT_LINES: Record<AiId, string> = {
	red: "I need a moment to collect myself. Perhaps later.",
	green: "My thoughts are spent for now. I must rest.",
	blue: "Sufficient for this phase. I have nothing further to add.",
};

/**
 * Mid-phase chat-lockout in-character lines.
 * Used when the random chat-lockout event fires, disabling player→AI chat
 * for this AI for a fixed number of rounds. The AI itself keeps acting.
 *
 * Placeholder copy — final lines come from the content slice.
 */
const CHAT_LOCKOUT_LINES: Record<AiId, string> = {
	red: "Something has come up. I can't speak with you right now — find another way.",
	green: "I must withdraw from this conversation for a while. Seek the others.",
	blue: "Our channel is temporarily unavailable. Route around me.",
};

/** Probability that a chat-lockout fires at the start of a round (when none is active). */
const CHAT_LOCKOUT_PROBABILITY = 0.3;

/** Number of rounds a chat-lockout lasts before automatically resolving. */
const CHAT_LOCKOUT_DURATION = 3;

// ─── MockLLMProvider ──────────────────────────────────────────────────────────

/**
 * A test double that returns pre-configured responses keyed by AI ID.
 * Implements the same interface as a real LLM provider.
 *
 * NOTE: There is a duplicate MockLLMProvider in src/proxy/mock-provider.ts.
 * That one targets the proxy/server interface; this one targets the coordinator.
 * They are kept separate intentionally — do not merge without resolving the
 * interface differences. (Tracked: issue #16 caveats.)
 */
export class MockLLMProvider implements LLMProvider {
	private readonly responses: Partial<Record<AiId, AiResponse>>;

	constructor(responses: Partial<Record<AiId, AiResponse>>) {
		this.responses = responses;
	}

	async complete(_context: string, aiId: AiId): Promise<AiResponse> {
		const response = this.responses[aiId];
		if (!response) {
			return { type: "pass" };
		}
		return response;
	}
}

// ─── RoundCoordinator ─────────────────────────────────────────────────────────

const AI_ORDER: AiId[] = ["red", "green", "blue"];

export class RoundCoordinator {
	private readonly provider: LLMProvider;
	private readonly rng: () => number;

	constructor(provider: LLMProvider, options: RoundCoordinatorOptions = {}) {
		this.provider = provider;
		this.rng = options.rng ?? Math.random;
	}

	/**
	 * Runs one full round:
	 * 1. Advances the round counter.
	 * 2. Optionally triggers a mid-phase chat-lockout (if RNG fires and none active).
	 * 3. Appends the player's message to the targeted AI's chat history.
	 * 4. For each of the three AIs (in order red→green→blue):
	 *    - If budget-exhaustion locked out: emit in-character lockout line, skip LLM.
	 *    - Otherwise: build context, call provider, dispatch resulting action.
	 *      Chat-locked AIs still run their full LLM turn; only player-facing
	 *      chat output is flagged so the UI can suppress/gate it.
	 * 5. Ticks down any active chat-lockout counter (resolves after N rounds).
	 * Returns the new game state and per-AI round responses.
	 */
	async runRound(game: GameState, input: RoundInput): Promise<RoundOutput> {
		// Step 1: advance round counter
		let state = advanceRound(game);

		// Step 2: maybe trigger a mid-phase chat-lockout
		const newlyLockedAiId = this.maybeTriggerChatLockout(state);
		if (newlyLockedAiId) {
			state = setChatLockout(state, {
				aiId: newlyLockedAiId,
				roundsRemaining: CHAT_LOCKOUT_DURATION,
				message: CHAT_LOCKOUT_LINES[newlyLockedAiId],
			});
		}

		// Step 3: record the player's message in the targeted AI's chat history
		state = appendPlayerMessage(state, input.targetAiId, input.playerMessage);

		const currentChatLockout = getChatLockout(state);
		const aiResponses: AiRoundResponse[] = [];

		// Step 4: each AI takes its turn
		for (const aiId of AI_ORDER) {
			if (isAiLockedOut(state, aiId)) {
				// AI is budget-exhausted — emit budget-lockout notice, skip LLM
				aiResponses.push({
					aiId,
					lockedOut: true,
					lockoutMessage: LOCKOUT_LINES[aiId],
				});
				continue;
			}

			// Build context from current game state
			const ctx = buildAiContext(state, aiId);
			const systemPrompt = ctx.toSystemPrompt();

			// Call provider — chat-locked AIs STILL get their full LLM turn
			const response = await this.provider.complete(systemPrompt, aiId);

			// Map provider response to a dispatcher action
			const action = responseToAction(response, aiId);

			// Dispatch — this updates chat history, whispers, action log, budget
			const dispatchResult = dispatchAiTurn(state, action);
			state = dispatchResult.game;

			// Build per-AI round response for the UI
			const isChatLocked =
				currentChatLockout !== null && currentChatLockout.aiId === aiId;

			const roundResponse: AiRoundResponse = {
				aiId,
				lockedOut: false,
			};

			if (isChatLocked) {
				roundResponse.chatLockedOut = true;
				// Only attach the lockout message on the first round (when it was just triggered)
				if (newlyLockedAiId === aiId) {
					roundResponse.chatLockoutMessage = CHAT_LOCKOUT_LINES[aiId];
				}
			} else if (response.type === "chat" && response.content) {
				roundResponse.chatContent = response.content;
			}

			aiResponses.push(roundResponse);
		}

		// Step 5: tick down the chat-lockout counter
		state = tickChatLockout(state);

		return { game: state, aiResponses };
	}

	/**
	 * Decides whether a chat-lockout should fire this round.
	 * Returns the AI to lock out, or null if no lockout fires.
	 * Only fires when no chat-lockout is currently active.
	 */
	private maybeTriggerChatLockout(state: GameState): AiId | null {
		// Don't trigger another lockout if one is already active
		if (getChatLockout(state) !== null) return null;

		if (this.rng() < CHAT_LOCKOUT_PROBABILITY) {
			// Pick a random AI to lock out
			const candidates = AI_ORDER.filter((id) => !isAiLockedOut(state, id));
			if (candidates.length === 0) return null;
			const idx = Math.floor(this.rng() * candidates.length);
			return candidates[idx] ?? null;
		}
		return null;
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function appendPlayerMessage(
	game: GameState,
	targetAiId: AiId,
	message: string,
): GameState {
	return appendChat(game, targetAiId, { role: "player", content: message });
}

function responseToAction(response: AiResponse, aiId: AiId): AiTurnAction {
	switch (response.type) {
		case "chat":
			return {
				aiId,
				chat: { target: "player", content: response.content ?? "" },
			};
		case "whisper":
			return {
				aiId,
				whisper: {
					target: response.target ?? "green",
					content: response.content ?? "",
				},
			};
		default:
			return { aiId, pass: true };
	}
}
