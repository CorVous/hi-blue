import { withinInteractionRange } from "./available-tools.js";
import {
	applyDirection,
	CARDINAL_DIRECTIONS,
	type CardinalDirection,
	inBounds,
	isGridPosition,
	positionsEqual,
} from "./direction.js";
import {
	appendActionFailure,
	appendMessage,
	appendWitnessedEvent,
	deductBudget,
	isAiLockedOut,
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
}

const DROP_CELL_WITHOUT_SPATIAL_STATE: GridPosition = { row: 0, col: 0 };

function pickableEntities(entities: WorldEntity[]): WorldEntity[] {
	return entities.filter(
		(e) => e.kind === "objective_object" || e.kind === "interesting_object",
	);
}

function obstaclePositions(entities: WorldEntity[]): GridPosition[] {
	return entities
		.filter((e) => e.kind === "obstacle")
		.map((e) => {
			const h = e.holder;
			return isGridPosition(h) ? h : null;
		})
		.filter((pos): pos is GridPosition => pos !== null);
}

export function validateToolCall(
	game: GameState,
	aiId: AiId,
	call: ToolCall,
): ValidationResult {
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
					reason: `Item "${call.args.item}" does not exist`,
				};
			if (!isGridPosition(item.holder))
				return {
					valid: false,
					reason: `Item "${call.args.item}" is not on the ground`,
				};
			if (!actorSpatial)
				return { valid: false, reason: "Actor has no spatial state" };
			if (!withinInteractionRange(actorSpatial.position, item.holder))
				return {
					valid: false,
					reason: `Item "${call.args.item}" is out of reach — you can only pick up items in your own cell or the eight cells around it`,
				};
			return { valid: true };
		}

		case "put_down": {
			const item = pickable.find((i) => i.id === call.args.item);
			if (!item)
				return {
					valid: false,
					reason: `Item "${call.args.item}" does not exist`,
				};
			if (item.holder !== aiId)
				return {
					valid: false,
					reason: `You are not holding "${call.args.item}"`,
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
						reason: `"${call.args.item}" has already been used`,
					};
				if (!isGridPosition(spaceTarget.holder))
					return {
						valid: false,
						reason: `Space "${call.args.item}" is not on the grid`,
					};
				if (!actorSpatial)
					return { valid: false, reason: "Actor has no spatial state" };
				const spacePos = spaceTarget.holder as GridPosition;
				if (!withinInteractionRange(actorSpatial.position, spacePos))
					return {
						valid: false,
						reason: `Space "${call.args.item}" is out of reach — you can only use a space in your own cell or the eight cells around it`,
					};
				return { valid: true };
			}

			const item = pickable.find((i) => i.id === call.args.item);
			if (!item)
				return {
					valid: false,
					reason: `Item "${call.args.item}" does not exist`,
				};
			if (item.holder !== aiId) {
				if (isGridPosition(item.holder) && actorSpatial) {
					const itemPos = item.holder as GridPosition;
					if (withinInteractionRange(actorSpatial.position, itemPos)) {
						return {
							valid: false,
							reason: `"${call.args.item}" is on the ground, not in your hands. Use pick_up first.`,
						};
					}
				}
				return {
					valid: false,
					reason: `You are not holding "${call.args.item}"`,
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
	const name = game.personas[aiId]?.name ?? aiId;
	const pickable = pickableEntities(game.world.entities);

	switch (call.name) {
		case "pick_up":
			return `${name} picked up the ${call.args.item}`;
		case "put_down":
			return `${name} put down the ${call.args.item}`;
		case "use": {
			const spaceTarget = game.world.entities.find(
				(e) => e.id === call.args.item && e.kind === "objective_space",
			);
			if (spaceTarget) {
				if (spaceTarget.activationFlavor) return spaceTarget.activationFlavor;
				if (spaceTarget.useOutcome)
					return spaceTarget.useOutcome.replace(/\{actor\}/g, "you");
				return `${name} used the ${call.args.item}`;
			}
			const item = pickable.find((i) => i.id === call.args.item);
			if (item?.useOutcome) return item.useOutcome.replace(/\{actor\}/g, "you");
			return `${name} used the ${call.args.item}`;
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
	const actorName = game.personas[aiId]?.name ?? aiId;
	const livePersonaIds = Object.keys(game.personaSpatial);
	for (const msg of messages) {
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

	if (isAiLockedOut(game, aiId)) {
		return {
			rejected: true,
			reason: `${aiId} is locked out (budget exhausted)`,
			game,
			records: [],
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
		const toolCall = action.toolCall;
		const validation = validateToolCall(state, aiId, toolCall);

		if (validation.valid) {
			const preExecuteWorld = state.world;

			if (action.toolCall.name === "go") {
				const prevCtx = buildAiContext(state, aiId);
				const prevSnap = buildDiskSnapshot(prevCtx);
				state = executeToolCall(state, aiId, action.toolCall);
				const currCtx = buildAiContext(state, aiId);
				const currSnap = buildDiskSnapshot(currCtx);
				const delta = renderWhatsNew(prevSnap, currSnap);
				if (delta !== null) {
					actorDiskDelta = delta;
				}
			} else {
				state = executeToolCall(state, aiId, action.toolCall);
			}

			const pairPlacementFlavor =
				action.toolCall.name === "put_down" || action.toolCall.name === "use"
					? checkPlacementFlavor(action, state.contentPack, state.world)
					: null;
			const activationFlavor =
				action.toolCall.name === "use"
					? checkUseItemActivation(action, preExecuteWorld, state.world)
					: null;
			const successDescription =
				activationFlavor ??
				pairPlacementFlavor ??
				describeToolCall(state, aiId, action.toolCall);
			records.push({
				round,
				actor: aiId,
				kind: "tool_success",
				description: successDescription,
			});

			if (action.toolCall.name === "pick_up") {
				const picked = state.world.entities.find(
					(e) => e.id === action.toolCall?.args.item,
				);
				if (picked?.examineDescription) {
					actorPrivateToolResult = {
						description: `${successDescription} ${picked.examineDescription}`,
						success: true,
					};
				}
			}

			const call = action.toolCall;
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
						state = appendWitnessedEvent(state, witnessId, witnessEntry);
					}
				}
			}
		} else {
			records.push({
				round,
				actor: aiId,
				kind: "tool_failure",
				description: `${game.personas[aiId]?.name ?? aiId} tried to ${action.toolCall.name} ${action.toolCall.args.item ?? action.toolCall.args.direction ?? ""} but failed: ${validation.reason}`,
			});
			state = appendActionFailure(state, aiId, {
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
			description: `${game.personas[aiId]?.name ?? aiId} passed`,
		});
	}

	const deductResult = deductBudget(state, aiId, options?.costUsd ?? 0);
	state = deductResult.game;

	return {
		rejected: false,
		game: state,
		records,
		...(actorPrivateToolResult !== undefined ? { actorPrivateToolResult } : {}),
		...(actorDiskDelta !== undefined ? { actorDiskDelta } : {}),
	};
}
