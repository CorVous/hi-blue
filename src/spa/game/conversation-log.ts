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
 *
 * Supported entry kinds:
 *   - `message`: incoming/outgoing DM lines.
 *   - `witnessed-event`: lines describing observed physical actions.
 *   - `action-failure`: actor-only lines recording dispatcher rejections.
 *   - `broadcast`: sender-less system announcement rendered as `[Round N] <content>`.
 */

import { cardinalToRelative } from "./direction.js";
import type {
	AiId,
	AiPersona,
	CardinalDirection,
	ConversationEntry,
	PersonaSpatialState,
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
 *
 * Exported for `openai-message-builder.ts`, which interleaves witnessed events
 * with chat messages in role-turn form. Internal callers (the system-prompt
 * conversation block, when present) reach this via `buildConversationLog`.
 *
 * @param witnessState  Optional spatial state of the witnessing AI. When
 *   provided, movement directions in witnessed-event lines are rendered
 *   relative to the witness's facing rather than as raw cardinals.
 */
export function renderEntry(
	entry: ConversationEntry,
	aiId: AiId,
	entities: WorldEntity[],
	witnessState?: PersonaSpatialState,
): string {
	const round = entry.round;
	switch (entry.kind) {
		case "message": {
			if (entry.to === aiId) {
				// Incoming: render as "<fromLabel> dms you: <content>"
				const fromLabel = entry.from === "blue" ? "blue" : `*${entry.from}`;
				return `[Round ${round}] ${fromLabel} dms you: ${entry.content}`;
			}
			// Outgoing: render as "you dm <toLabel>: <content>"
			const toLabel = entry.to === "blue" ? "blue" : `*${entry.to}`;
			return `[Round ${round}] you dm ${toLabel}: ${entry.content}`;
		}

		case "witnessed-event": {
			const actorSub = `*${entry.actor}`;
			switch (entry.actionKind) {
				case "go": {
					// Render direction relative to the witness's facing if available,
					// falling back to the raw cardinal for logs and dev tools.
					let dirLabel: string = entry.direction ?? "forward";
					if (entry.direction && witnessState) {
						dirLabel = cardinalToRelative(
							witnessState.facing,
							entry.direction as CardinalDirection,
						);
					}
					return `[Round ${round}] You watch ${actorSub} walk ${dirLabel}.`;
				}

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
					if (entry.placementFlavorRaw) {
						return `[Round ${round}] ${substituteActor(entry.placementFlavorRaw, actorSub)}`;
					}
					if (entry.useOutcome) {
						return `[Round ${round}] ${substituteActor(entry.useOutcome, actorSub)}`;
					}
					const name = entry.item ? itemName(entities, entry.item) : "item";
					return `[Round ${round}] You watch ${actorSub} use the ${name}.`;
				}
			}
			// All inner cases return; this break is unreachable but satisfies the
			// linter's no-fallthrough-switch-clause rule.
			break;
		}

		case "action-failure": {
			// Strip a trailing period from reason to keep the formatted line clean.
			const reason = entry.reason.replace(/\.$/, "");
			return `[Round ${round}] Your \`${entry.tool}\` action failed: ${reason}.`;
		}

		case "witnessed-obstacle-shift": {
			return `[Round ${round}] ${entry.flavor}`;
		}

		case "broadcast": {
			return `[Round ${round}] ${entry.content}`;
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
	/**
	 * Optional spatial state of the AI whose log is being built.
	 * When provided, movement directions in witnessed-event "go" lines are
	 * rendered relative to this AI's facing rather than as raw cardinals.
	 */
	witnessState?: PersonaSpatialState;
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
		lines.push(
			renderEntry(entry, aiId, input.worldEntities, input.witnessState),
		);
	}
	return lines;
}
