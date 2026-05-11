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
 * Per-AI tool roundtrip (the OpenAI assistant tool_calls + tool result messages
 * from the previous round) is persisted here and passed into each runRound call
 * so the message builder can re-inject them for the next round.
 */

import { startGame } from "./engine";
import type { ChatLockoutConfig } from "./round-coordinator";
import { runRound } from "./round-coordinator";
import type { RoundLLMProvider } from "./round-llm-provider";
import type {
	AiId,
	AiPersona,
	ContentPack,
	GameState,
	RoundResult,
	ToolRoundtripMessage,
} from "./types";

export interface SubmitMessageResult {
	result: RoundResult;
	/** Buffered completion string per AI (empty string for locked-out AIs). */
	completions: Partial<Record<AiId, string>>;
	nextState: GameState;
}

export class GameSession {
	private state: GameState;
	private armedChatLockout?: ChatLockoutConfig;
	/** Per-AI tool roundtrip from the last round, fed back in as prior context. */
	private toolRoundtrip: Partial<Record<AiId, ToolRoundtripMessage>> = {};
	/**
	 * Per-AI canonical cone snapshots captured during the last round's prompt
	 * build. Fed back into runRound so the next round's per-AI user message can
	 * include a `<whats_new>` diff. Empty until the first round completes.
	 */
	private coneSnapshots: Partial<Record<AiId, string>> = {};

	constructor(
		contentPack: ContentPack,
		personas: Record<AiId, AiPersona>,
		_contentPacks?: ContentPack[],
		rng?: () => number,
	) {
		this.state = startGame(
			personas,
			contentPack,
			rng !== undefined ? { rng } : {},
		);
	}

	/**
	 * Restore a GameSession from a pre-existing GameState (e.g. loaded from
	 * localStorage). Bypasses initial `startPhase` — the state is used as-is.
	 */
	static restore(state: GameState): GameSession {
		// Use Object.create to bypass the constructor while still getting an
		// instance of GameSession. Class field initializers don't fire on
		// `Object.create`, so explicitly seed the per-instance bookkeeping
		// fields here — otherwise they're `undefined` and the first
		// submitMessage trips on indexing.
		const session = Object.create(GameSession.prototype) as GameSession;
		session.state = state;
		session.toolRoundtrip = {};
		session.coneSnapshots = {};
		return session;
	}

	getState(): GameState {
		return this.state;
	}

	/**
	 * Prime a chat-lockout config to be consumed by the next submitMessage call
	 * that does not pass an explicit chatLockoutConfig. Used by the SPA's
	 * applyTestAffordances (?lockout=1) to arm a lockout without modifying the
	 * submitMessage call signature.
	 */
	armChatLockout(config: ChatLockoutConfig): void {
		this.armedChatLockout = config;
	}

	/**
	 * Run one full round through runRound.
	 *
	 * @param addressed  The AI the player is directing their message at.
	 * @param message    The player's raw message text.
	 * @param provider   RoundLLMProvider (mock or real BrowserLLMProvider).
	 * @param chatLockoutConfig  Optional chat-lockout configuration for deterministic testing.
	 *   When omitted, any config previously set via armChatLockout is consumed once.
	 * @param initiative  Optional turn-order permutation for this round.
	 *   Must be a permutation of all three AI ids. When absent, coordinator uses default order.
	 * @param onAiDelta  Optional per-AI live-delta callback. Fires synchronously inside
	 *   the SSE parser loop for each text chunk arriving from the wire.
	 *   Never called for locked-out AIs or mock providers that ignore onDelta.
	 */
	async submitMessage(
		addressed: AiId,
		message: string,
		provider: RoundLLMProvider,
		chatLockoutConfig?: ChatLockoutConfig,
		initiative?: AiId[],
		onAiDelta?: (aiId: AiId, text: string) => void,
		onAiTurnComplete?: (aiId: AiId) => void,
	): Promise<SubmitMessageResult> {
		let effectiveConfig = chatLockoutConfig;
		if (!effectiveConfig && this.armedChatLockout) {
			effectiveConfig = this.armedChatLockout;
			delete this.armedChatLockout;
		}

		const turnOrder = initiative ?? Object.keys(this.state.personas);

		// Capture completions per AI via the completionSink parameter.
		// The coordinator calls the sink once per AI (empty string for locked-out AIs).
		const completions: Partial<Record<AiId, string>> = {};
		const completionSink = (aiId: AiId, text: string): void => {
			completions[aiId] = text;
		};

		const {
			nextState,
			result,
			toolRoundtrip: newToolRoundtrip,
			coneSnapshots: newConeSnapshots,
		} = await runRound(
			this.state,
			addressed,
			message,
			provider,
			effectiveConfig,
			initiative,
			this.toolRoundtrip,
			completionSink,
			onAiDelta,
			this.coneSnapshots,
			onAiTurnComplete,
		);

		// Fill in empty string for AIs whose completions weren't captured
		// (only possible if the sink was never called, shouldn't happen normally)
		for (const aiId of turnOrder) {
			if (!(aiId in completions)) {
				completions[aiId] = "";
			}
		}

		// Update state and tool roundtrip
		this.state = nextState;
		// Merge: keep only the AIs that had tool calls this round; clear others
		// (each round's tool roundtrip is independent — only the most recent matters)
		this.toolRoundtrip = {};
		for (const [aiId, roundtrip] of Object.entries(newToolRoundtrip)) {
			this.toolRoundtrip[aiId as AiId] = roundtrip;
		}
		// Replace cone snapshots with this round's captures. Locked-out AIs
		// don't appear in newConeSnapshots — they keep their prior snapshot so
		// the diff resumes cleanly when the lockout lifts.
		for (const [aiId, snap] of Object.entries(newConeSnapshots)) {
			this.coneSnapshots[aiId as AiId] = snap;
		}

		return { result, completions, nextState };
	}
}
