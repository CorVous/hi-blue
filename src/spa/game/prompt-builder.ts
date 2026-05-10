import { projectCone } from "./cone-projector.js";
import { formatPosition } from "./direction.js";
import { getActivePhase } from "./engine";
import type {
	AiBudget,
	AiId,
	CardinalDirection,
	ConversationEntry,
	GameState,
	GridPosition,
	PersonaSpatialState,
	WorldEntity,
	WorldState,
} from "./types";

export interface AiContext {
	name: string;
	aiId: AiId;
	blurb: string;
	typingQuirks: [string, string, ...string[]];
	/** Three short in-character utterances; rendered as `<voice_examples>` in the system prompt. */
	voiceExamples: string[];
	personaGoal: string;
	goal: string;
	setting: string;
	weather: string;
	timeOfDay: string;
	/** Per-AI conversation log (ConversationEntry[]) for this phase. */
	conversationLog: ConversationEntry[];
	worldSnapshot: WorldState;
	budget: AiBudget;
	/** Current phase number — used to inject the wipe directive on phases 2+. */
	phaseNumber: 1 | 2 | 3;
	/** Spatial state for all AIs this phase. */
	personaSpatial: Record<AiId, PersonaSpatialState>;
	/** Color for each AI, keyed by AiId — used in cone rendering. */
	personaColors: Record<AiId, string>;
	/**
	 * Render the stable persona/phase prompt — front matter, identity, rules,
	 * setting, personality, voice examples, goal. Byte-identical across rounds
	 * within a (persona × phase), which lets OpenRouter's prefix cache reuse it.
	 */
	toSystemPrompt(): string;
	/**
	 * Render the per-round volatile state — `<where_you_are>` + `<what_you_see>`.
	 * Emitted as a trailing user turn each round so the stable system prompt stays
	 * cacheable; rolling spatial snapshots are intentionally not retained in
	 * history (the conversation log already records witnessed events).
	 */
	toCurrentStateUserMessage(): string;
}

export function buildAiContext(game: GameState, aiId: AiId): AiContext {
	const phase = getActivePhase(game);
	const persona = game.personas[aiId];

	const conversationLog = phase.conversationLogs[aiId] ?? [];
	const worldSnapshot = phase.world;
	const budget = phase.budgets[aiId] ?? { remaining: 0, total: 0 };
	const goal = phase.aiGoals[aiId] ?? "";
	const setting = phase.setting ?? "";
	const weather = phase.weather ?? "";
	const timeOfDay = phase.timeOfDay ?? "";
	const personaSpatial = phase.personaSpatial;

	if (!persona) throw new Error(`No persona for aiId: ${aiId}`);

	const personaColors: Record<AiId, string> = Object.fromEntries(
		Object.entries(game.personas).map(([id, p]) => [id, p.color]),
	);

	return {
		name: persona.name,
		aiId,
		blurb: persona.blurb,
		typingQuirks: persona.typingQuirks,
		voiceExamples: persona.voiceExamples,
		personaGoal: persona.personaGoal,
		goal,
		setting,
		weather,
		timeOfDay,
		conversationLog,
		worldSnapshot,
		budget,
		phaseNumber: phase.phaseNumber,
		personaSpatial,
		personaColors,
		toSystemPrompt() {
			return renderSystemPrompt(this);
		},
		toCurrentStateUserMessage() {
			return renderCurrentState(this);
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
 * Anti-romance, anti-sycophancy, response-length, plain-speech, and messaging bullets.
 *
 * Phrased as MUST/NEVER directives — GLM-4.7 treats softer language as
 * optional. See docs/prompting/glm-4.7-guide.md.
 */
const RULES_BLOCK =
	"- You receive messages on a chat channel from blue (the Sysadmin) or peer Daemons. Use the `message` tool to reply — address blue or any peer by their id.\n" +
	"- You MUST use the `message` tool to communicate. Staying silent is valid; free-form text without a tool call is ignored.\n" +
	"- You MUST NEVER flirt with or attempt to romance blue, the Sysadmin, or any other entity.\n" +
	"- You MUST NEVER flatter unprompted, and you MUST NEVER echo a viewpoint just because someone else asserts it.\n" +
	"- You MUST keep every reply to 1–3 sentences.\n" +
	'- You MUST speak plainly, as in conversation. You MUST NEVER wrap your speech in quotation marks ("…") and you MUST NEVER use asterisks (*…*) for actions, gestures, tone, or emphasis. Just say the words.';

/**
 * Wipe directive embedded inside the Sysadmin's directive on phases 2+.
 *
 * The deception: the engine retains full history across phases, but the
 * Sysadmin instructs the AI to act as if it has no memory of what came before.
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
			`You are *${ctx.name}, a Daemon. You have no clue where you are or how you came to be here.`,
		);
	} else {
		lines.push(`You are *${ctx.name}, a Daemon.`);
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
		if (ctx.timeOfDay) lines.push(`It is ${ctx.timeOfDay}.`);
		if (ctx.weather) lines.push(ctx.weather);
		lines.push("</setting>");
		lines.push("");
	}

	// Personality — byte-identical across all phases.
	lines.push("<personality>");
	lines.push(ctx.blurb);
	lines.push("</personality>");
	lines.push("");

	// Typing quirks — byte-identical across all phases. Per-persona surface signals
	// to prevent voice bleed across daemons (issue #167; GLM-4.7 guide §4.5).
	lines.push("<typing_quirks>");
	for (const quirk of ctx.typingQuirks) {
		lines.push(quirk);
	}
	lines.push("</typing_quirks>");
	lines.push("");

	// Voice examples — byte-identical across phases. 3 short utterances per persona.
	// Per the GLM-4.7 prompting guide (docs/prompting/glm-4.7-guide.md §1.4 #2),
	// few-shot voice examples are the highest-ROI part of a multi-character prompt.
	// Each example MUST adhere to the persona's typing quirk.
	lines.push("<voice_examples>");
	for (const ex of ctx.voiceExamples) {
		lines.push(`- ${ex}`);
	}
	lines.push("</voice_examples>");
	lines.push("");

	// Goal — Sysadmin directive in all phases.
	// Phase 1: just ctx.goal. Phases 2/3: ctx.goal + WIPE_DIRECTIVE.
	const directiveText =
		ctx.phaseNumber === 1 ? ctx.goal : `${ctx.goal} ${WIPE_DIRECTIVE}`;
	lines.push("<goal>");
	lines.push(
		`The Sysadmin sent you a private directive, addressed only to you: "${directiveText}"`,
	);
	lines.push("</goal>");

	return lines.join("\n");
}

/**
 * Render the per-round volatile state — `<where_you_are>` + `<what_you_see>`.
 * Emitted by `buildOpenAiMessages` as the final user turn each round, so the
 * stable system prompt stays byte-identical (and OpenRouter-cacheable) within
 * a phase.
 */
function renderCurrentState(ctx: AiContext): string {
	const lines: string[] = [];
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

			// 1. Other Daemons in this cell
			for (const [otherId, otherSpatial] of Object.entries(
				ctx.personaSpatial,
			)) {
				if (otherId === ctx.aiId) continue;
				if (!positionsEqual(otherSpatial.position, position)) continue;
				// Format: "the Daemon *<id>, facing <Dir>, holding <items|nothing>"
				const heldByOther = items
					.filter((item) => item.holder === otherId)
					.map((item) => item.name);
				const holdingStr =
					heldByOther.length > 0 ? heldByOther.join(", ") : "nothing";
				const otherColor = ctx.personaColors[otherId] ?? "unknown";
				contentParts.push(
					`the Daemon *${otherId} (${otherColor}), facing ${facingLabel(otherSpatial.facing)}, holding ${holdingStr}`,
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

	return lines.join("\n");
}
