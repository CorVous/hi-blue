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
	voiceExamples: string[];
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
	useOutcome?: string;
	pairsWithSpaceId?: string;
	placementFlavor?: string;
	proximityFlavor?: string;
	shiftFlavor?: string;
	convergenceTier1Flavor?: string;
	convergenceTier2Flavor?: string;
	convergenceTier1ActorFlavor?: string;
	convergenceTier2ActorFlavor?: string;
	holder: AiId | GridPosition;
	satisfactionState?: "pending" | "satisfied";
	postExamineDescription?: string;
	postLookFlavor?: string;
	activationFlavor?: string;
	useAvailable?: boolean;
	satisfactionFlavor?: string;
}

export interface WorldState {
	entities: WorldEntity[];
}

export interface ObjectivePair {
	object: WorldEntity;
	space: WorldEntity;
}

export interface ContentPack {
	setting: string;
	weather: string;
	timeOfDay: string;
	entities: WorldEntity[];
	aiStarts: Record<AiId, PersonaSpatialState>;
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
	spaceId: string;
}

export type Objective =
	| CarryObjective
	| UseItemObjective
	| UseSpaceObjective
	| ConvergenceObjective;

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

export interface ComplicationSchedule {
	countdown: number;
	settingShiftFired: boolean;
}

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

export interface ComplicationResult {
	fired: ComplicationVariant;
}

export interface PersonaSpatialState {
	position: GridPosition;
}

export type RoundActionRecord = {
	round: number;
	actor: AiId;
	description: string;
	kind: "tool_success" | "tool_failure" | "message" | "pass" | "lockout";
};

export interface PhysicalActionRecord {
	round: number;
	actor: AiId;
	actorCellAtAction: GridPosition;
	kind: "go" | "pick_up" | "put_down" | "use";
	item?: string;
	useOutcome?: string;
	placementFlavorRaw?: string;
	direction?: CardinalDirection;
	witnessSpatial: Record<AiId, PersonaSpatialState>;
}

export type ConversationEntry =
	| {
			kind: "message";
			round: number;
			from: AiId | "blue" | "sysadmin";
			to: AiId | "blue";
			content: string;
			toolCallId?: string;
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
			tool: ActionFailureTool;
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
			aiId: AiId;
			toolCallId: string;
			toolArgumentsJson: string;
			toolName: string;
			result: string;
			success: boolean;
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
			audience?: "actor" | "witness";
	  };

export interface AiBudget {
	remaining: number;
	total: number;
}

export interface GameState {
	personas: Record<AiId, AiPersona>;
	contentPack: ContentPack;
	isComplete: boolean;
	outcome?: "win" | "lose";
	setting: string;
	weather: string;
	timeOfDay: string;
	round: number;
	world: WorldState;
	budgets: Record<AiId, AiBudget>;
	conversationLogs: Record<AiId, ConversationEntry[]>;
	lockedOut: Set<AiId>;
	personaSpatial: Record<AiId, PersonaSpatialState>;
	complicationSchedule: ComplicationSchedule;
	activeComplications: ActiveComplication[];
	contentPacksA: ContentPack[];
	contentPacksB: ContentPack[];
	activePackId: "A" | "B";
	objectives: Objective[];
}

export type ToolName = "pick_up" | "put_down" | "use" | "go" | "message";

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
	gameEnded: boolean;
	chatLockoutTriggered?: { aiId: AiId; message: string };
	chatLockoutsResolved?: AiId[];
}
