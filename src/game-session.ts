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

import { createGame, getActivePhase, startPhase } from "./engine";
import type { LLMProvider } from "./proxy/llm-provider";
import type { ChatLockoutConfig } from "./round-coordinator";
import { runRound } from "./round-coordinator";
import type { AiId, GameState, PhaseConfig, RoundResult } from "./types";

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

	constructor(phaseConfig: PhaseConfig) {
		const personas = {
			red: {
				id: "red" as const,
				name: "Ember",
				color: "red" as const,
				personality: "Fiery and passionate",
				goal: phaseConfig.aiGoals.red,
				budgetPerPhase: phaseConfig.budgetPerAi,
			},
			green: {
				id: "green" as const,
				name: "Sage",
				color: "green" as const,
				personality: "Calm and wise",
				goal: phaseConfig.aiGoals.green,
				budgetPerPhase: phaseConfig.budgetPerAi,
			},
			blue: {
				id: "blue" as const,
				name: "Frost",
				color: "blue" as const,
				personality: "Cold and calculating",
				goal: phaseConfig.aiGoals.blue,
				budgetPerPhase: phaseConfig.budgetPerAi,
			},
		};

		const game = createGame(personas);
		this.state = startPhase(game, phaseConfig);
	}

	getState(): GameState {
		return this.state;
	}

	/**
	 * Run one full round through runRound.
	 *
	 * @param addressed  The AI the player is directing their message at.
	 * @param message    The player's raw message text.
	 * @param provider   LLM provider (mock or real).
	 * @param chatLockoutConfig  Optional chat-lockout configuration for deterministic testing.
	 */
	async submitMessage(
		addressed: AiId,
		message: string,
		provider: LLMProvider,
		chatLockoutConfig?: ChatLockoutConfig,
	): Promise<SubmitMessageResult> {
		// Wrap the provider to capture completions per call.
		// The coordinator calls the provider once per non-locked AI in AI_ORDER
		// (red, green, blue). Locked AIs are skipped by the coordinator, so
		// the capture array may have fewer entries than 3.
		const capturing = new CompletionCapturingProvider(provider);

		const { nextState, result } = await runRound(
			this.state,
			addressed,
			message,
			capturing,
			chatLockoutConfig,
		);

		// Map captured completions back to AI IDs.
		// The coordinator processes AI_ORDER and skips locked-out AIs. We need
		// to match call-order index to AI ID accounting for lockouts.
		const phaseBeforeRound = getActivePhase(this.state);
		const completions: Partial<Record<AiId, string>> = {};
		let captureIdx = 0;
		for (const aiId of AI_ORDER) {
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
