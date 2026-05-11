/**
 * RoundResultEncoder
 *
 * Pure function: translates a RoundResult plus the post-round PhaseState into
 * a flat sequence of SSE event payloads.
 *
 * The encoder is the single source of truth for the event wire format. Every
 * event type the SPA's game route handler understands is emitted here.
 *
 * Panel content is driven by ConversationEntry records — specifically `message`
 * entries from `phaseAfter.conversationLogs` — rather than free-form completion
 * strings. Only entries where `from === "blue"` or `to === "blue"` are emitted;
 * daemon-to-daemon entries are silently dropped (the DM-thread filter, AC #1/2).
 *
 * Event types emitted (consumed by src/spa/routes/game.ts):
 *   ai_start   — { type, aiId }
 *   message    — { type, from, to, content }  (replaces token/lockout for panel painting)
 *   ai_end     — { type }
 *   budget     — { type, aiId, remaining }
 *   lockout    — { type, aiId, content }  (budget-exhaustion only, kept for styling)
 *   chat_lockout         — { type, aiId, message }
 *   chat_lockout_resolved — { type, aiId }
 *   system_broadcast — { type, content }  (sender-less announcement, e.g. weather change)
 *   action_log — { type, entry }
 *   phase_advanced — { type, phase, setting }
 *   game_ended     — { type }
 */

import type { AiId, AiPersona, PhaseState, RoundResult } from "./types";

/**
 * A single structured SSE event ready to be serialised as
 *   data: <JSON>\n\n
 */
export type SseEvent =
	| { type: "ai_start"; aiId: AiId }
	| { type: "token"; text: string }
	| {
			type: "message";
			from: AiId | "blue";
			to: AiId | "blue";
			content: string;
	  }
	| { type: "ai_end" }
	| { type: "budget"; aiId: AiId; remaining: number }
	| { type: "lockout"; aiId: AiId; content: string }
	| { type: "chat_lockout"; aiId: AiId; message: string }
	| { type: "chat_lockout_resolved"; aiId: AiId }
	| { type: "system_broadcast"; content: string }
	| { type: "action_log"; entry: RoundResult["actions"][number] }
	| { type: "phase_advanced"; phase: 1 | 2 | 3; setting: string }
	| { type: "game_ended" };

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
 * Panel content is driven by ConversationEntry records from
 * `phaseAfter.conversationLogs`, scoped to `result.round`.  Only entries
 * where `from === "blue"` or `to === "blue"` are emitted per daemon log;
 * daemon-to-daemon entries are silently dropped (DM-thread filter).
 *
 * The `completions` param is retained for callers that pass it but is no
 * longer used for panel painting — completions are dead post-#213 (free-form
 * assistantText is dropped by the engine).
 *
 * @param result         The RoundResult returned by runRound.
 * @param completions    Unused post-#214; retained for call-site compatibility.
 * @param phaseAfter     The PhaseState after the round (for budget reads,
 *                       lockout state, and conversation logs).
 * @param personas       The personas record (for AI display names in
 *                       budget-exhaustion lockout messages).
 */
export function encodeRoundResult(
	result: RoundResult,
	completions: Partial<Record<AiId, string>>,
	phaseAfter: PhaseState,
	personas: Record<AiId, AiPersona>,
): SseEvent[] {
	// Suppress unused-variable warning; completions is retained for
	// call-site compatibility but panel painting is now conversationLog-driven.
	void completions;

	const events: SseEvent[] = [];

	const lockoutContent = (aiId: AiId): string =>
		`${personas[aiId]?.name ?? aiId} is unresponsive…`;

	for (const aiId of Object.keys(personas)) {
		const isLockedOut = phaseAfter.lockedOut.has(aiId);

		// ai_start — marks the beginning of this daemon's turn block
		events.push({ type: "ai_start", aiId });

		// Emit message events from this daemon's conversation log, scoped to
		// this round, filtered to entries where blue is sender or recipient.
		// Daemon→daemon entries are silently dropped (DM-thread filter, AC #1/2).
		//
		// NOTE: result.round is the round counter AFTER advanceRound(), so entries
		// written during the round carry round: result.round - 1.
		const playedRound = result.round - 1;
		const log = phaseAfter.conversationLogs[aiId] ?? [];
		for (const entry of log) {
			if (
				entry.kind === "message" &&
				entry.round === playedRound &&
				(entry.from === "blue" || entry.to === "blue")
			) {
				events.push({
					type: "message",
					from: entry.from,
					to: entry.to,
					content: entry.content,
				});
			}
		}

		// ai_end — marks the end of this daemon's turn block
		events.push({ type: "ai_end" });

		// budget — emit current remaining budget
		const budget = phaseAfter.budgets[aiId];
		if (budget) {
			events.push({ type: "budget", aiId, remaining: budget.remaining });
		}

		// If the AI is budget-locked out, emit a lockout event (visual indicator).
		// Budget-exhaustion lockouts are preserved as a separate event type so
		// the renderer can display the `[<name> is unresponsive…]` system line.
		if (isLockedOut) {
			events.push({
				type: "lockout",
				aiId,
				content: lockoutContent(aiId),
			});
		}
	}

	// system_broadcast — one event per broadcast entry written during this round.
	// Walk one daemon's log (all daemons receive the same broadcast entries) and
	// emit a system_broadcast event for each entry matching the played round.
	// NOTE: result.round is the round counter AFTER advanceRound(), so entries
	// written during the round carry round: result.round - 1.
	{
		const playedRound = result.round - 1;
		const firstAiId = Object.keys(personas)[0];
		if (firstAiId !== undefined) {
			const firstLog = phaseAfter.conversationLogs[firstAiId] ?? [];
			for (const entry of firstLog) {
				if (entry.kind === "broadcast" && entry.round === playedRound) {
					events.push({ type: "system_broadcast", content: entry.content });
				}
			}
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
			setting: phaseAfter.setting,
		});
	}

	// game_ended — terminal signal emitted when the game is complete.
	if (result.gameEnded) {
		events.push({ type: "game_ended" });
	}

	return events;
}
