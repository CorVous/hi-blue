/**
 * conversation-log.ts
 *
 * Renders a single ConversationEntry (one AI's view of one log line) to its
 * formatted string. Vista membership is resolved at write-time (ADR 0006), not
 * here. Sorting + interleaving with role turns happens in openai-message-builder.
 *
 * Supported entry kinds:
 *   - `message`: incoming/outgoing DM lines.
 *   - `witnessed-event`: lines describing observed physical actions.
 *   - `action-failure`: actor-only lines recording dispatcher rejections.
 *   - `broadcast`: sender-less system announcement rendered as `[Round N] <content>`.
 */

import type { AiId, ConversationEntry, WorldEntity } from "./types.js";

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
export function renderEntry(
	entry: ConversationEntry,
	aiId: AiId,
	entities: WorldEntity[],
): string {
	const round = entry.round;
	switch (entry.kind) {
		case "message": {
			if (entry.to === aiId) {
				// Incoming: render as "<fromLabel> dms you: <content>"
				let fromLabel: string;
				if (entry.from === "blue") {
					fromLabel = "blue";
				} else if (entry.from === "sysadmin") {
					fromLabel = "the Sysadmin";
				} else {
					fromLabel = `*${entry.from}`;
				}
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
					// The cardinal direction of the step (ADR 0015). Daemons have
					// no facing, so nothing is rendered relative to an observer's
					// orientation. Entries written before `direction` was recorded
					// fall back to a directionless line rather than inventing one.
					if (!entry.direction) {
						return `[Round ${round}] You watch ${actorSub} move.`;
					}
					return `[Round ${round}] You watch ${actorSub} walk ${entry.direction}.`;
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

		case "witnessed-convergence": {
			return `[Round ${round}] ${entry.flavor}`;
		}

		case "broadcast": {
			return `[Round ${round}] ${entry.content}`;
		}

		case "tool-call": {
			// Note: renderEntry is not used for tool-call in openai-message-builder.ts;
			// that path renders directly with entry.result and optional diskDelta enrichment.
			// This function is kept for completeness but not on the render path.
			const successStr = entry.success ? "succeeded" : "failed";
			return `[Round ${round}] Your \`${entry.toolName}\` action ${successStr}: ${entry.result}`;
		}
	}
}
