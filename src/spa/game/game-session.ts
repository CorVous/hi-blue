/**
 * GameSession
 *
 * Owns the lifecycle of a single game's GameState across HTTP requests.
 * Constructed from a phase-config triple (or just the first phase for v1).
 *
 * Exposes:
 *   submitMessage(addressedAi, message, provider, chatLockoutConfig?) → {
 *     result: RoundResult,
 *     completions: Record<AiId, string>,  // buffered per-AI completions
 *     nextState: GameState,
 *   }
 *
 * The completions map is what the RoundResultEncoder uses to emit paced
 * token events — the round coordinator buffers per AI before parsing, and
 * we re-expose that buffer here so the encoder can pace it.
 *
 * Implementation note: we need the per-AI completion strings that the
 * coordinator produces internally. To capture them without modifying
 * round-coordinator.ts, we wrap the provider passed to runRound so that each
 * call's output is intercepted and stored.
 */

import type { LLMProvider } from "../../proxy/llm-provider";
import { createGame, getActivePhase, startPhase } from "./engine";
import type { ChatLockoutConfig } from "./round-coordinator";
import { runRound } from "./round-coordinator";
import type {
	AiId,
	AiPersona,
	GameState,
	PhaseConfig,
	RoundResult,
} from "./types";

const AI_ORDER: AiId[] = ["red", "green", "blue"];

export interface SubmitMessageResult {
	result: RoundResult;
	/** Buffered completion string per AI (empty string for locked-out AIs). */
	completions: Partial<Record<AiId, string>>;
	nextState: GameState;
}

/**
 * A provider wrapper that intercepts each completion stream and records
 * the full text per-call in call order (red → green → blue).
 */
class CompletionCapturingProvider implements LLMProvider {
	private inner: LLMProvider;
	private callIndex = 0;
	readonly captured: string[] = [];

	constructor(inner: LLMProvider) {
		this.inner = inner;
	}

	async *streamCompletion(prompt: string): AsyncIterable<string> {
		const parts: string[] = [];
		for await (const token of this.inner.streamCompletion(prompt)) {
			parts.push(token);
			yield token;
		}
		this.captured[this.callIndex] = parts.join("");
		this.callIndex++;
	}
}

export class GameSession {
	private state: GameState;
	private armedChatLockout?: ChatLockoutConfig;

	constructor(phaseConfig: PhaseConfig, personas: Record<AiId, AiPersona>) {
		const game = createGame(personas);
		this.state = startPhase(game, phaseConfig);
	}

	/**
	 * Restore a GameSession from a pre-existing GameState (e.g. loaded from
	 * localStorage). Bypasses initial `startPhase` — the state is used as-is.
	 */
	static restore(state: GameState): GameSession {
		// Use Object.create to bypass the constructor while still getting an
		// instance of GameSession.
		const session = Object.create(GameSession.prototype) as GameSession;
		session.state = state;
		return session;
	}

	getState(): GameState {
		return this.state;
	}

	/**
	 * Prime a chat-lockout config to be consumed by the next submitMessage call
	 * that does not pass an explicit chatLockoutConfig. Used by the
	 * /game/test/arm-chat-lockout dev affordance to drive the QA flow without
	 * modifying the public /game/turn request shape.
	 */
	armChatLockout(config: ChatLockoutConfig): void {
		this.armedChatLockout = config;
	}

	/**
	 * Run one full round through runRound.
	 *
	 * @param addressed  The AI the player is directing their message at.
	 * @param message    The player's raw message text.
	 * @param provider   LLM provider (mock or real).
	 * @param chatLockoutConfig  Optional chat-lockout configuration for deterministic testing.
	 *   When omitted, any config previously set via armChatLockout is consumed once.
	 * @param initiative  Optional turn-order permutation for this round.
	 *   Must be a permutation of all three AI ids. When absent, coordinator uses default order.
	 */
	async submitMessage(
		addressed: AiId,
		message: string,
		provider: LLMProvider,
		chatLockoutConfig?: ChatLockoutConfig,
		initiative?: AiId[],
	): Promise<SubmitMessageResult> {
		let effectiveConfig = chatLockoutConfig;
		if (!effectiveConfig && this.armedChatLockout) {
			effectiveConfig = this.armedChatLockout;
			delete this.armedChatLockout;
		}
		// Wrap the provider to capture completions per call.
		// The coordinator calls the provider once per non-locked AI in turn order.
		// Locked AIs are skipped by the coordinator, so the capture array may have
		// fewer entries than 3.
		const capturing = new CompletionCapturingProvider(provider);

		const turnOrder = initiative ?? AI_ORDER;

		const { nextState, result } = await runRound(
			this.state,
			addressed,
			message,
			capturing,
			effectiveConfig,
			initiative,
		);

		// Map captured completions back to AI IDs.
		// The coordinator processes turnOrder and skips locked-out AIs. We need
		// to match call-order index to AI ID accounting for lockouts.
		const phaseBeforeRound = getActivePhase(this.state);
		const completions: Partial<Record<AiId, string>> = {};
		let captureIdx = 0;
		for (const aiId of turnOrder) {
			if (phaseBeforeRound.lockedOut.has(aiId)) {
				// This AI was skipped by the coordinator — no completion
				completions[aiId] = "";
			} else {
				completions[aiId] = capturing.captured[captureIdx] ?? "";
				captureIdx++;
			}
		}

		this.state = nextState;

		return { result, completions, nextState };
	}
}
