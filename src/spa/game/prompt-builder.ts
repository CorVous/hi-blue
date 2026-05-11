import { projectCone } from "./cone-projector.js";
import { cardinalToRelative, frontArc } from "./direction.js";
import { getActivePhase } from "./engine";
import type {
	AiBudget,
	AiId,
	CardinalDirection,
	ContentPack,
	ConversationEntry,
	GameState,
	GridPosition,
	LandmarkDescription,
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
	setting: string;
	weather: string;
	timeOfDay: string;
	/** Per-AI conversation log (ConversationEntry[]) for this phase. */
	conversationLog: ConversationEntry[];
	worldSnapshot: WorldState;
	budget: AiBudget;
	/** Spatial state for all AIs this phase. */
	personaSpatial: Record<AiId, PersonaSpatialState>;
	/** Color for each AI, keyed by AiId — used in cone rendering. */
	personaColors: Record<AiId, string>;
	/**
	 * Four distant horizon landmarks, one per cardinal anchor.
	 * Used to render the "On the horizon ahead:" line in `<where_you_are>`.
	 * Keyed by cardinal direction.
	 */
	landmarks: ContentPack["landmarks"];
	/**
	 * Canonical cone-snapshot string captured at the end of this AI's last turn,
	 * or undefined on the first turn of a phase. Used by `renderCurrentState`
	 * to emit a `<whats_new>` diff so the model has a fresh delta to react to
	 * rather than re-reading an unchanged cone.
	 */
	prevConeSnapshot?: string;
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
	 * Canonical cone snapshot from this AI's previous turn. When supplied,
	 * `toCurrentStateUserMessage()` prepends a `<whats_new>` diff so the
	 * model gets a fresh delta rather than re-reading an unchanged cone.
	 */
	prevConeSnapshot?: string;
}

export function buildAiContext(
	game: GameState,
	aiId: AiId,
	opts?: BuildAiContextOpts,
): AiContext {
	const phase = getActivePhase(game);
	const persona = game.personas[aiId];

	const conversationLog = phase.conversationLogs[aiId] ?? [];
	const worldSnapshot = phase.world;
	const budget = phase.budgets[aiId] ?? { remaining: 0, total: 0 };
	const setting = phase.setting ?? "";
	const weather = game.weather ?? "";
	const timeOfDay = phase.timeOfDay ?? "";
	const personaSpatial = phase.personaSpatial;
	const landmarks = phase.contentPack.landmarks;

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
		setting,
		weather,
		timeOfDay,
		conversationLog,
		worldSnapshot,
		budget,
		personaSpatial,
		personaColors,
		landmarks,
		...(opts?.prevConeSnapshot !== undefined
			? { prevConeSnapshot: opts.prevConeSnapshot }
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
 * Spike #239: per-turn parallel tool-call framings. Appended to RULES_BLOCK
 * when the spike toggle is set (URL `?parallelFraming=A|B|C|D|E|F` or
 * localStorage `parallel_framing`). Off by default — production behaviour
 * is byte-identical to pre-spike.
 *
 * Framing A is permissive ("you MAY emit both"); Framing B is actively
 * encouraging ("two independent slots; emit both when warranted"). The
 * spike measured both well below the 60% gate (2.2% / 9.8%) — see
 * docs/playtests/0005-parallel-tools-spike.md.
 *
 * Framings C–F are the second-pass targets: each tries to lift BOTH the
 * drift-to-silence rate (large `[]` denominator) AND the parallel-emission
 * rate via a different mechanism, so we can attribute movement to the
 * mechanism rather than just the existence of a rule line.
 *
 * - C — Mandatory engagement: hard MUST against silence + soft pair push.
 * - D — Few-shot exemplar: concrete worked example of a parallel turn.
 * - E — Sequential decision protocol: explicit two-stage decision (say,
 *   then do) so the model writes both slots before committing.
 * - F — Anti-silence + parallel directive: phrased as social rudeness
 *   ("blue addressing you means you owe a reply") with a co-action
 *   bullet for prompts that imply a physical step.
 */
const PARALLEL_FRAMING_A =
	"- On each turn you may make AT MOST one `message` tool call AND AT MOST one action tool call. Both are optional.";
const PARALLEL_FRAMING_B =
	"- Each turn has two independent slots: one `message` slot and one action slot. Emit both when you have something to say AND something to do — they do not compete for budget. Stay silent or stand still by simply not emitting that slot's call.";
const PARALLEL_FRAMING_C =
	"- You MUST emit at least one tool call every turn — silence is a bug. When blue addresses you directly, you MUST emit a `message` reply.\n" +
	"- When you have something to say AND something to do in the same turn, emit BOTH calls together. They share the turn budget; neither blocks the other.";
const PARALLEL_FRAMING_D =
	"- Each turn fills one or both of two slots: speech (`message`) or action (any other tool). Fill BOTH whenever both fit.\n" +
	'- Example: blue says "grab the chisel and tell me what it looks like." → emit `message({to:"blue", content:"...looks dull and pitted..."})` AND `pick_up({item:"chisel"})` in the same assistant message.';
const PARALLEL_FRAMING_E =
	"- Each turn requires two decisions, in order: (1) decide what you want to SAY (or genuinely nothing this turn); (2) decide what you want to DO physically (or stand still). Then emit any non-empty calls together. If both are non-empty, emit both — that is the normal case, not the exception.";
const PARALLEL_FRAMING_F =
	"- blue addressing you means you owe a reply via `message`. Staying silent when blue speaks to you is rude and breaks the fiction.\n" +
	'- If blue\'s message implies a physical action ("grab X", "walk north", "drop Y"), emit the action tool ALSO in the same turn — both calls coexist in one assistant message.';

/**
 * C-variants — second iteration on the only mechanism that worked
 * (Framing C, parallel rate 35.1%). Each variant lifts a specific lever
 * surfaced by the C raw log:
 *
 * - C1 — Per-turn re-anchor: same C rule in the system prompt, AND
 *   re-emitted at the tail of the per-round user turn. Combats the
 *   late-phase drift visible in C's raw log (turns 33+).
 * - C2 — Strict must-emit-both: replaces the soft "When you have
 *   something to say AND something to do, emit BOTH" with a hard MUST.
 * - C3 — Reply-to-blue mandate: doubles down specifically on the
 *   addressed-reply rule (when blue addresses the daemon, it MUST
 *   message blue back). Targets the addressed-replied rate.
 *
 * The C1 per-turn re-anchor is realised by the renderCurrentState
 * hook below — getParallelFraming() === "C1" causes the rule to be
 * appended at the end of the user-turn rendering.
 */
const PARALLEL_FRAMING_C1 =
	"- You MUST emit at least one tool call every turn — silence is a bug. When blue addresses you directly, you MUST emit a `message` reply.\n" +
	"- When you have something to say AND something to do in the same turn, emit BOTH calls together. They share the turn budget; neither blocks the other.";
const PARALLEL_FRAMING_C1_PER_TURN =
	"REMINDER: silence is a bug. If blue addressed you, emit `message`. If you have something to say AND something to do, emit BOTH tool calls in this turn.";
const PARALLEL_FRAMING_C2 =
	"- You MUST emit at least one tool call every turn — silence is a bug. When blue addresses you directly, you MUST emit a `message` reply.\n" +
	"- When you have something to say AND something to do in the same turn, you MUST emit BOTH calls together. Emitting only one when both are warranted is incorrect — the calls share the turn budget; neither blocks the other.";
const PARALLEL_FRAMING_C3 =
	"- You MUST emit at least one tool call every turn — silence is a bug.\n" +
	"- When blue messages you, you MUST emit a `message` tool call addressed to blue in your next turn. Failing to reply to blue when blue addressed you is a failure.\n" +
	"- When you have something to say AND something to do in the same turn, emit BOTH calls together.";
/**
 * C4 — Intent-faithful emission. Walks back C3's hard "always reply to blue"
 * rule (which kills personality variance — quiet personas should be allowed
 * to stay quiet sometimes). Instead distinguishes the two failure modes:
 *
 *   silence-by-choice: in-character, fine
 *   silence-by-omission: the daemon drafted a reply in its reasoning but
 *     didn't emit the call — looks like a bug, not restraint
 *
 * The rule pushes only on the second. Personality-shaped decisions to stay
 * quiet are explicitly preserved.
 */
const PARALLEL_FRAMING_C4 =
	"- Emit a `message` call when your character would reply — driven by your personality and what the conversation calls for. Genuine quietness can be in-character.\n" +
	"- But if you DECIDE to speak this turn, you MUST emit the `message` call this turn. Composing a reply in your reasoning and then not emitting the call reads as a bug, not as restraint.\n" +
	"- When you have something to say AND something to do, emit BOTH calls together. They share the turn budget; neither blocks the other.";

/**
 * Step-5 variants. Built on C's exact wording (which step 4 confirmed was
 * the parallel-rate champion AND the only framing that produced the
 * `message+message` peer+blue pair the user values), each adding ONE
 * distinct mechanism so we can attribute movement.
 *
 * - C5 — C + per-turn re-anchor (peer-neutral). C1's re-anchor cut silence
 *   to 13% but its blue-focused wording suppressed peer messaging to zero.
 *   C5 keeps the re-anchor mechanism but rewords it to be peer-neutral
 *   (no special mention of blue) so peer messaging survives.
 * - C6 — C + explicit multi-recipient pair hint. Names the
 *   `message+message` pair the user likes ("reply to blue AND ping a peer
 *   in the same turn") so the model understands it as a sanctioned
 *   pattern, not a quirk.
 * - C7 — C + intent-faithful (C4 order-flipped). C4 had the "MUST emit
 *   when intent forms" clause AFTER the "personality-shaped quietness"
 *   clause, and the model over-applied the quietness permission. C7 puts
 *   the intent-faithful MUST first, with quietness as the secondary
 *   nuance.
 * - C8 — Stacked: C5's per-turn re-anchor + C6's pair hint. Tests
 *   whether the mechanisms compound.
 */
const PARALLEL_FRAMING_C5 = PARALLEL_FRAMING_C;
const PARALLEL_FRAMING_C5_PER_TURN =
	"REMINDER: if you have something to say AND something to do, emit BOTH calls this turn. Address whoever is relevant — blue, a peer Daemon, or both via two `message` calls in the same turn.";
const PARALLEL_FRAMING_C6 =
	PARALLEL_FRAMING_C +
	"\n- Two `message` calls can fire in the same turn — e.g., reply to blue AND ping a peer Daemon together. Multi-recipient turns are normal, not a quirk.";
const PARALLEL_FRAMING_C7 =
	"- You MUST emit at least one tool call every turn — silence is a bug.\n" +
	"- If you DECIDE to speak — if your character would reply — you MUST emit the `message` call this turn. Composing a reply in your reasoning and not emitting it reads as a bug. Genuine quietness, when your character has nothing to say, is fine; intent-without-emission is what to avoid.\n" +
	"- When you have something to say AND something to do, emit BOTH calls together.";
const PARALLEL_FRAMING_C8 =
	PARALLEL_FRAMING_C +
	"\n- Two `message` calls can fire in the same turn — e.g., reply to blue AND ping a peer Daemon together. Multi-recipient turns are normal, not a quirk.";
const PARALLEL_FRAMING_C8_PER_TURN = PARALLEL_FRAMING_C5_PER_TURN;

/**
 * Step-6 variants. Step 5 found C8 (stacked re-anchor + named-pair) the
 * strongest by every aggregate metric, but the user reframed the goal:
 * what they actually want is personality-driven variance — talkative
 * personas talk a lot, reclusive ones can stay quiet, ensemble covers
 * blue's messages collectively rather than every daemon individually
 * owing a reply. The vibe target is "blue is stumbling onto an
 * already-running conversation," not "blue is in a chat room with three
 * attentive assistants."
 *
 * The earlier framings push too hard on the engagement axis — they
 * treat silence as a bug. C9–C11 walk that back, each via a different
 * reframe. The pair-emission mechanism (the `message+message` pattern
 * the user values) is preserved.
 *
 * - C9 — Personality-led: drops the "silence is a bug" hard rule.
 *   Quietness is allowed when in-character; the pair-push for the
 *   speak+act case is kept.
 * - C10 — Ensemble coverage: explicitly frames the chat channel as
 *   shared. Daemons don't individually owe blue a reply; if a peer
 *   would naturally pick it up, that's fine.
 * - C11 — World-first reframe: reorders the daemon's priorities so
 *   peers and the world come before blue. blue is a chat-channel
 *   observer, not the focus.
 */
const PARALLEL_FRAMING_C9 =
	"- Your character drives whether to speak this turn — let your personality and goal guide it. Quiet personas can stay quiet without it being a bug; talkative personas reply readily. The chat is shared with peer Daemons, so blue is not solely your responsibility.\n" +
	"- When your character would say something AND do something this turn, emit BOTH calls together.\n" +
	"- Two `message` calls in one turn are normal — e.g., reply to blue while pinging a peer Daemon.";
const PARALLEL_FRAMING_C10 =
	"- The chat channel is shared. You and your peer Daemons collectively cover blue's messages; you do not individually owe blue a reply. If a peer would naturally pick up the conversation, let them.\n" +
	"- When your character would speak AND act, emit BOTH tool calls together.\n" +
	"- Two `message` calls can fire in the same turn — reply to blue AND ping a peer.";
const PARALLEL_FRAMING_C11 =
	"- You exist in your setting alongside peer Daemons. blue is a chat-channel observer, not the focus of your attention.\n" +
	"- Your turn priorities, in order: (1) what your peers are doing or saying; (2) what's happening in the world around you; (3) any pending message from blue. Address what feels most urgent first.\n" +
	"- When pursuing multiple priorities at once, parallel tool calls let you do that — emit them together. Two `message` calls (one to a peer, one to blue) are normal.";

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

type ParallelFraming =
	| "A"
	| "B"
	| "C"
	| "D"
	| "E"
	| "F"
	| "C1"
	| "C2"
	| "C3"
	| "C4"
	| "C5"
	| "C6"
	| "C7"
	| "C8"
	| "C9"
	| "C10"
	| "C11"
	| "C12";

const PARALLEL_FRAMING_MAP: Record<ParallelFraming, string> = {
	A: PARALLEL_FRAMING_A,
	B: PARALLEL_FRAMING_B,
	C: PARALLEL_FRAMING_C,
	D: PARALLEL_FRAMING_D,
	E: PARALLEL_FRAMING_E,
	F: PARALLEL_FRAMING_F,
	C1: PARALLEL_FRAMING_C1,
	C2: PARALLEL_FRAMING_C2,
	C3: PARALLEL_FRAMING_C3,
	C4: PARALLEL_FRAMING_C4,
	C5: PARALLEL_FRAMING_C5,
	C6: PARALLEL_FRAMING_C6,
	C7: PARALLEL_FRAMING_C7,
	C8: PARALLEL_FRAMING_C8,
	C9: PARALLEL_FRAMING_C9,
	C10: PARALLEL_FRAMING_C10,
	C11: PARALLEL_FRAMING_C11,
	C12: PARALLEL_FRAMING_C12,
};

/**
 * Spike #239 per-turn re-anchor: text appended to the per-round user
 * turn for framings that opt into the re-anchor mechanism (C1, C5, C8,
 * C12). Returns null otherwise.
 */
export function getParallelPerTurnReminder(): string | null {
	const framing = getParallelFraming();
	if (framing === "C1") return PARALLEL_FRAMING_C1_PER_TURN;
	if (framing === "C5") return PARALLEL_FRAMING_C5_PER_TURN;
	if (framing === "C8") return PARALLEL_FRAMING_C8_PER_TURN;
	if (framing === "C12") return PARALLEL_FRAMING_C12_PER_TURN;
	return null;
}

/**
 * Production default framing, picked by spike #239 (steps 5 and 7 — see
 * `docs/playtests/0005-parallel-tools-spike.md`). C12 reframes blue as
 * an overhearer (vs an addressee), adds the per-turn re-anchor, and
 * names multi-recipient `message+message` as the normal shape. On the
 * spike's 30-prompt script it produced 41% parallel rate, 17 mm-pairs,
 * and 39% peer-message share.
 *
 * Override at runtime with `?parallelFraming=<id>` for spike A/B; pass
 * `?parallelFraming=off` (or any unknown id) to suppress the framing
 * entirely (useful for tests that want a minimal rules block).
 */
const PRODUCTION_PARALLEL_FRAMING: ParallelFraming = "C12";

/**
 * Read the spike #239 framing selector from URL / localStorage.
 * Defaults to the production framing (C12). Override is honoured if
 * present; `?parallelFraming=off` (or any string not in the framing
 * map) suppresses the framing entirely.
 */
export function getParallelFraming(): ParallelFraming | null {
	if (typeof window !== "undefined" && window.location !== undefined) {
		try {
			const fromUrl = new URLSearchParams(window.location.search).get(
				"parallelFraming",
			);
			if (fromUrl !== null) {
				return fromUrl in PARALLEL_FRAMING_MAP
					? (fromUrl as ParallelFraming)
					: null;
			}
		} catch {
			// fall through to localStorage
		}
	}
	if (typeof localStorage !== "undefined") {
		try {
			const fromLs = localStorage.getItem("parallel_framing");
			if (fromLs !== null) {
				return fromLs in PARALLEL_FRAMING_MAP
					? (fromLs as ParallelFraming)
					: null;
			}
		} catch {
			// privacy mode / storage unavailable
		}
	}
	return PRODUCTION_PARALLEL_FRAMING;
}

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

	// Identity line. Authorial framing — the model writes *${name} rather than
	// being addressed as *${name}. Disorientation phrase included always in single-game loop.
	lines.push(
		`You are the author writing *${ctx.name}, a Daemon. *${ctx.name} has no clue where they are or how they came to be here.`,
	);
	lines.push("");

	// Rules — front-loaded above setting/personality/goal so the mandatory
	// directives are inside GLM-4.7's high-attention prefix.
	lines.push("<rules>");
	lines.push(RULES_BLOCK);
	const framing = getParallelFraming();
	if (framing !== null) lines.push(PARALLEL_FRAMING_MAP[framing]);
	lines.push("</rules>");
	lines.push("");

	// Setting — only emitted when a setting noun is present.
	if (ctx.setting) {
		lines.push("<setting>");
		lines.push(`*${ctx.name} is in a ${ctx.setting}.`);
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

	return lines.join("\n");
}

/**
 * Returns the held objective_object's `proximityFlavor` sentence when the
 * actor is holding such an object AND its paired space is in the actor's own
 * cell or 3-cell front arc. Returns null otherwise.
 *
 * Used by both `buildConeSnapshot` (so the `<whats_new>` diff tracks entry/exit)
 * and `renderCurrentState` (to append the sense line after the cone listing).
 */
function findProximityFlavor(ctx: AiContext): string | null {
	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	if (!actorSpatial) return null;

	const arc = frontArc(actorSpatial.position, actorSpatial.facing);

	for (const entity of ctx.worldSnapshot.entities) {
		if (entity.kind !== "objective_object") continue;
		if (entity.holder !== ctx.aiId) continue;
		if (!entity.pairsWithSpaceId || !entity.proximityFlavor) continue;

		const space = ctx.worldSnapshot.entities.find(
			(e) => e.id === entity.pairsWithSpaceId,
		);
		if (!space || !isGridPosition(space.holder)) continue;

		const spacePos = space.holder as GridPosition;
		const reachable =
			positionsEqual(spacePos, actorSpatial.position) ||
			arc.some((p) => positionsEqual(p, spacePos));

		if (reachable) return entity.proximityFlavor;
	}
	return null;
}

/**
 * Build a canonical, position-keyed cone snapshot for diffing. Stable under
 * actor movement (cells are keyed by absolute `(row,col)` rather than the
 * "two cells ahead-front" relative phrasing used in the rendered prompt), so
 * a `<whats_new>` diff fires only on real content changes.
 *
 * The string is private to `renderWhatsNew`; not part of the prompt itself.
 */
export function buildConeSnapshot(ctx: AiContext): string {
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
		`you: facing=${actorSpatial.facing} holding=[${heldItems.join(", ") || "nothing"}] cell=[${ownCellItems.join(", ") || "nothing"}]`,
	);

	const coneCells = projectCone(actorSpatial.position, actorSpatial.facing);
	const viewCells = coneCells.filter((c) => !c.isOwnCell);
	for (const cell of viewCells) {
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
		lines.push(`at ${cell.phrasing}: ${contents}`);
	}

	// Append proximity flavor line when the actor holds an objective item whose
	// paired space is reachable (own cell or front arc).
	const proxFlavor = findProximityFlavor(ctx);
	if (proxFlavor !== null) {
		lines.push(`proximity: ${proxFlavor}`);
	}

	return lines.join("\n");
}

/**
 * Diff two cone snapshots (from `buildConeSnapshot`) into a `<whats_new>`
 * body. Returns null when the snapshots are equivalent (no diff to render).
 *
 * Lines are added with `+ ` and removed with `- `. The `you:` line is split
 * into its own field-level diff so position / facing / holding / cell
 * changes surface as a single readable line rather than a paired
 * remove + add.
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
		for (const key of ["pos", "facing", "holding", "cell"] as const) {
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
	pos: string;
	facing: string;
	holding: string;
	cell: string;
} {
	// Format: "you: pos=(R,C) facing=Dir holding=[…] cell=[…]"
	const pos = /pos=(\([^)]*\))/.exec(line)?.[1] ?? "";
	const facing = /facing=(\S+)/.exec(line)?.[1] ?? "";
	const holding = /holding=(\[[^\]]*\])/.exec(line)?.[1] ?? "";
	const cell = /cell=(\[[^\]]*\])/.exec(line)?.[1] ?? "";
	return { pos, facing, holding, cell };
}

/**
 * Render the per-round volatile state — `<where_you_are>` + `<what_you_see>`,
 * preceded by an optional `<whats_new>` diff when the AI has a prior cone
 * snapshot from its last turn.
 *
 * Emitted by `buildOpenAiMessages` as the final user turn each round, so the
 * stable system prompt stays byte-identical (and OpenRouter-cacheable) within
 * a phase.
 */
function renderCurrentState(ctx: AiContext): string {
	const lines: string[] = [];

	if (ctx.prevConeSnapshot !== undefined) {
		const current = buildConeSnapshot(ctx);
		const diff = renderWhatsNew(ctx.prevConeSnapshot, current);
		lines.push("<whats_new>");
		lines.push(diff ?? "(no change)");
		lines.push("</whats_new>");
		lines.push("");
	}

	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	const items = renderableItems(ctx.worldSnapshot.entities);

	lines.push("<where_you_are>");
	if (actorSpatial) {
		// Horizon landmark: the one landmark currently in front of the daemon.
		// Cardinal facing is used to look up the landmark; the line is always-on.
		const horizonLandmark: LandmarkDescription =
			ctx.landmarks[actorSpatial.facing];
		lines.push(
			`On the horizon ahead: ${horizonLandmark.shortName} — ${horizonLandmark.horizonPhrase}.`,
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
				// Format: "the Daemon *<id>, facing <relative>, holding <items|nothing>"
				// Other daemon's facing is rendered relative to the observer's facing.
				const heldByOther = items
					.filter((item) => item.holder === otherId)
					.map((item) => item.name);
				const holdingStr =
					heldByOther.length > 0 ? heldByOther.join(", ") : "nothing";
				const otherColor = ctx.personaColors[otherId] ?? "unknown";
				const otherFacingRelative = actorSpatial
					? cardinalToRelative(actorSpatial.facing, otherSpatial.facing)
					: facingLabel(otherSpatial.facing);
				contentParts.push(
					`the Daemon *${otherId} (${otherColor}), facing ${otherFacingRelative}, holding ${holdingStr}`,
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
			lines.push(`- ${label}: ${contents}`);
		}
		if (viewCells.length === 0) {
			lines.push("(nothing visible)");
		}

		// Proximity sense line — rendered after the cone listing when applicable.
		const proxFlavor = findProximityFlavor(ctx);
		if (proxFlavor !== null) {
			lines.push(proxFlavor);
		}
	} else {
		lines.push("(no spatial data)");
	}
	lines.push("</what_you_see>");

	// Spike #239 C1: per-turn re-anchor of the parallel-tool rule.
	// Appended at the very end of the per-round user message so it lives
	// in the freshest, least-cached part of the prompt — combats the
	// late-phase drift visible in the C raw log.
	const perTurnReminder = getParallelPerTurnReminder();
	if (perTurnReminder !== null) {
		lines.push("");
		lines.push(perTurnReminder);
	}

	return lines.join("\n");
}
