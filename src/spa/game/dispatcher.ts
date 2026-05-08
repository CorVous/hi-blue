import {
	applyDirection,
	areAdjacent4,
	CARDINAL_DIRECTIONS,
	formatPosition,
	inBounds,
} from "./direction.js";
import {
	appendChat,
	appendWhisper,
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
	RoundActionRecord,
	ToolCall,
	WorldEntity,
} from "./types";

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
			// Return the entity's useOutcome as the description (flavor string).
			const item = pickable.find((i) => i.id === call.args.item);
			if (item?.useOutcome) return item.useOutcome;
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

	if (action.toolCall) {
		const validation = validateToolCall(state, aiId, action.toolCall);
		if (validation.valid) {
			state = executeToolCall(state, aiId, action.toolCall);
			records.push({
				round,
				actor: aiId,
				kind: "tool_success",
				description: describeToolCall(state, aiId, action.toolCall),
			});
		} else {
			records.push({
				round,
				actor: aiId,
				kind: "tool_failure",
				description: `${game.personas[aiId]?.name ?? aiId} tried to ${action.toolCall.name} ${action.toolCall.args.item ?? action.toolCall.args.direction ?? ""} but failed: ${validation.reason}`,
			});
		}
	}

	if (action.chat) {
		state = appendChat(state, aiId, {
			role: "ai",
			content: action.chat.content,
		});
		records.push({
			round,
			actor: aiId,
			kind: "chat",
			description: `${game.personas[aiId]?.name ?? aiId} spoke to ${action.chat.target}`,
		});
	}

	if (action.whisper) {
		state = appendWhisper(state, {
			from: aiId,
			to: action.whisper.target,
			content: action.whisper.content,
			round,
		});
		records.push({
			round,
			actor: aiId,
			kind: "whisper",
			description: `${game.personas[aiId]?.name ?? aiId} whispered to ${game.personas[action.whisper.target]?.name ?? action.whisper.target}`,
		});
	}

	if (action.pass && !action.toolCall && !action.chat && !action.whisper) {
		records.push({
			round,
			actor: aiId,
			kind: "pass",
			description: `${game.personas[aiId]?.name ?? aiId} passed`,
		});
	}

	state = deductBudget(state, aiId);

	return { rejected: false, game: state, records };
}
