/**
 * RoundResultEncoder
 *
 * Pure function: translates a RoundResult plus per-AI buffered completion
 * strings into a flat sequence of SSE event payloads.
 *
 * The encoder is the single source of truth for the SSE wire format. Every
 * event type the chat-page renderer understands is emitted here.
 *
 * Token streaming is paced word-by-word from the buffered completion string.
 * This is a deliberate v1 cheat — the round coordinator buffers the full
 * response before parsing, so the encoder re-emits it in word-chunks to give
 * the UI a progressive streaming feel. When a real streaming provider lands,
 * this function can accept token iterables directly.
 *
 * Event types emitted (matching what src/ui.ts consumes):
 *   ai_start   — { type, aiId }
 *   token      — { type, text }
 *   ai_end     — { type }
 *   budget     — { type, aiId, remaining }
 *   lockout    — { type, aiId, content }
 *   chat_lockout         — { type, aiId, message }
 *   chat_lockout_resolved — { type, aiId }
 *   action_log — { type, entry }
 *   phase_advanced — { type, phase, objective }
 *   game_ended     — { type }
 */

import type {
	AiId,
	AiPersona,
	PhaseState,
	RoundResult,
} from "./spa/game/types";

/**
 * A single structured SSE event ready to be serialised as
 *   data: <JSON>\n\n
 */
export type SseEvent =
	| { type: "ai_start"; aiId: AiId }
	| { type: "token"; text: string }
	| { type: "ai_end" }
	| { type: "budget"; aiId: AiId; remaining: number }
	| { type: "lockout"; aiId: AiId; content: string }
	| { type: "chat_lockout"; aiId: AiId; message: string }
	| { type: "chat_lockout_resolved"; aiId: AiId }
	| { type: "action_log"; entry: RoundResult["actions"][number] }
	| { type: "phase_advanced"; phase: 1 | 2 | 3; objective: string }
	| { type: "game_ended" };

const AI_ORDER: AiId[] = ["red", "green", "blue"];

/**
 * Split a string into word-level chunks for paced token emission.
 * Each "word" carries any trailing whitespace so re-joining is lossless.
 */
export function splitIntoWordChunks(text: string): string[] {
	if (!text) return [];
	// Split on whitespace boundaries, keeping delimiters with the preceding word.
	const chunks: string[] = [];
	const parts = text.split(/(\s+)/);
	let current = "";
	for (const part of parts) {
		if (/^\s+$/.test(part)) {
			current += part;
			chunks.push(current);
			current = "";
		} else {
			if (current) chunks.push(current);
			current = part;
		}
	}
	if (current) chunks.push(current);
	return chunks;
}

/**
 * Encode a completed round into a flat sequence of SSE events.
 *
 * @param result         The RoundResult returned by runRound.
 * @param completions    Map from AiId to the buffered completion string for
 *                       that AI. Used only for token-pacing; the chat content
 *                       itself is authoritative in result.actions.
 * @param phaseAfter     The PhaseState after the round (for budget reads and
 *                       lockout state). Pass the active phase from nextState.
 * @param personas       The personas record (for AI display names in
 *                       budget-exhaustion lockout messages).
 */
export function encodeRoundResult(
	result: RoundResult,
	completions: Partial<Record<AiId, string>>,
	phaseAfter: PhaseState,
	personas: Record<AiId, AiPersona>,
): SseEvent[] {
	const events: SseEvent[] = [];

	const lockoutContent = (aiId: AiId): string =>
		`${personas[aiId].name} is unresponsive…`;

	for (const aiId of AI_ORDER) {
		const completion = completions[aiId] ?? "";
		const isLockedOut = phaseAfter.lockedOut.has(aiId);

		// ai_start
		events.push({ type: "ai_start", aiId });

		if (!completion) {
			// AI was budget-locked out — emit lockout event and no tokens
			events.push({
				type: "lockout",
				aiId,
				content: lockoutContent(aiId),
			});
		} else {
			// Emit paced token events from the buffered completion string
			const chunks = splitIntoWordChunks(completion);
			for (const chunk of chunks) {
				events.push({ type: "token", text: chunk });
			}
		}

		// ai_end
		events.push({ type: "ai_end" });

		// budget — emit current remaining budget
		const budget = phaseAfter.budgets[aiId];
		if (budget) {
			events.push({ type: "budget", aiId, remaining: budget.remaining });
		}

		// If the AI exhausted its budget this round (had a turn but is now locked),
		// emit a lockout event after the turn block.
		if (isLockedOut && completion) {
			events.push({
				type: "lockout",
				aiId,
				content: lockoutContent(aiId),
			});
		}
	}

	// action_log entries for all actions this round
	for (const action of result.actions) {
		events.push({ type: "action_log", entry: action });
	}

	// chat_lockout — if a lockout was triggered this round
	if (result.chatLockoutTriggered) {
		events.push({
			type: "chat_lockout",
			aiId: result.chatLockoutTriggered.aiId,
			message: result.chatLockoutTriggered.message,
		});
	}

	// chat_lockout_resolved — for each AI whose lockout expired this round
	if (result.chatLockoutsResolved) {
		for (const aiId of result.chatLockoutsResolved) {
			events.push({ type: "chat_lockout_resolved", aiId });
		}
	}

	// phase_advanced — emitted when the phase advanced but the game is not over.
	// phaseAfter is the new phase state when phaseEnded is true, so read from it.
	if (result.phaseEnded && !result.gameEnded) {
		events.push({
			type: "phase_advanced",
			phase: phaseAfter.phaseNumber,
			objective: phaseAfter.objective,
		});
	}

	// game_ended — terminal signal emitted when the game is complete.
	if (result.gameEnded) {
		events.push({ type: "game_ended" });
	}

	return events;
}
