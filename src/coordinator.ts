import { buildAiContext } from "./context-builder";
import { dispatchAiTurn } from "./dispatcher";
import { advanceRound, appendChat, isAiLockedOut } from "./engine";
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
	/** The chat text sent to the player (if the AI chatted). */
	chatContent?: string;
	/** Whether this AI was locked out (budget exhausted). */
	lockedOut: boolean;
	/** In-character lockout explanation (present when lockedOut is true). */
	lockoutMessage?: string;
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

// ─── In-character lockout lines (placeholder; final lines come from content) ──

const LOCKOUT_LINES: Record<AiId, string> = {
	red: "I need a moment to collect myself. Perhaps later.",
	green: "My thoughts are spent for now. I must rest.",
	blue: "Sufficient for this phase. I have nothing further to add.",
};

// ─── MockLLMProvider ──────────────────────────────────────────────────────────

/**
 * A test double that returns pre-configured responses keyed by AI ID.
 * Implements the same interface as a real LLM provider.
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

	constructor(provider: LLMProvider) {
		this.provider = provider;
	}

	/**
	 * Runs one full round:
	 * 1. Advances the round counter.
	 * 2. Appends the player's message to the targeted AI's chat history.
	 * 3. For each of the three AIs (in order red→green→blue):
	 *    - If locked out: emit in-character lockout line, skip LLM call.
	 *    - Otherwise: build context, call provider, dispatch resulting action.
	 * Returns the new game state and per-AI round responses.
	 */
	async runRound(game: GameState, input: RoundInput): Promise<RoundOutput> {
		// Advance round counter
		let state = advanceRound(game);

		// Record the player's message in the targeted AI's chat history
		state = appendPlayerMessage(state, input.targetAiId, input.playerMessage);

		const aiResponses: AiRoundResponse[] = [];

		for (const aiId of AI_ORDER) {
			if (isAiLockedOut(state, aiId)) {
				// AI is exhausted — emit lockout notice, skip LLM
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

			// Call provider
			const response = await this.provider.complete(systemPrompt, aiId);

			// Map provider response to a dispatcher action
			const action = responseToAction(response, aiId);

			// Dispatch — this updates chat history, whispers, action log, budget
			const dispatchResult = dispatchAiTurn(state, action);
			state = dispatchResult.game;

			// Build per-AI round response for the UI
			const roundResponse: AiRoundResponse = {
				aiId,
				lockedOut: false,
			};
			if (response.type === "chat" && response.content) {
				roundResponse.chatContent = response.content;
			}
			aiResponses.push(roundResponse);
		}

		return { game: state, aiResponses };
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
