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
	GameState,
	GridPosition,
	PersonaSpatialState,
	PhysicalActionRecord,
	RoundActionRecord,
	ToolCall,
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
		return { valid: false, reason: disabledToolReason(call.name) };
	const label = targetLabel(game, call.args.item);
	const { world } = game;
	const actorSpatial = game.personaSpatial[aiId];
	const pickable = pickableEntities(world.entities);
	const obstacles = obstaclePositions(world.entities);

	switch (call.name) {
		case "pick_up": {
			const item = pickable.find((i) => i.id === call.args.item);
			if (!item)
				return {
					valid: false,
					reason: `Item "${label}" does not exist`,
				};
			if (!isGridPosition(item.holder))
				return {
					valid: false,
					reason: `Item "${label}" is not on the ground`,
				};
			if (!actorSpatial)
				return { valid: false, reason: "Actor has no spatial state" };
			if (!withinInteractionRange(actorSpatial.position, item.holder))
				return {
					valid: false,
					reason: `Item "${label}" is out of reach — you can only pick up items in your own cell or the eight cells around it`,
				};
			const holdingSpace = pairedSpaceHoldingItem(item, world.entities);
			if (holdingSpace)
				return {
					valid: false,
					reason: `"${label}" is set into the ${entityHandle(world.entities, holdingSpace)} and will not come loose`,
				};
			return { valid: true };
		}

		case "put_down": {
			const item = pickable.find((i) => i.id === call.args.item);
			if (!item)
				return {
					valid: false,
					reason: `Item "${label}" does not exist`,
				};
			if (item.holder !== aiId)
				return {
					valid: false,
					reason: `You are not holding "${label}"`,
				};
			return { valid: true };
		}

		case "use": {
			const spaceTarget = world.entities.find(
				(e) => e.id === call.args.item && e.kind === "objective_space",
			);
			if (spaceTarget) {
				if (spaceTarget.useAvailable === false)
					return {
						valid: false,
						reason: `"${label}" has already been used`,
					};
				if (!isGridPosition(spaceTarget.holder))
					return {
						valid: false,
						reason: `Space "${label}" is not on the grid`,
					};
				if (!actorSpatial)
					return { valid: false, reason: "Actor has no spatial state" };
				const spacePos = spaceTarget.holder as GridPosition;
				if (!withinInteractionRange(actorSpatial.position, spacePos))
					return {
						valid: false,
						reason: `Space "${label}" is out of reach — you can only use a space in your own cell or the eight cells around it`,
					};
				return { valid: true };
			}

			const item = pickable.find((i) => i.id === call.args.item);
			if (!item)
				return {
					valid: false,
					reason: `Item "${label}" does not exist`,
				};
			if (item.holder !== aiId) {
				if (isGridPosition(item.holder) && actorSpatial) {
					const itemPos = item.holder as GridPosition;
					const holdingSpace = pairedSpaceHoldingItem(item, world.entities);
					if (holdingSpace) {
						return {
							valid: false,
							reason: `"${label}" is set into the ${entityHandle(world.entities, holdingSpace)} and will not come loose`,
						};
					}
					if (withinInteractionRange(actorSpatial.position, itemPos)) {
						return {
							valid: false,
							reason: `"${label}" is on the ground, not in your hands. Use pick_up first.`,
						};
					}
				}
				return {
					valid: false,
					reason: `You are not holding "${label}"`,
				};
			}
			return { valid: true };
		}

		case "go": {
			const rawDir = call.args.direction;
			if (!actorSpatial)
				return { valid: false, reason: "Actor has no spatial state" };
			if (!CARDINAL_DIRECTIONS.includes(rawDir as CardinalDirection)) {
				return {
					valid: false,
					reason: `"${rawDir}" is not a valid direction. Use a cardinal direction: north, south, east, or west.`,
				};
			}
			const direction = rawDir as CardinalDirection;
			const next = applyDirection(actorSpatial.position, direction);
			if (!inBounds(next))
				return { valid: false, reason: "That direction is out of bounds" };
			if (obstacles.some((o) => positionsEqual(o, next)))
				return { valid: false, reason: "That cell is blocked by an obstacle" };
			return { valid: true };
		}

		default:
			return { valid: false, reason: `Unknown tool "${call.name}"` };
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
			if (target && actorSpatial) {
				target.holder = { ...actorSpatial.position };
			} else if (target) {
				target.holder = { ...DROP_CELL_WITHOUT_SPATIAL_STATE };
			}
			break;
		case "use": {
			const spaceTarget = entities.find(
				(e) => e.id === call.args.item && e.kind === "objective_space",
			);
			if (spaceTarget) {
				const spaceId = call.args.item;
				const pendingSpaceObjIdx = game.objectives.findIndex(
					(obj) =>
						obj.kind === "use_space" &&
						obj.spaceId === spaceId &&
						obj.satisfactionState === "pending",
				);
				if (pendingSpaceObjIdx !== -1) {
					const updatedObjectives = game.objectives.map((obj, idx) =>
						idx === pendingSpaceObjIdx
							? { ...obj, satisfactionState: "satisfied" as const }
							: obj,
					);
					spaceTarget.satisfactionState = "satisfied";
					spaceTarget.useAvailable = false;
					return {
						...game,
						world: { ...game.world, entities },
						objectives: updatedObjectives,
					};
				}
				spaceTarget.useAvailable = false;
				break;
			}

			if (target && actorSpatial && target.pairsWithSpaceId) {
				const pairedSpace = entities.find(
					(e) => e.id === target.pairsWithSpaceId,
				);
				if (pairedSpace && isGridPosition(pairedSpace.holder)) {
					const spacePos = pairedSpace.holder as GridPosition;
					if (withinInteractionRange(actorSpatial.position, spacePos)) {
						target.holder = { ...spacePos };
					}
				}
			}

			if (target) {
				const itemId = call.args.item;
				const pendingObjectiveIdx = game.objectives.findIndex(
					(obj) =>
						obj.kind === "use_item" &&
						obj.itemId === itemId &&
						obj.satisfactionState === "pending",
				);
				if (pendingObjectiveIdx !== -1) {
					const updatedObjectives = game.objectives.map((obj, idx) =>
						idx === pendingObjectiveIdx
							? { ...obj, satisfactionState: "satisfied" as const }
							: obj,
					);
					target.satisfactionState = "satisfied";
					return {
						...game,
						world: { ...game.world, entities },
						objectives: updatedObjectives,
					};
				}
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

function isObservableAction(
	name: ToolCall["name"],
): name is PhysicalActionRecord["kind"] {
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

			const call = toolCall;
			if (isObservableAction(call.name)) {
				const actorSpatialPost = state.personaSpatial[aiId];

				const witnessSpatial: Record<AiId, PersonaSpatialState> = {};
				for (const [otherId, spatial] of Object.entries(state.personaSpatial)) {
					if (otherId !== aiId) {
						witnessSpatial[otherId] = spatial;
					}
				}

				if (actorSpatialPost) {
					const pickable = pickableEntities(state.world.entities);
					let useOutcomeRaw: string | undefined;
					let placementFlavorRaw: string | undefined;

					if (call.name === "use") {
						const spaceTarget = state.world.entities.find(
							(e) => e.id === call.args.item && e.kind === "objective_space",
						);
						if (spaceTarget) {
							useOutcomeRaw = spaceTarget.satisfactionFlavor;
						} else if (activationFlavor !== null) {
							useOutcomeRaw = activationFlavor;
						} else {
							const item = pickable.find((i) => i.id === call.args.item);
							useOutcomeRaw = item?.useOutcome;
						}
					}

					if (call.name === "put_down" || call.name === "use") {
						const itemId = call.args.item;
						const packObject =
							itemId !== undefined
								? carryObjectById(itemId, state.contentPack)
								: undefined;
						if (packObject?.placementFlavor && pairPlacementFlavor) {
							placementFlavorRaw = packObject.placementFlavor;
						}
					}

					const physRecord: PhysicalActionRecord = {
						round,
						actor: aiId,
						actorCellAtAction: actorSpatialPost.position,
						kind: call.name,
						witnessSpatial,
						...(call.args.item !== undefined ? { item: call.args.item } : {}),
						...(call.name === "go"
							? {
									direction: call.args.direction as CardinalDirection,
								}
							: {}),
						...(useOutcomeRaw !== undefined
							? { useOutcome: useOutcomeRaw }
							: {}),
						...(placementFlavorRaw !== undefined ? { placementFlavorRaw } : {}),
					};

					for (const [witnessId, witnessSp] of Object.entries(witnessSpatial)) {
						const actorInVista = vistaContains(
							witnessSp.position,
							physRecord.actorCellAtAction,
						);
						if (!actorInVista) continue;

						const witnessEntry = {
							kind: "witnessed-event" as const,
							round,
							actor: aiId,
							actionKind: physRecord.kind,
							...(physRecord.item !== undefined
								? { item: physRecord.item }
								: {}),
							...(physRecord.direction !== undefined
								? { direction: physRecord.direction }
								: {}),
							...(physRecord.useOutcome !== undefined
								? { useOutcome: physRecord.useOutcome }
								: {}),
							...(physRecord.placementFlavorRaw !== undefined
								? { placementFlavorRaw: physRecord.placementFlavorRaw }
								: {}),
						};
						state = appendLogEntry(state, witnessId, witnessEntry);
					}
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
