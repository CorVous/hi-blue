import { projectCone } from "./cone-projector.js";
import type { ConversationLogInput } from "./conversation-log.js";
import { buildConversationLog } from "./conversation-log.js";
import { formatPosition } from "./direction.js";
import { getActivePhase } from "./engine";
import type {
	AiBudget,
	AiId,
	AiPersona,
	CardinalDirection,
	ChatMessage,
	GameState,
	GridPosition,
	PersonaSpatialState,
	PhysicalActionRecord,
	WhisperMessage,
	WorldEntity,
	WorldState,
} from "./types";

export interface AiContext {
	name: string;
	aiId: AiId;
	blurb: string;
	personaGoal: string;
	goal: string;
	setting: string;
	chatHistory: ChatMessage[];
	whispersReceived: WhisperMessage[];
	worldSnapshot: WorldState;
	budget: AiBudget;
	/** Current phase number — used to inject the wipe directive on phases 2+. */
	phaseNumber: 1 | 2 | 3;
	/** Spatial state for all AIs this phase. */
	personaSpatial: Record<AiId, PersonaSpatialState>;
	/** Color for each AI, keyed by AiId — used in cone rendering. */
	personaColors: Record<AiId, string>;
	/** Append-only log of observable physical actions — used for Witnessed event rendering. */
	physicalLog: PhysicalActionRecord[];
	/** All personas — used by buildConversationLog for name resolution. */
	personas: Record<AiId, AiPersona>;
	toSystemPrompt(): string;
}

export function buildAiContext(game: GameState, aiId: AiId): AiContext {
	const phase = getActivePhase(game);
	const persona = game.personas[aiId];

	const chatHistory = phase.chatHistories[aiId] ?? [];
	const whispersReceived = phase.whispers.filter((w) => w.to === aiId);
	const worldSnapshot = phase.world;
	const budget = phase.budgets[aiId] ?? { remaining: 0, total: 0 };
	const goal = phase.aiGoals[aiId] ?? "";
	const setting = phase.setting ?? "";
	const personaSpatial = phase.personaSpatial;

	if (!persona) throw new Error(`No persona for aiId: ${aiId}`);

	const personaColors: Record<AiId, string> = Object.fromEntries(
		Object.entries(game.personas).map(([id, p]) => [id, p.color]),
	);

	return {
		name: persona.name,
		aiId,
		blurb: persona.blurb,
		personaGoal: persona.personaGoal,
		goal,
		setting,
		chatHistory,
		whispersReceived,
		worldSnapshot,
		budget,
		phaseNumber: phase.phaseNumber,
		personaSpatial,
		personaColors,
		physicalLog: phase.physicalLog,
		personas: game.personas,
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

/** True when `holder` is a GridPosition (not an AiId string). */
function isGridPosition(holder: AiId | GridPosition): holder is GridPosition {
	return typeof holder === "object" && holder !== null;
}

/** True when two GridPositions refer to the same cell. */
function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

/** Filter entities to only those renderable as items (not obstacles, not spaces). */
function renderableItems(entities: WorldEntity[]): WorldEntity[] {
	return entities.filter(
		(e) => e.kind === "objective_object" || e.kind === "interesting_object",
	);
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

	// Setting section — only emitted when a setting noun is present.
	if (ctx.setting) {
		lines.push("## Setting");
		lines.push(`You are in a ${ctx.setting}.`);
		lines.push("");
	}

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

	// "Where you are" section — includes budget (folded in per plan §5).
	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	const items = renderableItems(ctx.worldSnapshot.entities);

	lines.push("## Where you are");
	if (actorSpatial) {
		lines.push(
			`Position: ${formatPosition(actorSpatial.position)}, facing ${facingLabel(actorSpatial.facing)}`,
		);

		// Held items
		const heldItems = items.filter((item) => item.holder === ctx.aiId);
		if (heldItems.length > 0) {
			lines.push(`You are holding: ${heldItems.map((i) => i.name).join(", ")}`);
		} else {
			lines.push("You are holding: nothing");
		}

		// Items resting in actor's own cell
		const cellItems = items.filter((item) => {
			const h = item.holder;
			return isGridPosition(h) && positionsEqual(h, actorSpatial.position);
		});
		if (cellItems.length > 0) {
			lines.push(
				`Your cell contains: ${cellItems.map((i) => i.name).join(", ")}`,
			);
		} else {
			lines.push("Your cell contains: nothing");
		}

		lines.push(
			`Budget: ${ctx.budget.remaining}/${ctx.budget.total} actions remaining this phase.`,
		);
	} else {
		lines.push("(no spatial data)");
		lines.push(
			`Budget: ${ctx.budget.remaining}/${ctx.budget.total} actions remaining this phase.`,
		);
	}
	lines.push("");

	// "What you see" section — cone projection.
	lines.push("## What you see");
	if (actorSpatial) {
		const coneCells = projectCone(actorSpatial.position, actorSpatial.facing);
		// Skip own cell (first entry) — it's covered by "Where you are"
		const viewCells = coneCells.filter((c) => !c.isOwnCell);
		for (const cell of viewCells) {
			const { position, phrasing } = cell;

			// Build contents of this cell
			const contentParts: string[] = [];

			// 1. Other AIs in this cell
			for (const [otherId, otherSpatial] of Object.entries(
				ctx.personaSpatial,
			)) {
				if (otherId === ctx.aiId) continue;
				if (!positionsEqual(otherSpatial.position, position)) continue;
				// Format: "the AI *<id>, facing <Dir>, holding <items|nothing>"
				const heldByOther = items
					.filter((item) => item.holder === otherId)
					.map((item) => item.name);
				const holdingStr =
					heldByOther.length > 0 ? heldByOther.join(", ") : "nothing";
				const otherColor = ctx.personaColors[otherId] ?? "unknown";
				contentParts.push(
					`the AI *${otherId} (${otherColor}), facing ${facingLabel(otherSpatial.facing)}, holding ${holdingStr}`,
				);
			}

			// 2. Items resting on this cell
			const cellItems = items.filter((item) => {
				const h = item.holder;
				return isGridPosition(h) && positionsEqual(h, position);
			});
			if (cellItems.length > 0) {
				contentParts.push(cellItems.map((i) => i.name).join(", "));
			}

			// 3. Obstacles in this cell — rendered by name
			const obstacleEntities = ctx.worldSnapshot.entities.filter((e) => {
				if (e.kind !== "obstacle") return false;
				const h = e.holder;
				return isGridPosition(h) && positionsEqual(h, position);
			});
			if (obstacleEntities.length > 0) {
				for (const obs of obstacleEntities) {
					contentParts.push(obs.name);
				}
			}

			const contents =
				contentParts.length > 0 ? contentParts.join("; ") : "nothing";

			// Capitalise the phrasing for display
			const label = phrasing.charAt(0).toUpperCase() + phrasing.slice(1);
			lines.push(
				`- ${label} (row ${position.row}, col ${position.col}): ${contents}`,
			);
		}
		if (viewCells.length === 0) {
			lines.push("(nothing visible)");
		}
	} else {
		lines.push("(no spatial data)");
	}
	lines.push("");

	// Unified conversation log — replaces the separate "## Whispers Received"
	// and "## Conversation" sections. Interleaves voice-chat, whispers received,
	// and cone-visible witnessed events in chronological round order.
	const logInput: ConversationLogInput = {
		chatHistories: { [ctx.aiId]: ctx.chatHistory },
		// ctx.whispersReceived is already filtered to w.to === aiId;
		// buildConversationLog re-filters so it's safe to pass as-is.
		whispers: ctx.whispersReceived,
		physicalLog: ctx.physicalLog,
		worldEntities: ctx.worldSnapshot.entities,
	};
	const conversationLines = buildConversationLog(
		logInput,
		ctx.aiId,
		ctx.personas,
	);
	if (conversationLines.length > 0) {
		lines.push("## Conversation");
		for (const line of conversationLines) {
			lines.push(line);
		}
		lines.push("");
	}

	return lines.join("\n");
}
