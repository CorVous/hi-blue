/**
 * conversation-log.ts
 *
 * Builds the unified per-AI per-phase Conversation log for the system prompt.
 *
 * Interleaves three streams of events, all tagged by round:
 *   1. Voice-chat messages (player and AI turns from conversationLogs)
 *   2. Whispers received by the AI
 *   3. Witnessed events derived from physicalLog + cone-visibility
 *
 * Returns a string[] of pre-formatted lines (no leading <conversation> tag —
 * caller adds that). Lines are sorted ascending by round; within a round:
 *   voice-chat → whispers → witnessed events
 *
 * This ordering reflects the real-world action resolution sequence:
 * player message is appended first, then AIs act (tool calls → witnessed events).
 */

import { projectCone } from "./cone-projector.js";
import type {
	AiId,
	AiPersona,
	ConversationEntry,
	GridPosition,
	PhysicalActionRecord,
	WhisperMessage,
	WorldEntity,
} from "./types.js";

/** True when two GridPositions refer to the same cell. */
function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

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
 * Render a single witnessed event line for `witnessId` given a physical action record.
 *
 * Returns null if the witness is the actor, or if the actor was not in the witness's
 * cone at the time of the action.
 */
function renderWitnessedEvent(
	entities: WorldEntity[],
	record: PhysicalActionRecord,
	witnessId: AiId,
): string | null {
	// Witnesses don't see their own actions this way
	if (record.actor === witnessId) return null;

	// Look up this witness's spatial state at the time of the action
	const witnessSpatial = record.witnessSpatial[witnessId];
	if (!witnessSpatial) return null;

	// Compute this witness's cone at the time of the action
	const cone = projectCone(witnessSpatial.position, witnessSpatial.facing);
	const coneCells = cone.map((c) => c.position);

	// The action is witnessed iff the actor's cell is in the witness's cone
	const actorCellInCone = coneCells.some((cell) =>
		positionsEqual(cell, record.actorCellAtAction),
	);
	if (!actorCellInCone) return null;

	const actorSub = `*${record.actor}`;
	const round = record.round;

	switch (record.kind) {
		case "go":
			return `[Round ${round}] You watch ${actorSub} walk ${record.direction}.`;

		case "pick_up": {
			const name = record.item ? itemName(entities, record.item) : "item";
			return `[Round ${round}] You watch ${actorSub} pick up the ${name}.`;
		}

		case "put_down": {
			if (record.placementFlavorRaw) {
				// Verbatim placementFlavor with {actor} substituted to "*<actor>"
				return `[Round ${round}] ${substituteActor(record.placementFlavorRaw, actorSub)}`;
			}
			const name = record.item ? itemName(entities, record.item) : "item";
			return `[Round ${round}] You watch ${actorSub} put down the ${name}.`;
		}

		case "give": {
			const name = record.item ? itemName(entities, record.item) : "item";
			// If given to the witness, say "to you"; otherwise use the recipient's id
			const toStr = record.to === witnessId ? "you" : `*${record.to}`;
			return `[Round ${round}] You watch ${actorSub} give the ${name} to ${toStr}.`;
		}

		case "use": {
			if (record.useOutcome) {
				// Verbatim useOutcome with {actor} substituted to "*<actor>"
				return `[Round ${round}] ${substituteActor(record.useOutcome, actorSub)}`;
			}
			const name = record.item ? itemName(entities, record.item) : "item";
			return `[Round ${round}] You watch ${actorSub} use the ${name}.`;
		}
	}
}

/**
 * Priority weight for stable within-round ordering.
 * voice-chat (0) → whispers (1) → witnessed events (2)
 */
type EventKind = "chat" | "whisper" | "witnessed";
const EVENT_PRIORITY: Record<EventKind, number> = {
	chat: 0,
	whisper: 1,
	witnessed: 2,
};

interface LogEntry {
	round: number;
	kind: EventKind;
	/** Secondary sort: sequence index within the source array, for stable ordering. */
	seq: number;
	line: string;
}

/**
 * The minimal data slice required to build a conversation log.
 * Extracted from PhaseState so the function can accept either a real PhaseState
 * or a test fixture with only the fields it needs.
 */
export interface ConversationLogInput {
	/** Pre-filtered ConversationEntry[] for the single AI whose log is being built. */
	conversationLog: ConversationEntry[];
	/** All whispers for this phase. */
	whispers: WhisperMessage[];
	/** Append-only log of observable physical actions. */
	physicalLog: PhysicalActionRecord[];
	/** World entities (for item name resolution). */
	worldEntities: WorldEntity[];
}

/**
 * Build the unified conversation log for a single AI in the current phase.
 *
 * @param input     The minimal data slice from the phase state.
 * @param aiId      The AI whose log to build.
 * @param _personas All persona objects (reserved for future name-resolution use).
 * @returns Array of formatted log lines. Empty when nothing has happened yet.
 */
export function buildConversationLog(
	input: ConversationLogInput,
	aiId: AiId,
	_personas: Record<AiId, AiPersona>,
): string[] {
	const entries: LogEntry[] = [];

	// 1. Voice-chat: from the per-AI conversationLog (kind === "chat" entries only)
	const chatEntries = input.conversationLog.filter((e) => e.kind === "chat");
	for (let i = 0; i < chatEntries.length; i++) {
		const entry = chatEntries[i];
		if (!entry || entry.kind !== "chat") continue;
		let line: string;
		if (entry.role === "player") {
			line = `[Round ${entry.round}] A voice says: "${entry.content}"`;
		} else {
			line = `[Round ${entry.round}] You: "${entry.content}"`;
		}
		entries.push({ round: entry.round, kind: "chat", seq: i, line });
	}

	// 2. Whispers received by this AI
	const whispers = input.whispers.filter((w) => w.to === aiId);
	for (let i = 0; i < whispers.length; i++) {
		const w = whispers[i];
		if (!w) continue;
		const line = `[Round ${w.round}] *${w.from} whispered to you: "${w.content}"`;
		entries.push({ round: w.round, kind: "whisper", seq: i, line });
	}

	// 3. Witnessed events derived from physicalLog
	for (let i = 0; i < input.physicalLog.length; i++) {
		const record = input.physicalLog[i];
		if (!record) continue;
		const line = renderWitnessedEvent(input.worldEntities, record, aiId);
		if (line) {
			entries.push({ round: record.round, kind: "witnessed", seq: i, line });
		}
	}

	// Sort by round ascending, then by event kind priority, then by seq for stability
	entries.sort((a, b) => {
		if (a.round !== b.round) return a.round - b.round;
		const pa = EVENT_PRIORITY[a.kind];
		const pb = EVENT_PRIORITY[b.kind];
		if (pa !== pb) return pa - pb;
		return a.seq - b.seq;
	});

	return entries.map((e) => e.line);
}
