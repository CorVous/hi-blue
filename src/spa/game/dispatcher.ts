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
	buildConeSnapshot,
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
	/** Records produced by this dispatch (0..N per call). */
	records: RoundActionRecord[];
	/**
	 * Private tool result for pick_up auto-examine — not surfaced to any other AI or action log.
	 * Only set when pick_up auto-examine emits the item's examineDescription.
	 */
	actorPrivateToolResult?: { description: string; success: boolean };
	/**
	 * For a `go` action whose cone shift reveals new content, this field
	 * carries the renderWhatsNew output. Only set for successful `go` tool
	 * calls where the pre/post cone snapshots differ.
	 * (Issue #376: persist cone-delta on go tool-call log entries)
	 */
	actorConeDelta?: string;
}

/** Filter entities to only those that can be picked up / put_down / used (not spaces or obstacles). */
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
			// Check if the target is an objective_space (use-space flow)
			const spaceTarget = world.entities.find(
				(e) => e.id === call.args.item && e.kind === "objective_space",
			);
			if (spaceTarget) {
				// Validate reachability and useAvailable
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

			// Standard item use
			const item = pickable.find((i) => i.id === call.args.item);
			if (!item)
				return {
					valid: false,
					reason: `Item "${call.args.item}" does not exist`,
				};
			if (item.holder !== aiId) {
				// Check if item is on the ground within interaction range, where
				// pick_up is the action to advise.
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
			// Cardinal-only: Daemons have no facing, so relative movement
			// vocabulary (forward/back/left/right) is rejected even when it
			// arrives as a raw tool call that bypassed the tool enum.
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
				// Fallback: no spatial state — drop at (0,0)
				target.holder = { row: 0, col: 0 };
			}
			break;
		case "use": {
			// Check if the target is an objective_space (use-space flow)
			const spaceTarget = entities.find(
				(e) => e.id === call.args.item && e.kind === "objective_space",
			);
			if (spaceTarget) {
				const spaceId = call.args.item;
				// Find pending UseSpaceObjective for this space
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
					// Flip entity satisfactionState and mark useAvailable = false
					spaceTarget.satisfactionState = "satisfied";
					spaceTarget.useAvailable = false;
					return {
						...game,
						world: { ...game.world, entities },
						objectives: updatedObjectives,
					};
				}
				// No pending objective — still mark space as used
				spaceTarget.useAvailable = false;
				break;
			}

			// Place item on the paired space's cell when the paired space is
			// within the actor's interaction range (own cell plus the eight
			// adjacent cells). Otherwise no world mutation.
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

			// Check for a pending UseItemObjective that targets this item.
			// If found, flip both the objective's and the entity's satisfactionState.
			if (target) {
				const itemId = call.args.item;
				const pendingObjectiveIdx = game.objectives.findIndex(
					(obj) =>
						obj.kind === "use_item" &&
						obj.itemId === itemId &&
						obj.satisfactionState === "pending",
				);
				if (pendingObjectiveIdx !== -1) {
					// Flip objective satisfactionState
					const updatedObjectives = game.objectives.map((obj, idx) =>
						idx === pendingObjectiveIdx
							? { ...obj, satisfactionState: "satisfied" as const }
							: obj,
					);
					// Flip entity satisfactionState in our entities snapshot
					target.satisfactionState = "satisfied";
					// Return early with updated objectives and entities
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
			// Validation upstream guarantees a cardinal direction.
			// `facing` is still stored (a later chunk of this cutover removes
			// it) and tracks the cardinal direction walked, so the cone-based
			// witness fan-out below keeps working unchanged.
			const direction = call.args.direction as CardinalDirection;
			const nextPos = applyDirection(actorSpatial.position, direction);
			return {
				...game,
				world: { ...game.world, entities },
				personaSpatial: {
					...game.personaSpatial,
					[aiId]: { position: nextPos, facing: direction },
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
			// Check if the target is an objective_space — surface its activationFlavor
			// (the actor's moment-of-satisfaction line) and fall back to useOutcome
			// for backward compat with saves authored before #335.
			const spaceTarget = game.world.entities.find(
				(e) => e.id === call.args.item && e.kind === "objective_space",
			);
			if (spaceTarget) {
				if (spaceTarget.activationFlavor) return spaceTarget.activationFlavor;
				if (spaceTarget.useOutcome)
					return spaceTarget.useOutcome.replace(/\{actor\}/g, "you");
				return `${name} used the ${call.args.item}`;
			}
			// Return the entity's useOutcome as the description (flavor string),
			// with {actor} substituted to "you" (actor's perspective).
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

	let actorConeDelta: string | undefined;

	// Process messages BEFORE toolCall so that result.records reflects
	// speak-then-act order (P0-1 fix for issue #238).
	// Validation uses live personaSpatial from pre-action state — persona
	// membership cannot be changed by an action in scope here, so this is safe.
	// Messages are dispatched in the order they appear in action.messages, and
	// each one emits exactly one record (kind="message" on success, "tool_failure"
	// on invalid recipient) so the round coordinator can pair them back by index.
	if (action.messages) {
		const livePersonaIds = Object.keys(state.personaSpatial);
		for (const msg of action.messages) {
			const validRecipient =
				msg.to === "blue" ||
				(livePersonaIds.includes(msg.to) && msg.to !== aiId);
			if (!validRecipient) {
				records.push({
					round,
					actor: aiId,
					kind: "tool_failure",
					description: `${game.personas[aiId]?.name ?? aiId} tried to message "${msg.to}" but failed: unknown or invalid recipient`,
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
					description: `${game.personas[aiId]?.name ?? aiId} messaged ${msg.to}`,
				});
			}
		}
	}

	if (action.toolCall) {
		const toolCall = action.toolCall;
		const validation = validateToolCall(state, aiId, toolCall);

		if (validation.valid) {
			// Snapshot all AIs' spatial state BEFORE execution (used for witness context).
			// For go: the actor's pre-move state is captured here; post-move state is
			// captured from the post-execute phase below.
			// Snapshot pre-execute world so the post-execute branch can compare
			// satisfactionState transitions for activation-flavor detection.
			const preExecuteWorld = state.world;

			// For go, compute cone delta pre-execution to capture the state before the action
			if (action.toolCall.name === "go") {
				const prevCtx = buildAiContext(state, aiId);
				const prevSnap = buildConeSnapshot(prevCtx);
				state = executeToolCall(state, aiId, action.toolCall);
				const currCtx = buildAiContext(state, aiId);
				const currSnap = buildConeSnapshot(currCtx);
				const delta = renderWhatsNew(prevSnap, currSnap);
				if (delta !== null) {
					actorConeDelta = delta;
				}
			} else {
				state = executeToolCall(state, aiId, action.toolCall);
			}

			// For put_down, check if the object landed on its paired space.
			// If so, replace the default description with the per-pair placementFlavor.
			const flavorDescription =
				action.toolCall.name === "put_down" || action.toolCall.name === "use"
					? checkPlacementFlavor(action, state.contentPack, state.world)
					: null;
			// For `use` on an interesting_object Use-Item target, surface
			// activationFlavor on the call that just satisfied the objective.
			const activationFlavor =
				action.toolCall.name === "use"
					? checkUseItemActivation(action, preExecuteWorld, state.world)
					: null;
			const successDescription =
				activationFlavor ??
				flavorDescription ??
				describeToolCall(state, aiId, action.toolCall);
			records.push({
				round,
				actor: aiId,
				kind: "tool_success",
				description: successDescription,
			});

			// Auto-examine on pick_up: surface the item's examineDescription privately
			// to the actor so objective-item details land in the actor's context.
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

			// Build and append a PhysicalActionRecord for observable physical actions.
			// Only the four observable action tools reach this branch.
			const call = action.toolCall;
			if (
				call.name === "go" ||
				call.name === "pick_up" ||
				call.name === "put_down" ||
				call.name === "use"
			) {
				// Post-execute spatial state — actor has moved for "go", others are unchanged
				const actorSpatialPost = state.personaSpatial[aiId];

				// Collect all other AIs' spatial states at this moment (snapshot)
				const witnessSpatial: Record<AiId, PersonaSpatialState> = {};
				for (const [otherId, spatial] of Object.entries(state.personaSpatial)) {
					if (otherId !== aiId) {
						witnessSpatial[otherId] = spatial;
					}
				}

				if (actorSpatialPost) {
					// Gather optional fields
					const pickable = pickableEntities(state.world.entities);
					let useOutcomeRaw: string | undefined;
					let placementFlavorRaw: string | undefined;

					if (call.name === "use") {
						// Check if the target is an objective_space — use its satisfactionFlavor for witnesses
						const spaceTarget = state.world.entities.find(
							(e) => e.id === call.args.item && e.kind === "objective_space",
						);
						if (spaceTarget) {
							useOutcomeRaw = spaceTarget.satisfactionFlavor;
						} else if (activationFlavor !== null) {
							// Use-Item activation: witnesses get the activationFlavor verbatim
							// (validator-enforced no-{actor} so no substitution needed).
							useOutcomeRaw = activationFlavor;
						} else {
							const item = pickable.find((i) => i.id === call.args.item);
							// Store raw (un-substituted) useOutcome for witness rendering
							useOutcomeRaw = item?.useOutcome;
						}
					}

					if (call.name === "put_down" || call.name === "use") {
						// Find the raw placementFlavor (before {actor} substitution)
						// by looking at the content pack's object entity definition
						const itemId = call.args.item;
						const packObject =
							itemId !== undefined
								? carryObjectById(itemId, state.contentPack)
								: undefined;
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
						...(call.name === "go"
							? {
									// Store resolved cardinal direction (actorFacingAtAction is post-move facing = direction walked)
									direction: actorSpatialPost.facing,
								}
							: {}),
						...(useOutcomeRaw !== undefined
							? { useOutcome: useOutcomeRaw }
							: {}),
						...(placementFlavorRaw !== undefined ? { placementFlavorRaw } : {}),
					};

					// Write-time Vista fan-out: append a witnessed-event entry to each
					// qualifying witness's per-Daemon log. The actor gets nothing here —
					// their tool-result string is their channel.
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
		...(actorConeDelta !== undefined ? { actorConeDelta } : {}),
	};
}
