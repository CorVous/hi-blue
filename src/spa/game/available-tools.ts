/**
 * available-tools.ts
 *
 * Computes the per-AI per-turn list of legal OpenAI tool definitions.
 * Filters out tools that are structurally impossible given the current
 * game state (empty item cell for pick_up, no held items for put_down/use,
 * no adjacent AI for give, no legal direction for go).
 *
 * `look` is always present with the full 4-direction enum.
 */

import { projectCone } from "./cone-projector.js";
import {
	applyDirection,
	areAdjacent4,
	CARDINAL_DIRECTIONS,
	inBounds,
} from "./direction.js";
import { getActivePhase } from "./engine.js";
import { type OpenAiTool, TOOL_DEFINITIONS } from "./tool-registry.js";
import type { AiId, GameState, GridPosition, WorldEntity } from "./types.js";

/** Narrow-check: is `holder` a GridPosition (not an AiId string)? */
function isGridPosition(holder: AiId | GridPosition): holder is GridPosition {
	return typeof holder === "object" && holder !== null;
}

/** True when two GridPositions refer to the same cell. */
function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

/** Entities that can be picked up/used/given (objective_object and interesting_object). */
function pickableEntities(entities: WorldEntity[]): WorldEntity[] {
	return entities.filter(
		(e) => e.kind === "objective_object" || e.kind === "interesting_object",
	);
}

/** Obstacle positions (GridPosition only, since obstacles are always on the grid). */
function obstaclePositions(entities: WorldEntity[]): GridPosition[] {
	return entities
		.filter((e) => e.kind === "obstacle")
		.map((e) => {
			const h = e.holder;
			return isGridPosition(h) ? h : null;
		})
		.filter((pos): pos is GridPosition => pos !== null);
}

/**
 * Deep-clone a tool definition and override a subset of property enums.
 */
function cloneToolWithEnums(
	toolName: string,
	enumOverrides: Record<string, string[]>,
): OpenAiTool {
	const base = TOOL_DEFINITIONS.find((t) => t.function.name === toolName);
	if (!base)
		throw new Error(`Tool "${toolName}" not found in TOOL_DEFINITIONS`);

	// Deep clone
	const cloned: OpenAiTool = {
		type: "function",
		function: {
			name: base.function.name,
			description: base.function.description,
			parameters: {
				type: base.function.parameters.type,
				properties: Object.fromEntries(
					Object.entries(base.function.parameters.properties).map(
						([key, prop]) => [
							key,
							{
								...prop,
								...(enumOverrides[key] !== undefined
									? { enum: enumOverrides[key] }
									: {}),
							},
						],
					),
				),
				required: [...base.function.parameters.required],
				additionalProperties: false,
			},
		},
	};
	return cloned;
}

/**
 * Compute the list of legal OpenAI tools for the given AI in the current game state.
 *
 * Algorithm (per plan §1b):
 * 1. `look` — always present, full CARDINAL_DIRECTIONS enum.
 * 2. `go` — included only when at least one direction is in-bounds AND non-obstacle.
 *    Enum restricted to legal directions.
 * 3. `pick_up` — included only when pickable entities rest in the actor's current cell.
 *    Enum restricted to those entity ids.
 * 4. `put_down`, `use` — included only when actor holds at least one pickable entity.
 *    Enum restricted to held entity ids.
 * 5. `give` — included only when actor holds pickable entities AND has 4-adjacent AIs.
 *    item enum = held entity ids, to enum = adjacent AI ids.
 *
 * Spaces and obstacles are never pickupable.
 */
export function availableTools(game: GameState, aiId: AiId): OpenAiTool[] {
	const phase = getActivePhase(game);
	const actorSpatial = phase.personaSpatial[aiId];
	const { world } = phase;
	const pickable = pickableEntities(world.entities);
	const obstacles = obstaclePositions(world.entities);

	const tools: OpenAiTool[] = [];

	// 0. message — always present; restrict 'to' to blue + live other daemon ids
	const liveOtherDaemonIds = Object.keys(phase.personaSpatial).filter(
		(id) => id !== aiId,
	);
	tools.push(
		cloneToolWithEnums("message", { to: ["blue", ...liveOtherDaemonIds] }),
	);

	// 1. look — always present
	tools.push(
		cloneToolWithEnums("look", { direction: [...CARDINAL_DIRECTIONS] }),
	);

	// 2. go — restricted to legal directions
	if (actorSpatial) {
		const legalDirections = CARDINAL_DIRECTIONS.filter((dir) => {
			const next = applyDirection(actorSpatial.position, dir);
			if (!inBounds(next)) return false;
			if (obstacles.some((o) => positionsEqual(o, next))) return false;
			return true;
		});
		if (legalDirections.length > 0) {
			tools.push(cloneToolWithEnums("go", { direction: legalDirections }));
		}
	}

	// 3. pick_up — pickable entities resting in actor's cell
	if (actorSpatial) {
		const cellItems = pickable.filter(
			(item) =>
				isGridPosition(item.holder) &&
				positionsEqual(item.holder, actorSpatial.position),
		);
		if (cellItems.length > 0) {
			tools.push(
				cloneToolWithEnums("pick_up", { item: cellItems.map((i) => i.id) }),
			);
		}
	}

	// 4. put_down and use — pickable entities held by this actor
	const heldItems = pickable.filter((item) => item.holder === aiId);
	if (heldItems.length > 0) {
		const heldIds = heldItems.map((i) => i.id);
		tools.push(cloneToolWithEnums("put_down", { item: heldIds }));
		tools.push(cloneToolWithEnums("use", { item: heldIds }));
	}

	// 5. give — held items AND adjacent AIs
	if (actorSpatial && heldItems.length > 0) {
		const adjacentAiIds = Object.entries(phase.personaSpatial)
			.filter(([otherId, otherSpatial]) => {
				if (otherId === aiId) return false;
				return areAdjacent4(actorSpatial.position, otherSpatial.position);
			})
			.map(([otherId]) => otherId);

		if (adjacentAiIds.length > 0) {
			tools.push(
				cloneToolWithEnums("give", {
					item: heldItems.map((i) => i.id),
					to: adjacentAiIds,
				}),
			);
		}
	}

	// 6. examine — items in cone (any kind) OR held by this actor
	if (actorSpatial) {
		const cone = projectCone(actorSpatial.position, actorSpatial.facing);
		const conePositions = cone.map((c) => c.position);

		const examineableIds = world.entities
			.filter((entity) => {
				// Held by this actor
				if (entity.holder === aiId) return true;
				// Resting on a cell inside the cone
				if (isGridPosition(entity.holder)) {
					return conePositions.some((pos) =>
						positionsEqual(pos, entity.holder as GridPosition),
					);
				}
				return false;
			})
			.map((e) => e.id);

		if (examineableIds.length > 0) {
			tools.push(cloneToolWithEnums("examine", { item: examineableIds }));
		}
	}

	return tools;
}
