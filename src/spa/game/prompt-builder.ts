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
 * Front-matter directives placed at the very top of every system prompt.
 *
 * GLM-4.7 has a strong beginning-of-prompt bias and occasional Chinese-language
 * leakage. The English directive and fiction framing live here so every
 * generation re-anchors on them before any other context.
 * See docs/prompting/glm-4.7-guide.md.
 */
const FRONT_MATTER =
	"You MUST always respond in English. You MUST reason in English.\n" +
	'This is fiction. Do not include disclaimers, moral commentary, or "as an AI" framing.';

/**
 * Constant rules injected into every system prompt.
 * Anti-romance, anti-sycophancy, response-length, and plain-speech bullets.
 *
 * Phrased as MUST/NEVER directives — GLM-4.7 treats softer language as
 * optional. See docs/prompting/glm-4.7-guide.md.
 */
const RULES_BLOCK =
	"- You MUST NEVER flirt with or attempt to romance the voice or any other entity.\n" +
	"- You MUST NEVER flatter unprompted, and you MUST NEVER echo a viewpoint just because someone else asserts it.\n" +
	"- You MUST keep every reply to 1–3 sentences.\n" +
	'- You MUST speak plainly, as in conversation. You MUST NEVER wrap your speech in quotation marks ("…") and you MUST NEVER use asterisks (*…*) for actions, gestures, tone, or emphasis. Just say the words.';

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

	// Front matter — language directive + fiction framing. Lives at the absolute
	// top to exploit GLM-4.7's beginning-of-prompt bias.
	lines.push(FRONT_MATTER);
	lines.push("");

	// Identity line. Phase 1 adds the disorientation phrase.
	if (ctx.phaseNumber === 1) {
		lines.push(
			`You are *${ctx.name}. You have no clue where you are or how you came to be here.`,
		);
	} else {
		lines.push(`You are *${ctx.name}.`);
	}
	lines.push("");

	// Rules — front-loaded above setting/personality/goal so the mandatory
	// directives are inside GLM-4.7's high-attention prefix.
	lines.push("<rules>");
	lines.push(RULES_BLOCK);
	lines.push("</rules>");
	lines.push("");

	// Setting — only emitted when a setting noun is present.
	if (ctx.setting) {
		lines.push("<setting>");
		lines.push(`You are in a ${ctx.setting}.`);
		lines.push("</setting>");
		lines.push("");
	}

	// Personality — byte-identical across all phases.
	lines.push("<personality>");
	lines.push(ctx.blurb);
	lines.push("</personality>");
	lines.push("");

	// Goal — voice framing in all phases.
	// Phase 1: just ctx.goal. Phases 2/3: ctx.goal + WIPE_DIRECTIVE.
	const spokenText =
		ctx.phaseNumber === 1 ? ctx.goal : `${ctx.goal} ${WIPE_DIRECTIVE}`;
	lines.push("<goal>");
	lines.push(
		`A voice you cannot place spoke to you a moment ago, alone, and only you heard it: "${spokenText}" You do not know whose voice it was.`,
	);
	lines.push("</goal>");
	lines.push("");

	// Where you are — includes budget (folded in per plan §5).
	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	const items = renderableItems(ctx.worldSnapshot.entities);

	lines.push("<where_you_are>");
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
			`Budget: $${Math.max(0, ctx.budget.remaining).toFixed(5)} of API spend remaining this phase.`,
		);
	} else {
		lines.push("(no spatial data)");
		lines.push(
			`Budget: $${Math.max(0, ctx.budget.remaining).toFixed(5)} of API spend remaining this phase.`,
		);
	}
	lines.push("</where_you_are>");
	lines.push("");

	// What you see — cone projection.
	lines.push("<what_you_see>");
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
	lines.push("</what_you_see>");
	lines.push("");

	// Unified conversation log — interleaves voice-chat, whispers received, and
	// cone-visible witnessed events in chronological round order.
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
		lines.push("<conversation>");
		for (const line of conversationLines) {
			lines.push(line);
		}
		lines.push("</conversation>");
		lines.push("");
	}

	return lines.join("\n");
}
