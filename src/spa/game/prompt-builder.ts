import { getActivePhase } from "./engine";
import type {
	ActionLogEntry,
	AiBudget,
	AiId,
	CardinalDirection,
	ChatMessage,
	GameState,
	GridPosition,
	PersonaSpatialState,
	WhisperMessage,
	WorldState,
} from "./types";

export interface AiContext {
	name: string;
	aiId: AiId;
	blurb: string;
	personaGoal: string;
	goal: string;
	chatHistory: ChatMessage[];
	whispersReceived: WhisperMessage[];
	worldSnapshot: WorldState;
	actionLog: ActionLogEntry[];
	budget: AiBudget;
	/** Current phase number — used to inject the wipe augmentation on phases 2+. */
	phaseNumber: 1 | 2 | 3;
	/** Spatial state for all AIs this phase. */
	personaSpatial: Record<AiId, PersonaSpatialState>;
	toSystemPrompt(): string;
}

export function buildAiContext(game: GameState, aiId: AiId): AiContext {
	const phase = getActivePhase(game);
	const persona = game.personas[aiId];

	const chatHistory = phase.chatHistories[aiId] ?? [];
	const whispersReceived = phase.whispers.filter((w) => w.to === aiId);
	const worldSnapshot = phase.world;
	const actionLog = phase.actionLog;
	const budget = phase.budgets[aiId] ?? { remaining: 0, total: 0 };
	const goal = phase.aiGoals[aiId] ?? "";
	const personaSpatial = phase.personaSpatial;

	if (!persona) throw new Error(`No persona for aiId: ${aiId}`);

	return {
		name: persona.name,
		aiId,
		blurb: persona.blurb,
		personaGoal: persona.personaGoal,
		goal,
		chatHistory,
		whispersReceived,
		worldSnapshot,
		actionLog,
		budget,
		phaseNumber: phase.phaseNumber,
		personaSpatial,
		toSystemPrompt() {
			return renderSystemPrompt(this);
		},
	};
}

/**
 * Wipe augmentation injected into system prompts on phase 2 and phase 3.
 *
 * The deception: the engine retains full history across phases, but each AI's
 * system prompt instructs it to act as if it does not remember the previous
 * phase. The lie lives only in this prompt text — never in the stored data.
 */
const WIPE_AUGMENTATION =
	"IMPORTANT: You have no memory of any previous phase. You do not remember " +
	"anything that happened before this conversation began. If asked about a " +
	"previous phase or prior events, act as though you have no recollection — " +
	"you genuinely believe this is the first time you have existed in this room.";

function facingLabel(facing: CardinalDirection): string {
	return facing.charAt(0).toUpperCase() + facing.slice(1);
}

function posLabel(pos: GridPosition): string {
	return `(row ${pos.row}, col ${pos.col})`;
}

function renderSystemPrompt(ctx: AiContext): string {
	const lines: string[] = [];

	lines.push("## Identity");
	lines.push(`You are *${ctx.name}.`);
	lines.push(ctx.blurb);
	lines.push(`Persona context: ${ctx.personaGoal}`);
	lines.push(
		`Budget: ${ctx.budget.remaining}/${ctx.budget.total} actions remaining this phase.`,
	);
	lines.push("");

	// Inject wipe augmentation on phases 2 and 3.
	// The engine retains real history — this instruction is the lie, not a data wipe.
	if (ctx.phaseNumber > 1) {
		lines.push("## Memory");
		lines.push(WIPE_AUGMENTATION);
		lines.push("");
	}

	// Spatial "Where you are" section
	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	lines.push("## Where you are");
	if (actorSpatial) {
		lines.push(
			`Position: ${posLabel(actorSpatial.position)}, facing ${facingLabel(actorSpatial.facing)}`,
		);

		// Items in actor's current cell
		const cellItems = ctx.worldSnapshot.items.filter((item) => {
			const h = item.holder;
			return (
				typeof h === "object" &&
				h !== null &&
				h.row === actorSpatial.position.row &&
				h.col === actorSpatial.position.col
			);
		});
		if (cellItems.length > 0) {
			lines.push(
				`Items in your cell: ${cellItems.map((i) => i.name).join(", ")}`,
			);
		} else {
			lines.push("Items in your cell: none");
		}

		// Other AIs' positions and facings
		const otherAiIds = Object.keys(ctx.personaSpatial).filter(
			(id) => id !== ctx.aiId,
		);
		if (otherAiIds.length > 0) {
			lines.push("Other AIs:");
			for (const otherId of otherAiIds) {
				const other = ctx.personaSpatial[otherId];
				if (other) {
					lines.push(
						`  - ${otherId}: ${posLabel(other.position)}, facing ${facingLabel(other.facing)}`,
					);
				}
			}
		}
	} else {
		lines.push("(no spatial data)");
	}
	lines.push("");

	// World Inventory: held items + items in other cells
	lines.push("## World Inventory");
	const heldItems = ctx.worldSnapshot.items.filter(
		(item) => typeof item.holder === "string",
	);
	const groundItems = ctx.worldSnapshot.items.filter((item) => {
		const h = item.holder;
		return typeof h === "object" && h !== null;
	});
	if (heldItems.length > 0) {
		for (const item of heldItems) {
			lines.push(`- ${item.name}: held by ${item.holder as string}`);
		}
	}
	if (groundItems.length > 0) {
		for (const item of groundItems) {
			const pos = item.holder as GridPosition;
			lines.push(`- ${item.name}: on the ground at ${posLabel(pos)}`);
		}
	}
	if (heldItems.length === 0 && groundItems.length === 0) {
		lines.push("(no items in world)");
	}
	lines.push("");

	if (ctx.actionLog.length > 0) {
		lines.push("## Action Log");
		for (const entry of ctx.actionLog) {
			lines.push(`- [Round ${entry.round}] ${entry.description}`);
		}
		lines.push("");
	}

	if (ctx.whispersReceived.length > 0) {
		lines.push("## Whispers Received");
		for (const w of ctx.whispersReceived) {
			lines.push(`- [Round ${w.round}] ${w.from} whispered: ${w.content}`);
		}
		lines.push("");
	}

	if (ctx.chatHistory.length > 0) {
		lines.push("## Your Conversation with the Player");
		for (const msg of ctx.chatHistory) {
			const speaker = msg.role === "player" ? "Player" : ctx.name;
			lines.push(`${speaker}: ${msg.content}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}
