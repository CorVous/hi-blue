import type { AiId, ConversationEntry, WorldEntity } from "./types.js";

function substituteActor(raw: string, actorLabel: string): string {
	return raw.replace(/\{actor\}/g, actorLabel);
}

function itemName(entities: WorldEntity[], itemId: string): string {
	const entity = entities.find((e) => e.id === itemId);
	return entity?.name ?? itemId;
}

export function renderEntry(
	entry: ConversationEntry,
	aiId: AiId,
	entities: WorldEntity[],
): string {
	const round = entry.round;
	switch (entry.kind) {
		case "message": {
			if (entry.to === aiId) {
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
			const toLabel = entry.to === "blue" ? "blue" : `*${entry.to}`;
			return `[Round ${round}] you dm ${toLabel}: ${entry.content}`;
		}

		case "witnessed-event": {
			const actorSub = `*${entry.actor}`;
			switch (entry.actionKind) {
				case "go": {
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
			break;
		}

		case "action-failure": {
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
			const successStr = entry.success ? "succeeded" : "failed";
			return `[Round ${round}] Your \`${entry.toolName}\` action ${successStr}: ${entry.result}`;
		}
	}
}
