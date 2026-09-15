import type { CardinalDirection, GridPosition } from "./direction.js";

export type { CardinalDirection, GridPosition };

export type ObjectiveType = "carry" | "use_space" | "use_item" | "convergence";
export const OBJECTIVE_TYPES: readonly ObjectiveType[] = [
	"carry",
	"use_space",
	"use_item",
	"convergence",
] as const;

export type AiId = string;

export interface AiPersona {
	id: AiId;
	name: string;
	color: string;
	temperaments: [string, string];
	personaGoal: string;
	typingQuirks: [string, string, ...string[]];
	blurb: string;
	/**
	 * Three short, single-sentence in-character utterances synthesized alongside
	 * the blurb. Rendered into the `<voice_examples>` block in the system prompt.
	 * Length is exactly 3.
	 */
	voiceExamples: string[];
	/**
	 * Per-persona action-tool preference clause derived from temperaments.
	 * Rendered as `<action_profile>` in the system prompt. Drives variation in
	 * action-tool emission (go / look / examine / pick_up / put_down / give /
	 * use) the same way `blurb` drives engagement. See
	 * `src/content/action-preference-bias.ts`.
	 *
	 * Optional for back-compat with saves written before the field existed;
	 * prompt-builder falls back gracefully when absent.
	 */
	actionProfile?: string;
}

type WorldEntityKind =
	| "objective_object"
	| "objective_space"
	| "interesting_object"
	| "obstacle";

export interface WorldEntity {
	id: string;
	kind: WorldEntityKind;
	name: string;
	examineDescription: string;
	/** useOutcome: returned to AI when they use(item). Present on all non-obstacle kinds. */
	useOutcome?: string;
	/** For objective_object: the id of the objective_space this object pairs with. */
	pairsWithSpaceId?: string;
	/** For objective_object: flavor string with {actor} substitution, fires on put_down match. */
	placementFlavor?: string;
	/** For objective_object: in-fiction sensory line rendered when held and the paired space is within the Daemon's interaction range (own cell plus the eight adjacent cells).
	 *  For interesting_object: sensory line rendered when the unheld item is within interaction range (before pickup).
	 *  For objective_space: sensory line rendered when the space is inside the Daemon's Vista but outside interaction range (the four cells two cardinal steps away; suppressed by auto-examine when close).
	 *  Proximity has its own channel: ordinary descriptions, on-space flavor, and completion flavor stay distinct from it. */
	proximityFlavor?: string;
	/** For obstacle: 1-sentence sensory line a witness Daemon perceives when the obstacle moves one cell. Third person from witness POV. Does NOT contain {actor}. */
	shiftFlavor?: string;
	/** For objective_space used as a Convergence target: tier-1 witness flavor (exactly one Daemon on space). Third-person witness POV. Does NOT contain {actor}. */
	convergenceTier1Flavor?: string;
	/** For objective_space used as a Convergence target: tier-2 witness flavor (two or more Daemons share space). Third-person witness POV. Does NOT contain {actor}. */
	convergenceTier2Flavor?: string;
	/** For objective_space: first-person actor flavor delivered to the Daemon standing alone on the space at Tier 1. Does NOT contain {actor}. */
	convergenceTier1ActorFlavor?: string;
	/** For objective_space: first-person actor flavor delivered to every Daemon standing on the space when Tier 2 fires. Does NOT contain {actor}. */
	convergenceTier2ActorFlavor?: string;
	/** AiId when held by an AI; GridPosition when resting on a cell. */
	holder: AiId | GridPosition;
	/** Tracks whether this entity has been "used" for a UseItem objective. Defaults to "pending" when omitted. */
	satisfactionState?: "pending" | "satisfied";
	/** Alternate examineDescription shown after satisfactionState flips to "satisfied". */
	postExamineDescription?: string;
	/** Alternate look flavor shown after satisfactionState flips to "satisfied". */
	postLookFlavor?: string;
	/**
	 * 1-sentence world-meaningful flavor returned to the actor (and to witnesses)
	 * as their `use` tool result on the call that satisfies a `UseSpaceObjective`
	 * (when entity.kind === "objective_space") or a `UseItemObjective` (when
	 * entity.kind === "interesting_object"). Does NOT contain "{actor}" —
	 * third-person, world-meaningful description of the activation event.
	 *
	 * For objective_space (#335): use on a space only ever fires on the satisfying
	 * call (post-satisfaction `useAvailable` is false), so this is the actor's
	 * moment-of-satisfaction line.
	 *
	 * For interesting_object (#334): pre-satisfaction use that flips the objective
	 * pending → satisfied fires this flavor; subsequent (post-satisfaction) `use`
	 * calls return `useOutcome` instead.
	 */
	activationFlavor?: string;
	/** For objective_space: whether the `use` action is available on this space. Defaults to true when omitted. Set to false after a UseSpaceObjective is satisfied. */
	useAvailable?: boolean;
	/** For objective_space: flavor string emitted as a Witnessed event when a UseSpaceObjective is satisfied. */
	satisfactionFlavor?: string;
}

export interface WorldState {
	entities: WorldEntity[];
}

/** A matched pair of (objective_object, objective_space). */
export interface ObjectivePair {
	object: WorldEntity;
	space: WorldEntity;
}

/** Setting-flavored content pack: names, descriptions, outcomes, and placed entities for one game. */
export interface ContentPack {
	setting: string;
	weather: string;
	timeOfDay: string;
	/**
	 * Flat array of all authored/placed entities in this pack — carry objects,
	 * carry spaces (objective_object's `pairsWithSpaceId` references them),
	 * bound objective_spaces (use_space / convergence targets, NOT referenced
	 * by any object's `pairsWithSpaceId`), interesting_objects, and obstacles.
	 *
	 * Bucketing is derived on demand via `pack-selectors.ts` (`carryPairs`,
	 * `interestingObjects`, `boundSpaces`, `obstacles`, `objectiveSpaces`).
	 */
	entities: WorldEntity[];
	aiStarts: Record<AiId, PersonaSpatialState>;
	/**
	 * Setting-flavored 2-4 word name for the impassable grid edge
	 * (e.g. "subway tunnel wall", "salt-encrusted edge", "laboratory bulkhead").
	 * Rendered in `<what_you_see>` and `<whats_new>` when an out-of-bounds cell
	 * falls inside the Daemon's Vista. Paired across Pack A / Pack B for
	 * Setting Shift.
	 */
	wallName: string;
}

export interface CarryObjective {
	id: string;
	kind: "carry";
	description: string;
	satisfactionState: "pending" | "satisfied";
	objectId: string;
	spaceId: string;
}

export interface UseItemObjective {
	id: string;
	kind: "use_item";
	description: string;
	satisfactionState: "pending" | "satisfied";
	itemId: string;
}

export interface UseSpaceObjective {
	id: string;
	kind: "use_space";
	description: string;
	satisfactionState: "pending" | "satisfied";
	spaceId: string;
}

export interface ConvergenceObjective {
	id: string;
	kind: "convergence";
	description: string;
	satisfactionState: "pending" | "satisfied";
	/** The id of the objective_space that acts as the convergence point. */
	spaceId: string;
}

export type Objective =
	| CarryObjective
	| UseItemObjective
	| UseSpaceObjective
	| ConvergenceObjective;

// ── Complication types ────────────────────────────────────────────────────────

/**
 * Persistent active complications stored on PhaseState.
 * Transient complications (weather_change, obstacle_shift, setting_shift)
 * mutate world/setting state and are not tracked here.
 */
export type ActiveComplication =
	| {
			kind: "sysadmin_directive";
			target: AiId;
			directive: string;
			resolveAtRound: number;
	  }
	| {
			kind: "tool_disable";
			target: AiId;
			tool: ToolName;
			resolveAtRound: number;
	  }
	| { kind: "chat_lockout"; target: AiId; resolveAtRound: number };

/** Countdown + phase-level flags for the complication schedule. */
export interface ComplicationSchedule {
	countdown: number;
	settingShiftFired: boolean;
}

/**
 * The draw payload returned from the complication engine — one variant per
 * ComplicationKind. Carries only the data needed to dispatch the complication.
 */
export type ComplicationVariant =
	| { kind: "weather_change"; weather: string }
	| { kind: "sysadmin_directive"; target: AiId; duration: number }
	| { kind: "tool_disable"; target: AiId; tool: ToolName; duration: number }
	| {
			kind: "obstacle_shift";
			obstacleId: string;
			fromCell: GridPosition;
			toCell: GridPosition;
	  }
	| { kind: "chat_lockout"; target: AiId; duration: number }
	| { kind: "setting_shift" };

/** Returned by tickComplication when a complication fires. */
export interface ComplicationResult {
	fired: ComplicationVariant;
}

/**
 * A Daemon's spatial state: a position, and nothing else. Daemons have no
 * orientation and no turning (ADR 0015), so no orientation is stored here.
 */
export interface PersonaSpatialState {
	position: GridPosition;
}

export type RoundActionRecord = {
	round: number;
	actor: AiId;
	description: string;
	kind: "tool_success" | "tool_failure" | "message" | "pass" | "lockout";
};

/**
 * A physical action that was observable by other AIs (via Vista membership of
 * the actor's cell). Computed by the dispatcher at write time and consumed once
 * to fan out witnessed-event entries into per-Daemon conversationLogs; no longer
 * stored on PhaseState. Covers exactly the observable action tools: go, pick_up,
 * put_down, use.
 */
export interface PhysicalActionRecord {
	round: number;
	actor: AiId;
	/** The actor's cell at the time the action resolved (post-move for "go"). */
	actorCellAtAction: GridPosition;
	/** The observable action kind. */
	kind: "go" | "pick_up" | "put_down" | "use";
	/** Item id (for pick_up, put_down, use). */
	item?: string;
	/**
	 * Raw useOutcome string with {actor} token un-substituted (for use).
	 * Witnesses render this with {actor}→"*<actor>"; actor sees {actor}→"you".
	 */
	useOutcome?: string;
	/**
	 * Raw placementFlavor string with {actor} token un-substituted (for put_down that
	 * triggers a pair match). Witnesses render this with {actor}→"*<actor>".
	 */
	placementFlavorRaw?: string;
	/** Cardinal direction of the step (for go). */
	direction?: CardinalDirection;
	/**
	 * Snapshot of every other AI's spatial state at the moment this action resolved.
	 * Used to determine Vista membership for witnesses without re-walking history.
	 */
	witnessSpatial: Record<AiId, PersonaSpatialState>;
}

/**
 * A single tagged item inside a Daemon's conversation log.
 *
 * Discriminated union of seven kinds — each carrying a `round` and the smallest
 * payload needed to render its line in the system prompt. This is the per-Daemon
 * storage shape *and* the prompt-rendered shape (per CONTEXT.md's `Conversation log`
 * glossary entry). The `kind` tag is chosen so a player editing a `*xxxx.txt` file in
 * devtools can tell entry kinds apart at a glance.
 *
 * - `message`: a directional message from `from: AiId | "blue" | "sysadmin"` to `to: AiId | "blue"`.
 *   Both sender's and recipient's per-Daemon logs receive the same entry. `"sysadmin"` is a
 *   special sender for privately-delivered system directives (not a real Daemon — has no log slot).
 * - `witnessed-event`: projects the render-relevant subset of PhysicalActionRecord for an action
 *   this Daemon observed inside its Vista. The snapshot fields (`actorCellAtAction`,
 *   `witnessSpatial`) are omitted — Vista membership is resolved at write-time (ADR 0006), not
 *   re-evaluated at read-time.
 * - `action-failure`: actor-only; persists across rounds; written by the dispatcher when an
 *   in-scope action tool is rejected. Surfaces the rejection reason directly to the actor so
 *   Daemons do not repeat the same failed action (e.g. walking into a wall) indefinitely.
 * - `broadcast`: sender-less system announcement appended to ALL three Daemon logs at once
 *   (e.g. a weather change complication). Has no `from` / `to` fields.
 * - `tool-call`: the actor's own tool call plus its result, re-injected into the next round's
 *   messages array per the OpenAI tool-use protocol. Carries an optional `diskDelta` capturing
 *   new perception revealed by a `go`.
 * - `witnessed-obstacle-shift`: fanned out to Daemons whose Vista contained the obstacle's origin
 *   cell when an obstacle_shift complication fired; carries the obstacle's `shiftFlavor`.
 * - `witnessed-convergence`: the tiered flavor line for a Convergence Objective space; `audience`
 *   distinguishes the actor (standing on the space) from a witness (whose Vista contained it).
 */
export type ConversationEntry =
	| {
			kind: "message";
			round: number;
			from: AiId | "blue" | "sysadmin";
			to: AiId | "blue";
			content: string;
			/** Tool call ID when this message was sent via the message tool. */
			toolCallId?: string;
			/** JSON-encoded tool arguments when this message was sent via the message tool. */
			toolArgumentsJson?: string;
	  }
	| {
			kind: "witnessed-event";
			round: number;
			actor: AiId;
			actionKind: "go" | "pick_up" | "put_down" | "use";
			item?: string;
			direction?: CardinalDirection;
			useOutcome?: string;
			placementFlavorRaw?: string;
	  }
	| {
			kind: "action-failure";
			round: number;
			/** The attempted tool. See `ActionFailureTool`. */
			tool: ActionFailureTool;
			/** Verbatim dispatcher rejection reason (e.g. "That cell is blocked by an obstacle"). */
			reason: string;
	  }
	| {
			kind: "broadcast";
			round: number;
			content: string;
	  }
	| {
			kind: "tool-call";
			round: number;
			/** The AI that made the tool call. */
			aiId: AiId;
			/** Tool call ID for rendering as assistant tool_calls. */
			toolCallId: string;
			/** JSON-encoded tool arguments for rendering as assistant tool_calls. */
			toolArgumentsJson: string;
			/** The name of the tool that was called. */
			toolName: string;
			/** The tool result description. */
			result: string;
			/** Whether the tool call succeeded. */
			success: boolean;
			/**
			 * For go actions that reveal new content in the actor's Vista,
			 * this field carries the renderWhatsNew output captured at write-time.
			 * Used to enrich future-round prompts with the persisted perception.
			 * Undefined for other tools, failed actions, or when the delta is empty.
			 * (Issue #376: persist the perception delta on go tool-call log
			 * entries; the field was renamed to `diskDelta` in #539. That
			 * rename is a persisted save-format break, and this branch carries
			 * it: the same branch activates session v12 and USB v5, so
			 * pre-rename saves surface as version-mismatch rather than loading
			 * with the field silently absent.)
			 */
			diskDelta?: string;
	  }
	| {
			kind: "witnessed-obstacle-shift";
			round: number;
			obstacleId: string;
			fromCell: GridPosition;
			toCell: GridPosition;
			flavor: string;
	  }
	| {
			kind: "witnessed-convergence";
			round: number;
			spaceId: string;
			tier: 1 | 2;
			flavor: string;
			/**
			 * "actor" — receiver was standing on the space; flavor is the first-person actor line.
			 * "witness" — the space was inside the receiver's Vista but they were NOT on it; flavor is the third-person witness line.
			 * Optional for backward-compat with saves written before #336 (treat as "witness").
			 */
			audience?: "actor" | "witness";
	  };

export interface AiBudget {
	remaining: number;
	total: number;
}

export interface GameState {
	personas: Record<AiId, AiPersona>;
	/** Single content pack for the game (active pack — switches on Setting Shift). */
	contentPack: ContentPack;
	isComplete: boolean;
	outcome?: "win" | "lose";
	/** Setting noun for this game (e.g. "abandoned subway station"). */
	setting: string;
	weather: string;
	timeOfDay: string;
	round: number;
	world: WorldState;
	budgets: Record<AiId, AiBudget>;
	/** Per-Daemon conversation log (storage + prompt-rendered shape). */
	conversationLogs: Record<AiId, ConversationEntry[]>;
	/** Budget-exhaustion lockout: prevents the AI from acting at all. */
	lockedOut: Set<AiId>;
	/** Per-AI spatial state (position only). */
	personaSpatial: Record<AiId, PersonaSpatialState>;
	/** Complication countdown + once-per-game flags (e.g. settingShiftFired). */
	complicationSchedule: ComplicationSchedule;
	/** Currently active persistent complications (Sysadmin Directives, Tool Disables, Chat Lockouts). */
	activeComplications: ActiveComplication[];
	/** Setting A content packs — single-element array, generated at game start. */
	contentPacksA: ContentPack[];
	/** Setting B content packs — single-element array, same entity IDs as A, different names/descriptions. */
	contentPacksB: ContentPack[];
	/** Which setting is currently active. Starts as "A"; swapped to "B" by Setting Shift. */
	activePackId: "A" | "B";
	/** Active objectives for this game session. Drawn at game start from the content pack pool. */
	objectives: Objective[];
}

/**
 * The Daemon tool set (ADR 0015): the five tools a Daemon can call. There is
 * no `face` — Daemons have positions but no orientation and no turning, and
 * `go` takes a named cardinal direction.
 */
export type ToolName = "pick_up" | "put_down" | "use" | "go" | "message";

/**
 * Tool name recorded on a persisted `action-failure` entry: the live tool set,
 * and nothing wider. The dispatcher writes this field from `ToolCall.name`, and
 * the only caller that could carry a retired name — a raw tool call from the
 * model — is rejected by `parseToolCallArguments` before any `ToolCall` exists.
 */
export type ActionFailureTool = ToolName;

export interface ToolCall {
	name: ToolName;
	args: Record<string, string>;
}

export interface AiTurnAction {
	aiId: AiId;
	messages?: Array<{
		to: AiId | "blue";
		content: string;
		toolCallId?: string;
		toolArgumentsJson?: string;
	}>;
	toolCall?: ToolCall;
	pass?: boolean;
}

/**
 * Captures the tool-call / result pair from a single AI turn, used to
 * re-inject the assistant's tool_calls message + the tool result message
 * into the next round's messages array (per OpenAI tool-use protocol).
 */
export interface ToolRoundtripMessage {
	assistantToolCalls: Array<{
		id: string;
		name: string;
		argumentsJson: string;
	}>;
	toolResults: Array<{
		tool_call_id: string;
		success: boolean;
		description: string;
		reason?: string;
	}>;
}

export interface RoundResult {
	round: number;
	actions: RoundActionRecord[];
	phaseEnded: boolean;
	gameEnded: boolean;
	/**
	 * Set when a chat lockout was triggered this round.
	 * Contains the AI that was locked out and the in-character message to show.
	 */
	chatLockoutTriggered?: { aiId: AiId; message: string };
	/**
	 * List of AI ids whose chat lockouts resolved (expired) at the end of this
	 * round. Empty / undefined when nothing resolved.
	 */
	chatLockoutsResolved?: AiId[];
}
