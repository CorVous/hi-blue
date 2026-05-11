import { projectCone } from "./cone-projector.js";
import {
	applyDirection,
	areAdjacent4,
	CARDINAL_DIRECTIONS,
	formatPosition,
	inBounds,
} from "./direction.js";
import {
	appendMessage,
	appendWitnessedEvent,
	deductBudget,
	getActivePhase,
	isAiLockedOut,
	updateActivePhase,
} from "./engine";
import type {
	AiId,
	AiTurnAction,
	CardinalDirection,
	GameState,
	GridPosition,
	PersonaSpatialState,
	PhysicalActionRecord,
	RoundActionRecord,
	ToolCall,
	WorldEntity,
} from "./types";
import { checkPlacementFlavor } from "./win-condition.js";

export interface ValidationResult {
	valid: boolean;
	reason?: string;
}

export interface DispatchResult {
	rejected: boolean;
	reason?: string;
	game: GameState;
	/** Records produced by this dispatch (0..N per call). */
	records: RoundActionRecord[];
	/**
	 * Private tool result for examine — not surfaced to any other AI or action log.
	 * Only set when the tool call is "examine".
	 */
	actorPrivateToolResult?: { description: string; success: boolean };
}

/** Narrow-check: is `holder` a GridPosition (not an AiId string)? */
function isGridPosition(holder: AiId | GridPosition): holder is GridPosition {
	return typeof holder === "object" && holder !== null;
}

/** Return true when two GridPositions refer to the same cell. */
function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

/** Filter entities to only those that can be picked up / put_down / given / used (not spaces or obstacles). */
function pickableEntities(entities: WorldEntity[]): WorldEntity[] {
	return entities.filter(
		(e) => e.kind === "objective_object" || e.kind === "interesting_object",
	);
}

/** Filter entities to obstacle kind for collision checks. */
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
	const phase = getActivePhase(game);
	const { world } = phase;
	const actorSpatial = phase.personaSpatial[aiId];
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
			// Spatial validity: item must be in the actor's current cell
			if (!actorSpatial)
				return { valid: false, reason: "Actor has no spatial state" };
			if (!positionsEqual(item.holder, actorSpatial.position))
				return {
					valid: false,
					reason: `Item "${call.args.item}" is not in your current cell`,
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

		case "give": {
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
			const target = call.args.to as AiId;
			if (target === aiId)
				return { valid: false, reason: "Cannot give an item to yourself" };
			// Spatial validity: target AI must be 4-adjacent
			const targetSpatial = phase.personaSpatial[target];
			if (!actorSpatial || !targetSpatial)
				return {
					valid: false,
					reason: "Spatial state missing for actor or target",
				};
			if (!areAdjacent4(actorSpatial.position, targetSpatial.position))
				return {
					valid: false,
					reason: `${target} is not adjacent to you`,
				};
			return { valid: true };
		}

		case "use": {
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

		case "go": {
			const direction = call.args.direction as CardinalDirection;
			if (!CARDINAL_DIRECTIONS.includes(direction))
				return {
					valid: false,
					reason: `"${direction}" is not a valid direction`,
				};
			if (!actorSpatial)
				return { valid: false, reason: "Actor has no spatial state" };
			const next = applyDirection(actorSpatial.position, direction);
			if (!inBounds(next))
				return { valid: false, reason: "That direction is out of bounds" };
			if (obstacles.some((o) => positionsEqual(o, next)))
				return { valid: false, reason: "That cell is blocked by an obstacle" };
			return { valid: true };
		}

		case "look": {
			const direction = call.args.direction as CardinalDirection;
			if (!CARDINAL_DIRECTIONS.includes(direction))
				return {
					valid: false,
					reason: `"${direction}" is not a valid direction`,
				};
			return { valid: true };
		}

		case "examine": {
			// Item must exist (any kind: objective_object, interesting_object, obstacle, objective_space)
			const item = world.entities.find((e) => e.id === call.args.item);
			if (!item)
				return {
					valid: false,
					reason: `Item "${call.args.item}" does not exist`,
				};
			if (!actorSpatial)
				return { valid: false, reason: "Actor has no spatial state" };
			// Valid if held by aiId OR resting on a GridPosition inside actor's cone
			if (item.holder === aiId) return { valid: true };
			if (isGridPosition(item.holder)) {
				const cone = projectCone(actorSpatial.position, actorSpatial.facing);
				const inCone = cone.some((cell) =>
					positionsEqual(cell.position, item.holder as GridPosition),
				);
				if (inCone) return { valid: true };
			}
			return {
				valid: false,
				reason: `Item "${call.args.item}" is not in your cone or held by you`,
			};
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
	return updateActivePhase(game, (phase) => {
		const entities = phase.world.entities.map((e) => ({ ...e }));
		const actorSpatial = phase.personaSpatial[aiId];
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
					// Fallback: no spatial state — drop at (0,0)
					target.holder = { row: 0, col: 0 };
				}
				break;
			case "give":
				if (target) target.holder = call.args.to as AiId;
				break;
			case "use":
				// No world mutation — useOutcome is returned as the tool result description.
				break;
			case "examine":
				// No world mutation — examineDescription is returned as the tool result description.
				break;
			case "go": {
				if (!actorSpatial) break;
				const direction = call.args.direction as CardinalDirection;
				const nextPos = applyDirection(actorSpatial.position, direction);
				return {
					...phase,
					world: { ...phase.world, entities },
					personaSpatial: {
						...phase.personaSpatial,
						[aiId]: { position: nextPos, facing: direction },
					},
				};
			}
			case "look": {
				if (!actorSpatial) break;
				const direction = call.args.direction as CardinalDirection;
				return {
					...phase,
					world: { ...phase.world, entities },
					personaSpatial: {
						...phase.personaSpatial,
						[aiId]: { ...actorSpatial, facing: direction },
					},
				};
			}
		}

		return { ...phase, world: { ...phase.world, entities } };
	});
}

function describeToolCall(game: GameState, aiId: AiId, call: ToolCall): string {
	const name = game.personas[aiId]?.name ?? aiId;
	const phase = getActivePhase(game);
	const spatial = phase.personaSpatial[aiId];
	const pickable = pickableEntities(phase.world.entities);

	switch (call.name) {
		case "pick_up":
			return `${name} picked up the ${call.args.item}`;
		case "put_down":
			return `${name} put down the ${call.args.item}`;
		case "give":
			return `${name} gave the ${call.args.item} to ${game.personas[call.args.to as AiId]?.name ?? call.args.to}`;
		case "use": {
			// Return the entity's useOutcome as the description (flavor string),
			// with {actor} substituted to "you" (actor's perspective).
			const item = pickable.find((i) => i.id === call.args.item);
			if (item?.useOutcome) return item.useOutcome.replace(/\{actor\}/g, "you");
			return `${name} used the ${call.args.item}`;
		}
		case "go": {
			const pos = spatial?.position;
			const posStr = pos ? formatPosition(pos) : "unknown";
			return `${name} walks ${call.args.direction} to ${posStr}`;
		}
		case "look":
			return `${name} looks ${call.args.direction}`;
		default:
			return `${name} attempted an unknown action`;
	}
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
	const round = getActivePhase(state).round;
	const records: RoundActionRecord[] = [];

	let actorPrivateToolResult:
		| { description: string; success: boolean }
		| undefined;

	// Process message BEFORE toolCall so that result.records reflects
	// speak-then-act order (P0-1 fix for issue #238).
	// Validation uses live personaSpatial from pre-action state — persona
	// membership cannot be changed by an action in scope here, so this is safe.
	if (action.message) {
		const { to, content } = action.message;
		// Validate recipient: must be "blue" or a live persona AiId (not self)
		const livePersonaIds = Object.keys(getActivePhase(state).personaSpatial);
		const validRecipient =
			to === "blue" || (livePersonaIds.includes(to) && to !== aiId);
		if (!validRecipient) {
			records.push({
				round,
				actor: aiId,
				kind: "tool_failure",
				description: `${game.personas[aiId]?.name ?? aiId} tried to message "${to}" but failed: unknown or invalid recipient`,
			});
		} else {
			state = appendMessage(state, aiId, to, content);
			records.push({
				round,
				actor: aiId,
				kind: "message",
				description: `${game.personas[aiId]?.name ?? aiId} messaged ${to}`,
			});
		}
	}

	if (action.toolCall) {
		const toolCall = action.toolCall;
		const validation = validateToolCall(state, aiId, toolCall);

		if (toolCall.name === "examine") {
			if (validation.valid) {
				const item = getActivePhase(state).world.entities.find(
					(e) => e.id === toolCall.args.item,
				);
				actorPrivateToolResult = {
					description: item?.examineDescription ?? "",
					success: true,
				};
			} else {
				actorPrivateToolResult = {
					description: validation.reason ?? "Examine failed",
					success: false,
				};
			}
		} else if (validation.valid) {
			// Snapshot all AIs' spatial state BEFORE execution (used for witness context).
			// For go: the actor's pre-move state is captured here; post-move state is
			// captured from the post-execute phase below.
			state = executeToolCall(state, aiId, action.toolCall);
			// For put_down, check if the object landed on its paired space.
			// If so, replace the default description with the per-pair placementFlavor.
			const activePhase = getActivePhase(state);
			const flavorDescription =
				action.toolCall.name === "put_down"
					? checkPlacementFlavor(
							action,
							activePhase.contentPack,
							activePhase.world,
						)
					: null;
			const successDescription =
				flavorDescription ?? describeToolCall(state, aiId, action.toolCall);
			records.push({
				round,
				actor: aiId,
				kind: "tool_success",
				description: successDescription,
			});

			// Auto-examine on pick_up: surface the item's examineDescription privately
			// to the actor so objective-item details land in the actor's context
			// without requiring a separate examine call.
			if (action.toolCall.name === "pick_up") {
				const picked = activePhase.world.entities.find(
					(e) => e.id === action.toolCall?.args.item,
				);
				if (picked?.examineDescription) {
					actorPrivateToolResult = {
						description: `${successDescription} ${picked.examineDescription}`,
						success: true,
					};
				}
			}

			// Build and append a PhysicalActionRecord for observable physical actions.
			// look is excluded (facing-change only, not observable); examine doesn't exist yet.
			const call = action.toolCall;
			if (
				call.name === "go" ||
				call.name === "pick_up" ||
				call.name === "put_down" ||
				call.name === "give" ||
				call.name === "use"
			) {
				// Post-execute spatial state — actor has moved for "go", others are unchanged
				const postPhase = getActivePhase(state);
				const actorSpatialPost = postPhase.personaSpatial[aiId];

				// Collect all other AIs' spatial states at this moment (snapshot)
				const witnessSpatial: Record<AiId, PersonaSpatialState> = {};
				for (const [otherId, spatial] of Object.entries(
					postPhase.personaSpatial,
				)) {
					if (otherId !== aiId) {
						witnessSpatial[otherId] = spatial;
					}
				}

				if (actorSpatialPost) {
					// Gather optional fields
					const pickable = pickableEntities(postPhase.world.entities);
					let useOutcomeRaw: string | undefined;
					let placementFlavorRaw: string | undefined;

					if (call.name === "use") {
						const item = pickable.find((i) => i.id === call.args.item);
						// Store raw (un-substituted) useOutcome for witness rendering
						useOutcomeRaw = item?.useOutcome;
					}

					if (call.name === "put_down") {
						// Find the raw placementFlavor (before {actor} substitution)
						// by looking at the content pack's object entity definition
						const itemId = call.args.item;
						const packObject = activePhase.contentPack.objectivePairs
							.map((p) => p.object)
							.find((o) => o.id === itemId);
						if (packObject?.placementFlavor && flavorDescription) {
							// flavorDescription is non-null only when the match fired
							placementFlavorRaw = packObject.placementFlavor;
						}
					}

					const physRecord: PhysicalActionRecord = {
						round,
						actor: aiId,
						actorCellAtAction: actorSpatialPost.position,
						actorFacingAtAction: actorSpatialPost.facing,
						kind: call.name,
						witnessSpatial,
						...(call.args.item !== undefined ? { item: call.args.item } : {}),
						...(call.name === "give" && call.args.to !== undefined
							? { to: call.args.to as AiId }
							: {}),
						...(call.name === "go"
							? { direction: call.args.direction as CardinalDirection }
							: {}),
						...(useOutcomeRaw !== undefined
							? { useOutcome: useOutcomeRaw }
							: {}),
						...(placementFlavorRaw !== undefined ? { placementFlavorRaw } : {}),
					};

					// Write-time cone fan-out: append a witnessed-event entry to each
					// qualifying witness's per-Daemon log. The actor gets nothing here —
					// their tool-result string is their channel.
					for (const [witnessId, witnessSp] of Object.entries(witnessSpatial)) {
						const witnessCone = projectCone(
							witnessSp.position,
							witnessSp.facing,
						);
						const actorInCone = witnessCone.some((cell) =>
							positionsEqual(cell.position, physRecord.actorCellAtAction),
						);
						if (!actorInCone) continue;

						const witnessEntry = {
							kind: "witnessed-event" as const,
							round,
							actor: aiId,
							actionKind: physRecord.kind,
							...(physRecord.item !== undefined
								? { item: physRecord.item }
								: {}),
							...(physRecord.to !== undefined ? { to: physRecord.to } : {}),
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
		}
	}

	if (action.pass && !action.toolCall && !action.message) {
		records.push({
			round,
			actor: aiId,
			kind: "pass",
			description: `${game.personas[aiId]?.name ?? aiId} passed`,
		});
	}

	state = deductBudget(state, aiId, options?.costUsd ?? 0);

	return {
		rejected: false,
		game: state,
		records,
		...(actorPrivateToolResult !== undefined ? { actorPrivateToolResult } : {}),
	};
}
