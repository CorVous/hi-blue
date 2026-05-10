/**
 * conversation-log.ts
 *
 * Builds the unified per-AI per-phase Conversation log for the system prompt.
 *
 * Accepts a pre-filtered ConversationEntry[] (one AI's log) and world entities
 * for item-name resolution. Sorts ascending by round (stable — ties preserve
 * append order) and emits one formatted line per entry.
 *
 * Cone visibility is resolved at write-time (ADR 0006), not here.
 *
 * Returns a string[] of pre-formatted lines (no leading <conversation> tag —
 * caller adds that).
 */

import type {
	AiId,
	AiPersona,
	ConversationEntry,
	WorldEntity,
} from "./types.js";

/**
 * Substitute `{actor}` tokens in a flavor string.
 *
 * @param raw   Raw string with `{actor}` placeholder.
 * @param sub   Replacement string (e.g. "you" for actor, "*xxxx" for witness).
 */
function substituteActor(raw: string, sub: string): string {
	return raw.replace(/\{actor\}/g, sub);
}

/**
 * Lookup the display name of an item entity by id.
 * Falls back to the id itself if not found.
 */
function itemName(entities: WorldEntity[], itemId: string): string {
	const entity = entities.find((e) => e.id === itemId);
	return entity?.name ?? itemId;
}

/**
 * Render a single ConversationEntry line for the owning AI.
 */
function renderEntry(
	entry: ConversationEntry,
	aiId: AiId,
	entities: WorldEntity[],
): string {
	const round = entry.round;
	switch (entry.kind) {
		case "chat":
			if (entry.role === "player") {
				return `[Round ${round}] blue said: "${entry.content}"`;
			}
			return `[Round ${round}] You: "${entry.content}"`;

		case "whisper":
			return `[Round ${round}] *${entry.from} whispered to you: "${entry.content}"`;

		case "witnessed-event": {
			const actorSub = `*${entry.actor}`;
			switch (entry.actionKind) {
				case "go":
					return `[Round ${round}] You watch ${actorSub} walk ${entry.direction}.`;

				case "pick_up": {
					const name = entry.item ? itemName(entities, entry.item) : "item";
					return `[Round ${round}] You watch ${actorSub} pick up the ${name}.`;
				}

				case "put_down": {
					if (entry.placementFlavorRaw) {
						return `[Round ${round}] ${substituteActor(entry.placementFlavorRaw, actorSub)}`;
					}
					const name = entry.item ? itemName(entities, entry.item) : "item";
					return `[Round ${round}] You watch ${actorSub} put down the ${name}.`;
				}

				case "give": {
					const name = entry.item ? itemName(entities, entry.item) : "item";
					const toStr = entry.to === aiId ? "you" : `*${entry.to}`;
					return `[Round ${round}] You watch ${actorSub} give the ${name} to ${toStr}.`;
				}

				case "use": {
					if (entry.useOutcome) {
						return `[Round ${round}] ${substituteActor(entry.useOutcome, actorSub)}`;
					}
					const name = entry.item ? itemName(entities, entry.item) : "item";
					return `[Round ${round}] You watch ${actorSub} use the ${name}.`;
				}
			}
		}
	}
}

/**
 * The minimal data slice required to build a conversation log.
 * Extracted from PhaseState so the function can accept either a real PhaseState
 * or a test fixture with only the fields it needs.
 */
export interface ConversationLogInput {
	/** Pre-filtered ConversationEntry[] for the single AI whose log is being built. */
	conversationLog: ConversationEntry[];
	/** World entities (for item name resolution). */
	worldEntities: WorldEntity[];
}

/**
 * Build the unified conversation log for a single AI in the current phase.
 *
 * @param input     The minimal data slice from the phase state.
 * @param aiId      The AI whose log to build (used for give-recipient personalisation).
 * @param _personas All persona objects (reserved for future name-resolution use).
 * @returns Array of formatted log lines. Empty when nothing has happened yet.
 */
export function buildConversationLog(
	input: ConversationLogInput,
	aiId: AiId,
	_personas: Record<AiId, AiPersona>,
): string[] {
	// Sort by round ascending; ties preserve insertion order (Array.sort is stable).
	const sorted = [...input.conversationLog].sort((a, b) => a.round - b.round);

	const lines: string[] = [];
	for (const entry of sorted) {
		lines.push(renderEntry(entry, aiId, input.worldEntities));
	}
	return lines;
}
