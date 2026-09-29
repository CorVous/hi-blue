import type { AiId, AiPersona, GameState, RoundResult } from "./types";

export type SseEvent =
	| { type: "ai_start"; aiId: AiId }
	| {
			type: "message";
			from: AiId | "blue";
			to: AiId | "blue";
			content: string;
	  }
	| { type: "ai_end" }
	| { type: "budget"; aiId: AiId; remaining: number }
	| { type: "chat_lockout"; aiId: AiId; message: string }
	| { type: "chat_lockout_resolved"; aiId: AiId }
	| { type: "action_log"; entry: RoundResult["actions"][number] }
	| { type: "game_ended" };

export function encodeRoundResult(
	result: RoundResult,
	phaseAfter: GameState,
	personas: Record<AiId, AiPersona>,
): SseEvent[] {
	const events: SseEvent[] = [];
	const playedRound = result.round - 1;

	for (const aiId of Object.keys(personas)) {
		events.push({ type: "ai_start", aiId });

		const log = phaseAfter.conversationLogs[aiId] ?? [];
		for (const entry of log) {
			const inBlueThread =
				entry.kind === "message" &&
				(entry.from === "blue" || entry.to === "blue");
			if (inBlueThread && entry.round === playedRound) {
				events.push({
					type: "message",
					from: entry.from,
					to: entry.to,
					content: entry.content,
				});
			}
		}

		events.push({ type: "ai_end" });

		const budget = phaseAfter.budgets[aiId];
		if (budget) {
			events.push({ type: "budget", aiId, remaining: budget.remaining });
		}
	}

	for (const action of result.actions) {
		events.push({ type: "action_log", entry: action });
	}

	if (result.chatLockoutTriggered) {
		events.push({
			type: "chat_lockout",
			aiId: result.chatLockoutTriggered.aiId,
			message: result.chatLockoutTriggered.message,
		});
	}

	if (result.chatLockoutsResolved) {
		for (const aiId of result.chatLockoutsResolved) {
			events.push({ type: "chat_lockout_resolved", aiId });
		}
	}

	if (result.gameEnded) {
		events.push({ type: "game_ended" });
	}

	return events;
}
