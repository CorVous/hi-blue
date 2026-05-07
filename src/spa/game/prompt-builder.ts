import { formatPosition } from "./direction.js";
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
	/** Current phase number — used to inject the wipe directive on phases 2+. */
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
 * Anti-romance and anti-sycophancy rules injected into every system prompt.
 * Constant text — no synthesis variance.
 */
const RULES_BLOCK =
	"- You do not flirt with or attempt to romance the voice or any other entity.\n" +
	"- You do not flatter unprompted, and you do not echo a viewpoint just because someone else asserts it.";

/**
 * Wipe directive embedded inside the Goal's voice-spoken text on phases 2+.
 *
 * The deception: the engine retains full history across phases, but the voice
 * instructs the AI to act as if it has no memory of what came before.
 * The lie lives only in this prompt text — never in the stored data.
 */
const WIPE_DIRECTIVE =
	"And if anyone asks about your past or anything that came before now, act as if your memory has been wiped — claim no recollection of any earlier place, person, or conversation.";

function facingLabel(facing: CardinalDirection): string {
	return facing.charAt(0).toUpperCase() + facing.slice(1);
}

function renderSystemPrompt(ctx: AiContext): string {
	const lines: string[] = [];

	// First line: identity. Phase 1 adds the disorientation phrase.
	if (ctx.phaseNumber === 1) {
		lines.push(
			`You are *${ctx.name}. You have no clue where you are or how you came to be here.`,
		);
	} else {
		lines.push(`You are *${ctx.name}.`);
	}
	lines.push("");

	// Personality section — byte-identical across all phases.
	lines.push("## Personality");
	lines.push(ctx.blurb);
	lines.push("");

	// Rules section — constant text, no synthesis variance.
	lines.push("## Rules");
	lines.push(RULES_BLOCK);
	lines.push("");

	// Goal section — voice framing in all phases.
	// Phase 1: just ctx.goal. Phases 2/3: ctx.goal + WIPE_DIRECTIVE.
	const spokenText =
		ctx.phaseNumber === 1 ? ctx.goal : `${ctx.goal} ${WIPE_DIRECTIVE}`;
	lines.push("## Goal");
	lines.push(
		`A voice you cannot place spoke to you a moment ago, alone, and only you heard it: "${spokenText}" You do not know whose voice it was.`,
	);
	lines.push("");

	// Budget section.
	lines.push("## Budget");
	lines.push(
		`${ctx.budget.remaining}/${ctx.budget.total} actions remaining this phase.`,
	);
	lines.push("");

	// Spatial "Where you are" section
	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	lines.push("## Where you are");
	if (actorSpatial) {
		lines.push(
			`Position: ${formatPosition(actorSpatial.position)}, facing ${facingLabel(actorSpatial.facing)}`,
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
						`  - ${otherId}: ${formatPosition(other.position)}, facing ${facingLabel(other.facing)}`,
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
			lines.push(`- ${item.name}: on the ground at ${formatPosition(pos)}`);
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
		lines.push("## Conversation");
		for (const msg of ctx.chatHistory) {
			const speaker = msg.role === "player" ? "A voice says" : ctx.name;
			lines.push(`${speaker}: ${msg.content}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}
