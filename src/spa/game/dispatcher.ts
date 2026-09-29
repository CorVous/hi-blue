import {
	disabledToolsFor,
	entityHandle,
	type ItemToolName,
	obstaclePositions,
	pairedSpaceHoldingItem,
	pickableEntities,
	resolveToolTarget,
	withinInteractionRange,
} from "./available-tools.js";
import {
	applyDirection,
	CARDINAL_DIRECTIONS,
	type CardinalDirection,
	inBounds,
	isGridPosition,
	positionsEqual,
} from "./direction.js";
import {
	appendLogEntry,
	appendMessage,
	deductBudget,
	isDaemonExhausted,
	personaName,
} from "./engine";
import { carryObjectById } from "./pack-selectors.js";
import {
	buildAiContext,
	buildDiskSnapshot,
	renderWhatsNew,
} from "./prompt-builder.js";
import type {
	AiId,
	AiTurnAction,
	ConversationEntry,
	GameState,
	GridPosition,
	Objective,
	RoundActionRecord,
	ToolCall,
	WorldEntity,
} from "./types";
import { vistaContains } from "./vista-projector.js";
import {
	checkPlacementFlavor,
	checkUseItemActivation,
} from "./win-condition.js";

export interface ValidationResult {
	valid: boolean;
	reason?: string;
}

export interface DispatchResult {
	rejected: boolean;
	reason?: string;
	game: GameState;
	records: RoundActionRecord[];
	actorPrivateToolResult?: { description: string; success: boolean };
	actorDiskDelta?: string;
	justExhausted: boolean;
}

const DROP_CELL_WITHOUT_SPATIAL_STATE: GridPosition = { row: 0, col: 0 };

function isItemTool(name: ToolCall["name"]): name is ItemToolName {
	return name === "pick_up" || name === "put_down" || name === "use";
}

export function resolveToolCall(
	game: GameState,
	aiId: AiId,
	call: ToolCall,
): ToolCall {
	const handle = call.args.item;
	if (!isItemTool(call.name) || handle === undefined) return call;
	const target = resolveToolTarget(game, aiId, call.name, handle);
	if (!target || target.id === handle) return call;
	return { ...call, args: { ...call.args, item: target.id } };
}

function invalid(reason: string): ValidationResult {
	return { valid: false, reason };
}

function disabledToolReason(tool: ToolCall["name"]): string {
	return `your ${tool} tool is disabled`;
}

function targetLabel(game: GameState, id: string | undefined): string {
	const entity = game.world.entities.find((e) => e.id === id);
	return entity ? entityHandle(game.world.entities, entity) : (id ?? "");
}

export function validateToolCall(
	game: GameState,
	aiId: AiId,
	rawCall: ToolCall,
): ValidationResult {
	return validateResolvedToolCall(
		game,
		aiId,
		resolveToolCall(game, aiId, rawCall),
	);
}

function validateResolvedToolCall(
	game: GameState,
	aiId: AiId,
	call: ToolCall,
): ValidationResult {
	if (disabledToolsFor(game.activeComplications, aiId).has(call.name))
		return invalid(disabledToolReason(call.name));
	const label = targetLabel(game, call.args.item);
	const { world } = game;
	const actorSpatial = game.personaSpatial[aiId];
	const pickable = pickableEntities(world.entities);
	const obstacles = obstaclePositions(world.entities);

	switch (call.name) {
		case "pick_up": {
			const item = pickable.find((i) => i.id === call.args.item);
			if (!item) return invalid(`Item "${label}" does not exist`);
			if (!isGridPosition(item.holder))
				return invalid(`Item "${label}" is not on the ground`);
			if (!actorSpatial) return invalid("Actor has no spatial state");
			if (!withinInteractionRange(actorSpatial.position, item.holder))
				return invalid(
					`Item "${label}" is out of reach — you can only pick up items in your own cell or the eight cells around it`,
				);
			const holdingSpace = pairedSpaceHoldingItem(item, world.entities);
			if (holdingSpace)
				return invalid(
					`"${label}" is set into the ${entityHandle(world.entities, holdingSpace)} and will not come loose`,
				);
			return { valid: true };
		}

		case "put_down": {
			const item = pickable.find((i) => i.id === call.args.item);
			if (!item) return invalid(`Item "${label}" does not exist`);
			if (item.holder !== aiId)
				return invalid(`You are not holding "${label}"`);
			return { valid: true };
		}

		case "use": {
			const spaceTarget = world.entities.find(
				(e) => e.id === call.args.item && e.kind === "objective_space",
			);
			if (spaceTarget) {
				if (spaceTarget.useAvailable === false)
					return invalid(`"${label}" has already been used`);
				if (!isGridPosition(spaceTarget.holder))
					return invalid(`Space "${label}" is not on the grid`);
				if (!actorSpatial) return invalid("Actor has no spatial state");
				if (!withinInteractionRange(actorSpatial.position, spaceTarget.holder))
					return invalid(
						`Space "${label}" is out of reach — you can only use a space in your own cell or the eight cells around it`,
					);
				return { valid: true };
			}

			const item = pickable.find((i) => i.id === call.args.item);
			if (!item) return invalid(`Item "${label}" does not exist`);
			if (item.holder !== aiId) {
				if (isGridPosition(item.holder) && actorSpatial) {
					const holdingSpace = pairedSpaceHoldingItem(item, world.entities);
					if (holdingSpace) {
						return invalid(
							`"${label}" is set into the ${entityHandle(world.entities, holdingSpace)} and will not come loose`,
						);
					}
					if (withinInteractionRange(actorSpatial.position, item.holder)) {
						return invalid(
							`"${label}" is on the ground, not in your hands. Use pick_up first.`,
						);
					}
				}
				return invalid(`You are not holding "${label}"`);
			}
			return { valid: true };
		}

		case "go": {
			const rawDir = call.args.direction;
			if (!actorSpatial) return invalid("Actor has no spatial state");
			if (!CARDINAL_DIRECTIONS.includes(rawDir as CardinalDirection)) {
				return invalid(
					`"${rawDir}" is not a valid direction. Use a cardinal direction: north, south, east, or west.`,
				);
			}
			const direction = rawDir as CardinalDirection;
			const next = applyDirection(actorSpatial.position, direction);
			if (!inBounds(next)) return invalid("That direction is out of bounds");
			if (obstacles.some((o) => positionsEqual(o, next)))
				return invalid("That cell is blocked by an obstacle");
			return { valid: true };
		}

		default:
			return invalid(`Unknown tool "${call.name}"`);
	}
}

export function executeToolCall(
	game: GameState,
	aiId: AiId,
	rawCall: ToolCall,
): GameState {
	return executeResolvedToolCall(
		game,
		aiId,
		resolveToolCall(game, aiId, rawCall),
	);
}

function satisfyPendingObjective(
	game: GameState,
	entities: WorldEntity[],
	satisfiedEntity: WorldEntity,
	matches: (objective: Objective) => boolean,
): GameState | null {
	const pendingIdx = game.objectives.findIndex(
		(obj) => matches(obj) && obj.satisfactionState === "pending",
	);
	if (pendingIdx === -1) return null;
	satisfiedEntity.satisfactionState = "satisfied";
	return {
		...game,
		world: { ...game.world, entities },
		objectives: game.objectives.map((obj, idx) =>
			idx === pendingIdx
				? { ...obj, satisfactionState: "satisfied" as const }
				: obj,
		),
	};
}

function executeResolvedToolCall(
	game: GameState,
	aiId: AiId,
	call: ToolCall,
): GameState {
	const entities = game.world.entities.map((e) => ({ ...e }));
	const actorSpatial = game.personaSpatial[aiId];
	const pickable = pickableEntities(entities);

	const target = pickable.find((i) => i.id === call.args.item);
	switch (call.name) {
		case "pick_up":
			if (target) target.holder = aiId;
			break;
		case "put_down":
			if (target)
				target.holder = {
					...(actorSpatial?.position ?? DROP_CELL_WITHOUT_SPATIAL_STATE),
				};
			break;
		case "use": {
			const spaceTarget = entities.find(
				(e) => e.id === call.args.item && e.kind === "objective_space",
			);
			if (spaceTarget) {
				const satisfied = satisfyPendingObjective(
					game,
					entities,
					spaceTarget,
					(obj) => obj.kind === "use_space" && obj.spaceId === spaceTarget.id,
				);
				spaceTarget.useAvailable = false;
				if (satisfied) return satisfied;
				break;
			}

			if (target && actorSpatial && target.pairsWithSpaceId) {
				const pairedSpace = entities.find(
					(e) => e.id === target.pairsWithSpaceId,
				);
				if (
					pairedSpace &&
					isGridPosition(pairedSpace.holder) &&
					withinInteractionRange(actorSpatial.position, pairedSpace.holder)
				) {
					target.holder = { ...pairedSpace.holder };
				}
			}

			if (target) {
				const satisfied = satisfyPendingObjective(
					game,
					entities,
					target,
					(obj) => obj.kind === "use_item" && obj.itemId === target.id,
				);
				if (satisfied) return satisfied;
			}
			break;
		}
		case "go": {
			if (!actorSpatial) break;
			const direction = call.args.direction as CardinalDirection;
			const nextPos = applyDirection(actorSpatial.position, direction);
			return {
				...game,
				world: { ...game.world, entities },
				personaSpatial: {
					...game.personaSpatial,
					[aiId]: { position: nextPos },
				},
			};
		}
	}

	return { ...game, world: { ...game.world, entities } };
}

function describeToolCall(game: GameState, aiId: AiId, call: ToolCall): string {
	const name = personaName(game, aiId);
	const pickable = pickableEntities(game.world.entities);
	const label = targetLabel(game, call.args.item);

	switch (call.name) {
		case "pick_up":
			return `${name} picked up the ${label}`;
		case "put_down":
			return `${name} put down the ${label}`;
		case "use": {
			const spaceTarget = game.world.entities.find(
				(e) => e.id === call.args.item && e.kind === "objective_space",
			);
			if (spaceTarget) {
				if (spaceTarget.activationFlavor) return spaceTarget.activationFlavor;
				if (spaceTarget.useOutcome)
					return spaceTarget.useOutcome.replace(/\{actor\}/g, "you");
				return `${name} used the ${label}`;
			}
			const item = pickable.find((i) => i.id === call.args.item);
			if (item?.useOutcome) return item.useOutcome.replace(/\{actor\}/g, "you");
			return `${name} used the ${label}`;
		}
		case "go":
			return `${name} walks ${call.args.direction}.`;
		default:
			return `${name} attempted an unknown action`;
	}
}

function dispatchSpeechBeforeAction(
	game: GameState,
	aiId: AiId,
	messages: NonNullable<AiTurnAction["messages"]>,
	records: RoundActionRecord[],
): GameState {
	let state = game;
	const round = game.round;
	const actorName = personaName(game, aiId);
	const livePersonaIds = Object.keys(game.personaSpatial);
	const messageDisabled = disabledToolsFor(game.activeComplications, aiId).has(
		"message",
	);
	for (const msg of messages) {
		if (messageDisabled) {
			records.push({
				round,
				actor: aiId,
				kind: "tool_failure",
				description: `${actorName} tried to message "${msg.to}" but failed: ${disabledToolReason("message")}`,
			});
			continue;
		}
		const validRecipient =
			msg.to === "blue" || (livePersonaIds.includes(msg.to) && msg.to !== aiId);
		if (!validRecipient) {
			records.push({
				round,
				actor: aiId,
				kind: "tool_failure",
				description: `${actorName} tried to message "${msg.to}" but failed: unknown or invalid recipient`,
			});
		} else {
			state = appendMessage(state, aiId, msg.to, msg.content, {
				...(msg.toolCallId !== undefined && { toolCallId: msg.toolCallId }),
				...(msg.toolArgumentsJson !== undefined && {
					toolArgumentsJson: msg.toolArgumentsJson,
				}),
			});
			records.push({
				round,
				actor: aiId,
				kind: "message",
				description: `${actorName} messaged ${msg.to}`,
			});
		}
	}
	return state;
}

type WitnessedEventEntry = Extract<
	ConversationEntry,
	{ kind: "witnessed-event" }
>;

function withDefined<K extends string>(
	key: K,
	value: string | undefined,
): Partial<Record<K, string>> {
	return value !== undefined ? ({ [key]: value } as Record<K, string>) : {};
}

function witnessedUseOutcome(
	game: GameState,
	call: ToolCall,
	activationFlavor: string | null,
): string | undefined {
	if (call.name !== "use") return undefined;
	const spaceTarget = game.world.entities.find(
		(e) => e.id === call.args.item && e.kind === "objective_space",
	);
	if (spaceTarget) return spaceTarget.satisfactionFlavor;
	if (activationFlavor !== null) return activationFlavor;
	return pickableEntities(game.world.entities).find(
		(i) => i.id === call.args.item,
	)?.useOutcome;
}

function witnessedPlacementFlavor(
	game: GameState,
	call: ToolCall,
	pairPlacementFlavor: string | null,
): string | undefined {
	if (call.name !== "put_down" && call.name !== "use") return undefined;
	if (call.args.item === undefined || !pairPlacementFlavor) return undefined;
	return (
		carryObjectById(call.args.item, game.contentPack)?.placementFlavor ||
		undefined
	);
}

function isObservableAction(
	name: ToolCall["name"],
): name is WitnessedEventEntry["actionKind"] {
	return (
		name === "go" || name === "pick_up" || name === "put_down" || name === "use"
	);
}

export function dispatchAiTurn(
	game: GameState,
	action: AiTurnAction,
	options?: { costUsd?: number },
): DispatchResult {
	const { aiId } = action;

	if (isDaemonExhausted(game, aiId)) {
		return {
			rejected: true,
			reason: `${aiId} has exhausted its budget`,
			game,
			records: [],
			justExhausted: false,
		};
	}

	let state = game;
	const round = state.round;
	const records: RoundActionRecord[] = [];

	let actorPrivateToolResult:
		| { description: string; success: boolean }
		| undefined;

	let actorDiskDelta: string | undefined;

	if (action.messages) {
		state = dispatchSpeechBeforeAction(state, aiId, action.messages, records);
	}

	if (action.toolCall) {
		const toolCall = resolveToolCall(state, aiId, action.toolCall);
		const resolvedAction: AiTurnAction = { ...action, toolCall };
		const validation = validateResolvedToolCall(state, aiId, toolCall);

		if (validation.valid) {
			const preExecuteWorld = state.world;

			if (toolCall.name === "go") {
				const prevCtx = buildAiContext(state, aiId);
				const prevSnap = buildDiskSnapshot(prevCtx);
				state = executeResolvedToolCall(state, aiId, toolCall);
				const currCtx = buildAiContext(state, aiId);
				const currSnap = buildDiskSnapshot(currCtx);
				const delta = renderWhatsNew(prevSnap, currSnap);
				if (delta !== null) {
					actorDiskDelta = delta;
				}
			} else {
				state = executeResolvedToolCall(state, aiId, toolCall);
			}

			const pairPlacementFlavor =
				toolCall.name === "put_down" || toolCall.name === "use"
					? checkPlacementFlavor(resolvedAction, state.world)
					: null;
			const activationFlavor =
				toolCall.name === "use"
					? checkUseItemActivation(resolvedAction, preExecuteWorld, state.world)
					: null;
			const successDescription =
				activationFlavor ??
				pairPlacementFlavor ??
				describeToolCall(state, aiId, toolCall);
			records.push({
				round,
				actor: aiId,
				kind: "tool_success",
				description: successDescription,
			});

			if (toolCall.name === "pick_up") {
				const picked = state.world.entities.find(
					(e) => e.id === toolCall.args.item,
				);
				if (picked?.examineDescription) {
					actorPrivateToolResult = {
						description: `${successDescription} ${picked.examineDescription}`,
						success: true,
					};
				}
			}

			const actorSpatialPost = state.personaSpatial[aiId];
			if (isObservableAction(toolCall.name) && actorSpatialPost) {
				const witnessEntry: WitnessedEventEntry = {
					kind: "witnessed-event",
					round,
					actor: aiId,
					actionKind: toolCall.name,
					...(toolCall.args.item !== undefined && { item: toolCall.args.item }),
					...(toolCall.name === "go" && {
						direction: toolCall.args.direction as CardinalDirection,
					}),
					...withDefined(
						"useOutcome",
						witnessedUseOutcome(state, toolCall, activationFlavor),
					),
					...withDefined(
						"placementFlavorRaw",
						witnessedPlacementFlavor(state, toolCall, pairPlacementFlavor),
					),
				};
				for (const [witnessId, witnessSpatial] of Object.entries(
					state.personaSpatial,
				)) {
					if (witnessId === aiId) continue;
					if (
						!vistaContains(witnessSpatial.position, actorSpatialPost.position)
					)
						continue;
					state = appendLogEntry(state, witnessId, witnessEntry);
				}
			}
		} else {
			records.push({
				round,
				actor: aiId,
				kind: "tool_failure",
				description: `${personaName(game, aiId)} tried to ${action.toolCall.name} ${action.toolCall.args.item ?? action.toolCall.args.direction ?? ""} but failed: ${validation.reason}`,
			});
			state = appendLogEntry(state, aiId, {
				kind: "action-failure",
				round,
				tool: action.toolCall.name,
				reason: validation.reason ?? "rejected",
			});
		}
	}

	if (
		action.pass &&
		!action.toolCall &&
		(action.messages === undefined || action.messages.length === 0)
	) {
		records.push({
			round,
			actor: aiId,
			kind: "pass",
			description: `${personaName(game, aiId)} passed`,
		});
	}

	const deductResult = deductBudget(state, aiId, options?.costUsd ?? 0);
	state = deductResult.game;

	return {
		rejected: false,
		game: state,
		records,
		justExhausted: deductResult.justExhausted,
		...(actorPrivateToolResult !== undefined ? { actorPrivateToolResult } : {}),
		...(actorDiskDelta !== undefined ? { actorDiskDelta } : {}),
	};
}
