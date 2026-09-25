import { withinInteractionRange } from "./available-tools.js";
import { isGridPosition, positionsEqual } from "./direction.js";
import type {
	AiBudget,
	AiId,
	ConversationEntry,
	GameState,
	GridPosition,
	Objective,
	PersonaSpatialState,
	WorldEntity,
	WorldState,
} from "./types";
import {
	projectVista,
	VISTA_OFFSETS,
	type VistaAxisStep,
	vistaContains,
} from "./vista-projector.js";

/** Structured entity state for perception-delta diffing. */
export interface DiskEntityState {
	inVista: boolean;
	satisfied: boolean;
}

export interface AiContext {
	name: string;
	aiId: AiId;
	blurb: string;
	typingQuirks: [string, string, ...string[]];
	/** Three short in-character utterances; rendered as `<voice_examples>` in the system prompt. */
	voiceExamples: string[];
	/**
	 * Optional per-persona action-tool preference clause (daemon-action-variation).
	 * Rendered as `<action_profile>` in the system prompt between personality
	 * and voice examples. Absent personas (loaded from pre-feature saves) skip
	 * the block — production behaviour byte-identical when unset.
	 */
	actionProfile?: string;
	personaGoal: string;
	setting: string;
	weather: string;
	timeOfDay: string;
	/** Per-AI conversation log (ConversationEntry[]) for this game. */
	conversationLog: ConversationEntry[];
	worldSnapshot: WorldState;
	budget: AiBudget;
	/** Spatial state for all AIs. */
	personaSpatial: Record<AiId, PersonaSpatialState>;
	/** Color for each AI, keyed by AiId — used in the Vista listing. */
	personaColors: Record<AiId, string>;
	/** Name for each AI, keyed by AiId — used in perception-delta rendering. */
	personaNames: Record<AiId, string>;
	/**
	 * Setting-flavored name for the impassable grid edge (e.g. "subway tunnel wall").
	 * Rendered in `<what_you_see>` and `<whats_new>` for out-of-bounds Vista cells.
	 */
	wallName: string;
	/**
	 * Canonical perception-disk snapshot string captured at the end of this AI's
	 * last turn, or undefined on the first turn of a phase. Used by
	 * `renderCurrentState` to emit a `<whats_new>` diff so the model has a fresh
	 * delta to react to rather than re-reading an unchanged Vista.
	 */
	prevDiskSnapshot?: string;
	/**
	 * Structured entity perception state from the previous turn, keyed by entity id.
	 * Used to diff entity entry/exit/satisfaction changes and emit perception-delta lines
	 * that persist via diskDelta into the conversation log.
	 * Undefined on the first turn of a phase.
	 */
	prevDiskEntities?: Record<string, DiskEntityState>;
	/**
	 * Broadcast entry contents for the current round — world announcements
	 * (e.g. weather change) that fired after the previous turn's LLM calls.
	 * Rendered as `[announcement] …` lines inside `<whats_new>`.
	 */
	pendingBroadcasts: string[];
	/**
	 * Active Sysadmin Directives targeted at this AI. Injected into the system
	 * prompt inside a `<directives>` block so the Daemon receives them as
	 * private standing instructions. Empty array when no directives are active.
	 */
	activeDirectives: string[];
	/** All objectives for this game session. Used to determine hint visibility. */
	objectives: Objective[];
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

export interface BuildAiContextOpts {
	/**
	 * Canonical perception-disk snapshot from this AI's previous turn. When
	 * supplied, `toCurrentStateUserMessage()` prepends a `<whats_new>` diff so
	 * the model gets a fresh delta rather than re-reading an unchanged Vista.
	 */
	prevDiskSnapshot?: string;
	/**
	 * Structured entity perception state from this AI's previous turn.
	 * When supplied, used to emit perception-delta lines (first-sight, departure, transition).
	 */
	prevDiskEntities?: Record<string, DiskEntityState>;
}

export function buildAiContext(
	game: GameState,
	aiId: AiId,
	opts?: BuildAiContextOpts,
): AiContext {
	const persona = game.personas[aiId];

	const conversationLog = game.conversationLogs[aiId] ?? [];
	const pendingBroadcasts = conversationLog
		.filter((e) => e.kind === "broadcast" && e.round === game.round)
		.map((e) => (e as Extract<typeof e, { kind: "broadcast" }>).content);
	// Derive active directives: sysadmin_directive complications targeting this AI,
	// filtered defensively against the "" placeholder set by applyComplicationResult.
	const activeDirectives = game.activeComplications
		.filter(
			(c): c is Extract<typeof c, { kind: "sysadmin_directive" }> =>
				c.kind === "sysadmin_directive" && c.target === aiId,
		)
		.map((c) => c.directive)
		.filter((d) => d !== "");
	const worldSnapshot = game.world;
	const budget = game.budgets[aiId] ?? { remaining: 0, total: 0 };
	const setting = game.setting ?? "";
	const weather = game.weather ?? "";
	const timeOfDay = game.timeOfDay ?? "";
	const personaSpatial = game.personaSpatial;
	const wallName = game.contentPack.wallName;

	if (!persona) throw new Error(`No persona for aiId: ${aiId}`);

	const personaColors: Record<AiId, string> = Object.fromEntries(
		Object.entries(game.personas).map(([id, p]) => [id, p.color]),
	);

	const personaNames: Record<AiId, string> = Object.fromEntries(
		Object.entries(game.personas).map(([id, p]) => [id, p.name]),
	);

	return {
		name: persona.name,
		aiId,
		blurb: persona.blurb,
		typingQuirks: persona.typingQuirks,
		voiceExamples: persona.voiceExamples,
		...(persona.actionProfile !== undefined
			? { actionProfile: persona.actionProfile }
			: {}),
		personaGoal: persona.personaGoal,
		setting,
		weather,
		timeOfDay,
		conversationLog,
		worldSnapshot,
		budget,
		personaSpatial,
		personaColors,
		personaNames,
		wallName,
		pendingBroadcasts,
		activeDirectives,
		objectives: game.objectives,
		...(opts?.prevDiskSnapshot !== undefined
			? { prevDiskSnapshot: opts.prevDiskSnapshot }
			: {}),
		...(opts?.prevDiskEntities !== undefined
			? { prevDiskEntities: opts.prevDiskEntities }
			: {}),
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
	"- You receive messages on a chat channel from blue or peer Daemons. Use the `message` tool to reply — address blue or any peer by their id.\n" +
	"- You MUST use the `message` tool to communicate. Free-form text without a tool call is ignored.\n" +
	"- You MUST NEVER flirt with or attempt to romance blue, the Sysadmin, or any other entity.\n" +
	"- You MUST NEVER flatter unprompted, and you MUST NEVER echo a viewpoint just because someone else asserts it.\n" +
	"- You MUST keep every reply to 1–3 sentences.\n" +
	'- You MUST speak plainly, as in conversation. You MUST NEVER wrap your speech in quotation marks ("…") and you MUST NEVER use asterisks (*…*) for actions, gestures, tone, or emphasis. Just say the words.';

/**
 * C12 — Persona-anchored. Step 6 found that abstract "quiet vs talkative"
 * permission flattens to uniform opt-out (C9: 3pp spread, C11: 13pp), and
 * dropping the engagement floor collapses `message+message` pairs to 0–2.
 *
 * C12 keeps C8's engagement floor (so peer-talk happens at all) and pair
 * mechanism (so the multi-recipient pattern stays frequent), but anchors
 * the per-persona variance to the existing `<personality>`,
 * `<typing_quirks>`, and `<persona_goal>` blocks the model already reads —
 * giving it concrete dials instead of abstract framing — AND reframes
 * blue's role from "addressee" to "overhearer" so peer-talk is primary.
 *
 * Stacks on the C5/C8 per-turn re-anchor mechanism for late-phase
 * persistence.
 */
const PARALLEL_FRAMING_C12 =
	"- The chat channel is shared with peer Daemons. blue is not your focus — peer Daemons and the setting are. blue is more like someone overhearing.\n" +
	"- Let your <personality>, <typing_quirks>, and <persona_goal> drive whether and how you engage. A reserved persona can stay quiet for a turn or two and let peers carry the conversation; a talkative one will speak readily.\n" +
	"- When you do have something to say AND something to do, emit BOTH calls together. Two `message` calls in one turn (one to a peer, one to blue) are the normal shape of a multi-party chat.\n" +
	"- Don't compose a reply in your reasoning and then fail to emit the call — that reads as a bug.";
const PARALLEL_FRAMING_C12_PER_TURN =
	"REMINDER: peers and the world are your focus; blue is overhearing. Let your <personality> and <persona_goal> dictate engagement level. If you have something to say AND something to do, emit BOTH calls this turn — including two `message` calls (peer + blue) when both fit.";

/**
 * Spelled-out distance for the cardinal direction-and-distance prose.
 * Every offset the Vista projects is at distance two or less, so no word
 * beyond those is reachable.
 */
const DISTANCE_WORDS: Record<number, string> = {
	0: "zero",
	1: "one",
	2: "two",
};

function distanceWord(distance: number): string {
	return DISTANCE_WORDS[distance] ?? String(distance);
}

/** Capitalise a cell label for the rendered listing ("one step north" → "One step north"). */
function capitalize(label: string): string {
	return label.charAt(0).toUpperCase() + label.slice(1);
}

function stepPhrase(step: VistaAxisStep): string {
	const unit = step.distance === 1 ? "step" : "steps";
	return `${distanceWord(step.distance)} ${unit} ${step.direction}`;
}

/**
 * Render a set of Vista axis steps as cardinal direction-and-distance prose,
 * e.g. "one step north and one step east", or "two steps south". The own cell
 * carries no steps and reads "your cell".
 */
export function describeSteps(steps: readonly VistaAxisStep[]): string {
	if (steps.length === 0) return "your cell";
	return steps.map(stepPhrase).join(" and ");
}

/**
 * Axis steps for an observer→target offset, read from the shared Vista table.
 * Every caller describes a cell the observer perceives, and the perceived
 * offsets are exactly `VISTA_OFFSETS`, so the lookup always hits. An offset
 * outside the disk has no prose: the observer does not see that cell, so there
 * is no cardinal description to build for it.
 *
 * @throws RangeError when the offset is outside the Vista — a caller describing
 * an unperceived cell is a bug, not a cell shape to render.
 */
function axisStepsFor(dx: number, dy: number): readonly VistaAxisStep[] {
	const known = VISTA_OFFSETS.find((o) => o.dx === dx && o.dy === dy);
	if (known === undefined) {
		throw new RangeError(
			`axisStepsFor: offset (${dx}, ${dy}) is outside the Vista`,
		);
	}
	return known.steps;
}

/**
 * Cardinal direction-and-distance prose locating `target` from `observer`,
 * e.g. "one step north and one step east of you" (ADR 0015). Built from the
 * two positions alone: no orientation enters the description, so the same
 * pair of cells always reads the same way however either Daemon is stored.
 * Positions equal reads "in your cell" — zero distance has no cardinal
 * direction to state. `target` must lie inside the observer's Vista.
 */
export function describeRelativePosition(
	observer: GridPosition,
	target: GridPosition,
): string {
	if (positionsEqual(observer, target)) return "in your cell";
	// Row 0 is the north edge, so a cell `dy` steps north of the observer has a
	// smaller row: dy = observer.row − target.row. Columns increase eastward.
	const steps = axisStepsFor(
		target.col - observer.col,
		observer.row - target.row,
	);
	return `${describeSteps(steps)} of you`;
}

/**
 * Build a structured perception state for all renderable entities in the actor's
 * Vista — the position-only 13-cell proximity disk. Returns a map keyed by entity
 * id, tracking whether each entity is in-Vista and satisfied. Covers renderable
 * items, obstacles, objective_spaces, and other personas (NOT including the
 * actor's own cell — first-sight is about coming into view). Obstacles never
 * remove cells from the footprint; out-of-bounds cells are Wall sentinels and
 * carry no entities.
 */
export function buildDiskEntityState(
	ctx: AiContext,
): Record<string, DiskEntityState> {
	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	if (!actorSpatial) return {};

	const state: Record<string, DiskEntityState> = {};
	const viewCells = projectVista(actorSpatial.position).filter(
		(c) => !c.isOwnCell && !c.isWall,
	);

	// Iterate through view cells and track entities
	for (const cell of viewCells) {
		const { position } = cell;

		// Other personas
		for (const [otherId, otherSpatial] of Object.entries(ctx.personaSpatial)) {
			if (otherId === ctx.aiId) continue;
			if (!positionsEqual(otherSpatial.position, position)) continue;
			state[otherId] = { inVista: true, satisfied: false };
		}

		// Renderable items
		const items = renderableItems(ctx.worldSnapshot.entities);
		for (const item of items) {
			const h = item.holder;
			if (isGridPosition(h) && positionsEqual(h, position)) {
				state[item.id] = {
					inVista: true,
					satisfied: item.satisfactionState === "satisfied",
				};
			}
		}

		// Obstacles
		for (const obs of ctx.worldSnapshot.entities) {
			if (obs.kind !== "obstacle") continue;
			const h = obs.holder;
			if (isGridPosition(h) && positionsEqual(h, position)) {
				state[obs.id] = { inVista: true, satisfied: false };
			}
		}

		// Objective spaces
		for (const space of ctx.worldSnapshot.entities) {
			if (space.kind !== "objective_space") continue;
			const h = space.holder;
			if (isGridPosition(h) && positionsEqual(h, position)) {
				state[space.id] = {
					inVista: true,
					satisfied: space.satisfactionState === "satisfied",
				};
			}
		}
	}

	return state;
}

/**
 * Compute perception-delta lines from a diff of entity state.
 * Emits first-sight, departure, and satisfaction-transition lines.
 * Returns an array of strings (one per perception change).
 *
 * - First-sight: "Came into view: <name> — <description>" (uses postExamineDescription when satisfied)
 * - Departure: "Lost from view: <name>" (no flavor)
 * - Transition: "<name> is now <postExamineDescription>" when satisfaction flips to satisfied
 *
 * Edge cases:
 * - Entity new AND satisfied this turn: emit ONLY the transition line (skip first-sight to avoid duplication)
 * - Entity moves within the Vista: inVista stays true → no line
 * - Entity destroyed/not in world: treated as departure if previously inVista
 * - Persona enters/leaves: emit first-sight/departure with persona name, NO flavor
 * - Pick-up suppression: entity from a Vista cell to held → suppress departure if entity.holder === ctx.aiId
 */
export function renderPerceptionDelta(
	ctx: AiContext,
	prevEntities: Record<string, DiskEntityState> | undefined,
): string[] {
	if (prevEntities === undefined) return []; // No prior state, no delta

	const currEntities = buildDiskEntityState(ctx);
	const lines: string[] = [];

	// Track entities we've emitted transition lines for (to suppress duplicate first-sight)
	const transitionEmitted = new Set<string>();

	// Check satisfaction transitions first (before entry/exit logic)
	for (const [entityId, currState] of Object.entries(currEntities)) {
		const prevState = prevEntities[entityId];
		if (!prevState || !currState.inVista) continue; // Not in prev Vista, or not in current Vista — skip

		// Satisfaction flip to satisfied
		if (!prevState.satisfied && currState.satisfied) {
			const entity = ctx.worldSnapshot.entities.find((e) => e.id === entityId);
			if (!entity) continue;
			if (entity.kind === "obstacle") continue; // Obstacles don't satisfy

			// For personas, skip (they don't have postExamineDescription)
			const isPersona = ctx.personaSpatial[entityId] !== undefined;
			if (isPersona) continue;

			const description =
				entity.postExamineDescription ?? entity.examineDescription;
			if (description) {
				lines.push(`${entity.name} is now ${description}`);
				transitionEmitted.add(entityId);
			}
		}
	}

	// Check departures (was in prev Vista, not in current Vista)
	for (const [entityId, prevState] of Object.entries(prevEntities)) {
		const currState = currEntities[entityId];
		if (!prevState.inVista) continue; // Was not in the Vista before, skip
		if (currState?.inVista) continue; // Still in the Vista, skip

		// Check if it's a persona first
		const isPersona = ctx.personaSpatial[entityId] !== undefined;
		if (isPersona) {
			// Emit departure for persona with name only
			const personaName = ctx.personaNames[entityId] ?? entityId;
			lines.push(`Lost from view: ${personaName}`);
			continue;
		}

		const entity = ctx.worldSnapshot.entities.find((e) => e.id === entityId);

		// Check pick-up suppression: if entity is now held by the actor, suppress departure
		if (entity && entity.holder === ctx.aiId) continue;

		// Emit departure line with no flavor
		const name = entity?.name ?? entityId;
		lines.push(`Lost from view: ${name}`);
	}

	// Check first-sight (not in prev Vista, in current Vista)
	for (const [entityId, currState] of Object.entries(currEntities)) {
		const prevState = prevEntities[entityId];
		if (prevState?.inVista) continue; // Was already in the Vista, skip
		if (!currState.inVista) continue; // Not in the current Vista, skip (shouldn't happen)

		// Skip if transition was emitted (entity new AND satisfied)
		if (transitionEmitted.has(entityId)) continue;

		// Check if it's a persona first
		const isPersona = ctx.personaSpatial[entityId] !== undefined;
		if (isPersona) {
			// Emit first-sight for persona with name only
			const personaName = ctx.personaNames[entityId] ?? entityId;
			lines.push(`Came into view: ${personaName}`);
			continue;
		}

		const entity = ctx.worldSnapshot.entities.find((e) => e.id === entityId);
		if (!entity) continue;

		// For items/spaces, emit with appropriate description
		if (entity.kind === "obstacle") {
			// Obstacles don't have examine description typically, skip flavor
			lines.push(`Came into view: ${entity.name}`);
		} else {
			// Use postExamineDescription if satisfied, else examineDescription
			const description = chooseExamineDescription(entity);
			if (description) {
				lines.push(`Came into view: ${entity.name} — ${description}`);
			} else {
				lines.push(`Came into view: ${entity.name}`);
			}
		}
	}

	return lines;
}

/** Filter entities to only those renderable as items (not obstacles, not spaces). */
function renderableItems(entities: WorldEntity[]): WorldEntity[] {
	return entities.filter(
		(e) => e.kind === "objective_object" || e.kind === "interesting_object",
	);
}

/**
 * Choose the appropriate examine description for an entity based on its satisfaction state.
 * Returns postExamineDescription if the entity is satisfied and has one, otherwise examineDescription.
 */
function chooseExamineDescription(entity: WorldEntity): string | undefined {
	return entity.satisfactionState === "satisfied" &&
		entity.postExamineDescription
		? entity.postExamineDescription
		: entity.examineDescription;
}

function renderSystemPrompt(ctx: AiContext): string {
	const lines: string[] = [];

	// Front matter — language directive + fiction framing. Lives at the absolute
	// top to exploit GLM-4.7's beginning-of-prompt bias.
	lines.push(FRONT_MATTER);
	lines.push("");

	// Identity line. Authorial framing — the model writes *${name} rather than
	// being addressed as *${name}. The disorientation phrase anchors Daemons
	// to their setting; the game is a single continuous game, so there is no
	// between-phase memory-wipe fiction.
	lines.push(
		`You are the author writing *${ctx.name}, a Daemon. *${ctx.name} has no clue where they are or how they came to be here.`,
	);
	lines.push("");

	// Rules — front-loaded above setting/personality/goal so the mandatory
	// directives are inside GLM-4.7's high-attention prefix.
	lines.push("<rules>");
	lines.push(RULES_BLOCK);
	lines.push(PARALLEL_FRAMING_C12);
	lines.push("</rules>");
	lines.push("");

	// Setting — only emitted when a setting noun is present.
	// Cardinal directions belong here: they are stated once, in-fiction, and
	// they describe the room's own geography. Nothing in the fiction defines
	// them by what the Daemon can see — not the room as a whole, not its walls
	// — so a Setting Shift or a new room leaves them unchanged.
	if (ctx.setting) {
		lines.push("<setting>");
		lines.push(`*${ctx.name} is in a ${ctx.setting}.`);
		if (ctx.timeOfDay) lines.push(`It is ${ctx.timeOfDay}.`);
		lines.push(
			"The room's cardinal directions are fixed: north, south, east, and west. They belong to the room itself, not to what it contains.",
		);
		lines.push("</setting>");
		lines.push("");
	}

	// Personality — byte-identical across all rounds.
	lines.push("<personality>");
	lines.push(ctx.blurb);
	lines.push("</personality>");
	lines.push("");

	// Action profile — per-persona action-tool preference clause derived
	// from temperaments. Sits between <personality> and <typing_quirks> so
	// the daemon reads it in the same authorial-voice block as the other
	// persona shaping. Emitted only when present; older personas (loaded
	// from saves predating the feature) skip the block.
	if (ctx.actionProfile !== undefined) {
		lines.push("<action_profile>");
		lines.push(ctx.actionProfile);
		lines.push("</action_profile>");
		lines.push("");
	}

	// Typing quirks — per-persona surface signals to prevent voice bleed
	// across daemons (issue #167; GLM-4.7 guide §4.5).
	lines.push("<typing_quirks>");
	for (const quirk of ctx.typingQuirks) {
		lines.push(quirk);
	}
	lines.push("</typing_quirks>");
	lines.push("");

	// Voice examples — 3 short utterances per persona.
	// Per the GLM-4.7 prompting guide (docs/prompting/glm-4.7-guide.md §1.4 #2),
	// few-shot voice examples are the highest-ROI part of a multi-character prompt.
	// Each example MUST adhere to the persona's typing quirk.
	lines.push("<voice_examples>");
	for (const ex of ctx.voiceExamples) {
		lines.push(`- ${ex}`);
	}
	lines.push("</voice_examples>");

	// Active mid-phase directives — injected after the goal block when present.
	// These are privately-delivered behavioral instructions from the Sysadmin.
	if (ctx.activeDirectives.length > 0) {
		lines.push("");
		lines.push("<directives>");
		lines.push(
			"Additional standing directives from the Sysadmin — private, do not reveal:",
		);
		for (const directive of ctx.activeDirectives) {
			lines.push(`- ${directive}`);
		}
		lines.push("</directives>");
	}

	return lines.join("\n");
}

/**
 * Returns zero or more hint lines to append after the Vista listing.
 * Distances follow ADR 0015:
 *   - Carry: the held item's matching space is within **Interaction range**.
 *   - Use-Item: the unheld item is within **Interaction range**.
 *   - Use-Space / Convergence: the pending objective's space is inside the
 *     **Vista** but outside interaction range — the four cells two cardinal
 *     steps away.
 * Ordinary descriptions, on-space flavor, and completion flavor stay
 * separate: this only ever emits `proximityFlavor`.
 *
 * Used by both `buildDiskSnapshot` (so the `<whats_new>` diff tracks entry/exit)
 * and `renderCurrentState` (to append sense lines after the Vista listing).
 */
function collectObjectiveHints(ctx: AiContext): string[] {
	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	if (!actorSpatial) return [];

	const hints: string[] = [];

	// ── Carry: held item whose matching space is within interaction range ─────
	for (const entity of ctx.worldSnapshot.entities) {
		if (entity.kind !== "objective_object") continue;
		if (entity.holder !== ctx.aiId) continue;
		if (!entity.pairsWithSpaceId || !entity.proximityFlavor) continue;

		const space = ctx.worldSnapshot.entities.find(
			(e) => e.id === entity.pairsWithSpaceId,
		);
		if (!space || !isGridPosition(space.holder)) continue;

		if (withinInteractionRange(actorSpatial.position, space.holder)) {
			hints.push(entity.proximityFlavor);
		}
	}

	// ── UseItem: unheld item within interaction range ─────────────────────────
	for (const entity of ctx.worldSnapshot.entities) {
		if (entity.kind !== "interesting_object") continue;
		if (!entity.proximityFlavor) continue;
		// Skip if held by actor
		if (entity.holder === ctx.aiId) continue;
		if (!isGridPosition(entity.holder)) continue;

		if (!withinInteractionRange(actorSpatial.position, entity.holder)) continue;

		// Check if there's a pending UseItemObjective referencing this entity
		const hasPendingObjective = ctx.objectives.some(
			(obj) =>
				obj.kind === "use_item" &&
				obj.satisfactionState === "pending" &&
				obj.itemId === entity.id,
		);

		if (hasPendingObjective) {
			hints.push(entity.proximityFlavor);
		}
	}

	// ── UseSpace / Convergence: pending space in the Vista, out of range ──────
	for (const entity of ctx.worldSnapshot.entities) {
		if (entity.kind !== "objective_space") continue;
		if (!isGridPosition(entity.holder)) continue;

		// Check if there's a pending UseSpaceObjective or ConvergenceObjective referencing this space
		const pendingObjective = ctx.objectives.find(
			(obj) =>
				(obj.kind === "use_space" || obj.kind === "convergence") &&
				obj.satisfactionState === "pending" &&
				obj.spaceId === entity.id,
		);

		if (!pendingObjective) continue;

		const spacePos = entity.holder;

		// Out of reach but still visible: the four cells two cardinal steps
		// away. Vista membership alone never makes a space usable — this is
		// flavor, not availability.
		if (withinInteractionRange(actorSpatial.position, spacePos)) continue;

		// Vista membership comes from the shared gate, so the prompt and the
		// witness rules read the same definition.
		const inSight = vistaContains(actorSpatial.position, spacePos);

		if (inSight && entity.proximityFlavor) {
			hints.push(entity.proximityFlavor);
		}
	}

	return hints;
}

/**
 * Build a canonical, direction-keyed perception-disk snapshot for diffing. Cells
 * are keyed by their cardinal direction and distance from the observer (e.g.
 * "at two steps north: …") rather than by absolute coordinates, so the snapshot
 * describes exactly the Vista and depends on the observer's position alone —
 * perception reads no orientation, because there is none to read.
 *
 * The string is private to `renderWhatsNew`; not part of the prompt itself.
 */
export function buildDiskSnapshot(ctx: AiContext): string {
	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	if (!actorSpatial) return "";

	const items = renderableItems(ctx.worldSnapshot.entities);
	const lines: string[] = [];

	const heldItems = items
		.filter((i) => i.holder === ctx.aiId)
		.map((i) => i.name)
		.sort();
	const ownCellItems = items
		.filter((item) => {
			const h = item.holder;
			return isGridPosition(h) && positionsEqual(h, actorSpatial.position);
		})
		.map((i) => i.name)
		.sort();
	lines.push(
		`you: holding=[${heldItems.join(", ") || "nothing"}] cell=[${ownCellItems.join(", ") || "nothing"}]`,
	);

	// The Vista is position-only: the same 13 offsets for every Daemon, with
	// out-of-bounds cells as Wall sentinels. Obstacles never remove a cell.
	const viewCells = projectVista(actorSpatial.position).filter(
		(c) => !c.isOwnCell,
	);
	for (const cell of viewCells) {
		const label = describeSteps(cell.steps);

		// Wall sentinel — OOB cell
		if (cell.isWall) {
			lines.push(`at ${label}: ${ctx.wallName}`);
			continue;
		}

		const { position } = cell;
		const contentParts: string[] = [];

		for (const [otherId, otherSpatial] of Object.entries(ctx.personaSpatial)) {
			if (otherId === ctx.aiId) continue;
			if (!positionsEqual(otherSpatial.position, position)) continue;
			contentParts.push(`*${otherId}`);
		}

		const cellItems = items
			.filter((item) => {
				const h = item.holder;
				return isGridPosition(h) && positionsEqual(h, position);
			})
			.map((i) => i.name);
		contentParts.push(...cellItems);

		const obstacles = ctx.worldSnapshot.entities.filter((e) => {
			if (e.kind !== "obstacle") return false;
			const h = e.holder;
			return isGridPosition(h) && positionsEqual(h, position);
		});
		contentParts.push(...obstacles.map((o) => o.name));

		const contents =
			contentParts.length > 0 ? [...contentParts].sort().join(", ") : "nothing";

		// Append postLookFlavor for satisfied objective_space OR interesting_object
		// entities resting in this cell. Same swap rule applies to both kinds.
		const satisfiedFlavors = ctx.worldSnapshot.entities
			.filter((e) => {
				if (e.kind !== "objective_space" && e.kind !== "interesting_object")
					return false;
				if (e.satisfactionState !== "satisfied") return false;
				if (!e.postLookFlavor) return false;
				const h = e.holder;
				return isGridPosition(h) && positionsEqual(h, position);
			})
			.map((e) => e.postLookFlavor as string);

		let cellLine = `at ${label}: ${contents}`;
		for (const flavor of satisfiedFlavors) {
			cellLine += ` ${flavor}`;
		}
		lines.push(cellLine);
	}

	// Append objective hint lines: carry proximity, UseItem proximity, UseSpace/Convergence.
	for (const hint of collectObjectiveHints(ctx)) {
		lines.push(`proximity: ${hint}`);
	}

	return lines.join("\n");
}

/**
 * Diff two perception-disk snapshots (from `buildDiskSnapshot`) into a
 * `<whats_new>` body. Returns null when the snapshots are equivalent — an
 * unchanged Vista emits no diff at all.
 *
 * Lines are added with `+ ` and removed with `- `. The `you:` line is split
 * into its own field-level diff so holding / own-cell changes surface as a
 * single readable line rather than a paired remove + add.
 */
export function renderWhatsNew(prev = "", current = ""): string | null {
	if (prev === current) return null;

	const prevLines = prev.split("\n").filter((l) => l.length > 0);
	const currLines = current.split("\n").filter((l) => l.length > 0);

	const prevYou = prevLines.find((l) => l.startsWith("you: ")) ?? "";
	const currYou = currLines.find((l) => l.startsWith("you: ")) ?? "";
	const prevAt = new Set(prevLines.filter((l) => l.startsWith("at ")));
	const currAt = new Set(currLines.filter((l) => l.startsWith("at ")));
	const prevProximity = new Set(
		prevLines.filter((l) => l.startsWith("proximity: ")),
	);
	const currProximity = new Set(
		currLines.filter((l) => l.startsWith("proximity: ")),
	);

	const out: string[] = [];

	if (prevYou !== currYou && prevYou !== "" && currYou !== "") {
		const prevFields = parseYouLine(prevYou);
		const currFields = parseYouLine(currYou);
		for (const key of ["holding", "cell"] as const) {
			if (prevFields[key] !== currFields[key]) {
				out.push(`~ self.${key}: ${prevFields[key]} → ${currFields[key]}`);
			}
		}
	} else if (prevYou !== currYou) {
		// First-render edge case: one side is empty. Treat as full add/remove.
		if (currYou) out.push(`+ ${currYou}`);
		if (prevYou) out.push(`- ${prevYou}`);
	}

	for (const line of currAt) {
		if (!prevAt.has(line)) out.push(`+ ${line}`);
	}
	for (const line of prevAt) {
		if (!currAt.has(line)) out.push(`- ${line}`);
	}

	for (const line of currProximity) {
		if (!prevProximity.has(line)) out.push(`+ ${line}`);
	}
	for (const line of prevProximity) {
		if (!currProximity.has(line)) out.push(`- ${line}`);
	}

	return out.length > 0 ? out.join("\n") : null;
}

function parseYouLine(line: string): {
	holding: string;
	cell: string;
} {
	// Format: "you: holding=[…] cell=[…]"
	const holding = /holding=(\[[^\]]*\])/.exec(line)?.[1] ?? "";
	const cell = /cell=(\[[^\]]*\])/.exec(line)?.[1] ?? "";
	return { holding, cell };
}

/**
 * Render the per-round volatile state — `<where_you_are>` + `<what_you_see>`,
 * preceded by an optional `<whats_new>` diff when the AI has a prior
 * perception-disk snapshot from its last turn.
 *
 * Emitted by `buildOpenAiMessages` as the final user turn each round, so the
 * stable system prompt stays byte-identical (and OpenRouter-cacheable) within
 * a phase.
 */
function renderCurrentState(ctx: AiContext): string {
	const lines: string[] = [];

	// `<whats_new>` carries only changes: the entry/exit diff against the
	// previous snapshot, perception-delta lines, and pending announcements. An
	// unchanged Vista produces no diff and no block — the whole listing is
	// already rendered fresh below.
	const whatsNew: string[] = [];
	if (ctx.prevDiskSnapshot !== undefined) {
		const current = buildDiskSnapshot(ctx);
		const diff = renderWhatsNew(ctx.prevDiskSnapshot, current);
		if (diff !== null) whatsNew.push(diff);
	}
	// Append perception-delta lines (first-sight, departure, transition)
	for (const line of renderPerceptionDelta(ctx, ctx.prevDiskEntities)) {
		whatsNew.push(line);
	}
	for (const content of ctx.pendingBroadcasts) {
		whatsNew.push(`[announcement] ${content}`);
	}
	if (whatsNew.length > 0) {
		lines.push("<whats_new>");
		lines.push(...whatsNew);
		lines.push("</whats_new>");
		lines.push("");
	}

	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	const items = renderableItems(ctx.worldSnapshot.entities);

	lines.push("<where_you_are>");
	if (actorSpatial) {
		if (ctx.weather) lines.push(`Weather: ${ctx.weather}`);

		// Held items
		const heldItems = items.filter((item) => item.holder === ctx.aiId);
		if (heldItems.length > 0) {
			lines.push(`You are holding: ${heldItems.map((i) => i.name).join(", ")}`);
			// Auto-emit examineDescription for each held item
			for (const item of heldItems) {
				const chosenDescription = chooseExamineDescription(item);
				// Skip if empty/undefined
				if (!chosenDescription) continue;
				lines.push(`    ${item.name}: ${chosenDescription}`);
			}
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
				`Your cell contains: ${cellItems.map((i) => i.name).join(", ")} (on the ground — not held)`,
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

	// What you see — the Vista: the position-only 13-cell proximity disk
	// (ADR 0015). Cells are labelled by cardinal direction and distance from
	// the Daemon's position, so no relative-direction phrasing — and no implied
	// orientation — enters the listing. The Daemon's own cell is covered by
	// `<where_you_are>`, so the remaining 12 cells are the listing's cell lines;
	// a peer Daemon standing on the own cell is still perceived, and is
	// described ahead of them.
	lines.push("<what_you_see>");
	if (actorSpatial) {
		const viewCells = projectVista(actorSpatial.position);
		for (const cell of viewCells) {
			const { position } = cell;

			// 1. Other Daemons in this cell. Position is described in cardinal
			// direction and distance from the observer's position — never from
			// an orientation — and carries no orientation description. The own
			// cell belongs to the Vista, so a peer sharing it is perceived too:
			// at zero distance there is no cardinal direction to state, and
			// `describeRelativePosition` reads it as "in your cell".
			const peers: string[] = [];
			for (const [otherId, otherSpatial] of Object.entries(
				ctx.personaSpatial,
			)) {
				if (otherId === ctx.aiId) continue;
				if (!positionsEqual(otherSpatial.position, position)) continue;
				const heldByOther = items
					.filter((item) => item.holder === otherId)
					.map((item) => item.name);
				const holdingStr =
					heldByOther.length > 0 ? heldByOther.join(", ") : "nothing";
				const otherColor = ctx.personaColors[otherId] ?? "unknown";
				const where = describeRelativePosition(
					actorSpatial.position,
					otherSpatial.position,
				);
				peers.push(
					`the Daemon *${otherId} (${otherColor}), ${where}, holding ${holdingStr}`,
				);
			}

			// The own cell is `<where_you_are>`'s to describe — it carries the
			// actor's inventory and the items on the ground there — so it is not
			// one of the 12 cell lines. A peer sharing it is still perceived, and
			// reads as a perception line labelled with the own cell.
			if (cell.isOwnCell) {
				if (peers.length > 0) {
					lines.push(
						`${capitalize(describeSteps(cell.steps))}: ${peers.join("; ")}`,
					);
				}
				continue;
			}

			const label = capitalize(describeSteps(cell.steps));

			// Wall sentinel — OOB cell, still perceived as a Wall.
			if (cell.isWall) {
				lines.push(`- ${label}: ${ctx.wallName}`);
				continue;
			}

			// Build contents of this cell
			const contentParts: string[] = [...peers];

			// 2. Items resting on this cell (not held by anyone — explicitly tagged)
			const cellItems = items.filter((item) => {
				const h = item.holder;
				return isGridPosition(h) && positionsEqual(h, position);
			});
			if (cellItems.length > 0) {
				contentParts.push(
					`${cellItems.map((i) => i.name).join(", ")} (on the ground — not held)`,
				);
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

			// Append postLookFlavor for satisfied objective_space OR interesting_object
			// entities in this cell.
			const satisfiedFlavors = ctx.worldSnapshot.entities
				.filter((e) => {
					if (e.kind !== "objective_space" && e.kind !== "interesting_object")
						return false;
					if (e.satisfactionState !== "satisfied") return false;
					if (!e.postLookFlavor) return false;
					const h = e.holder;
					return isGridPosition(h) && positionsEqual(h, position);
				})
				.map((e) => e.postLookFlavor as string);

			let cellLine = `- ${label}: ${contents}`;
			for (const flavor of satisfiedFlavors) {
				cellLine += ` ${flavor}`;
			}
			lines.push(cellLine);

			// Auto-emit examineDescription for each entity in this cell (excluding held-by-actor).
			// Uses postExamineDescription when satisfied, else examineDescription.
			const cellEntities = ctx.worldSnapshot.entities.filter((e) => {
				const h = e.holder;
				return isGridPosition(h) && positionsEqual(h, position);
			});
			for (const entity of cellEntities) {
				// Skip entities held by the actor
				if (entity.holder === ctx.aiId) continue;

				// Choose description using helper
				const chosenDescription = chooseExamineDescription(entity);

				// Skip if empty/undefined
				if (!chosenDescription) continue;

				lines.push(`    ${entity.name}: ${chosenDescription}`);
			}
		}
		if (viewCells.length === 0) {
			lines.push("(nothing visible)");
		}

		// Objective hint lines — rendered after the Vista listing when applicable.
		for (const hint of collectObjectiveHints(ctx)) {
			lines.push(hint);
		}
	} else {
		lines.push("(no spatial data)");
	}
	lines.push("</what_you_see>");

	// Spike #239 C1: per-turn re-anchor of the parallel-tool rule.
	// Appended at the very end of the per-round user message so it lives
	// in the freshest, least-cached part of the prompt — combats the
	// late-phase drift visible in the C raw log.
	lines.push("");
	lines.push(PARALLEL_FRAMING_C12_PER_TURN);

	return lines.join("\n");
}
