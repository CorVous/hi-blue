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
	CARDINAL_DIRECTIONS,
	frontArc,
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
 * Algorithm:
 * 0. `message` — always present; `to` enum = "blue" + live peer daemon ids.
 * 1. `look` — always present, full CARDINAL_DIRECTIONS enum.
 * 2. `go` — included only when at least one direction is in-bounds AND non-obstacle.
 *    Enum restricted to legal directions.
 * 3. `pick_up` — included only when pickable entities are in the actor's own cell
 *    OR the 3-cell front arc (dist-1: front-left, ahead, front-right).
 *    Enum restricted to those entity ids.
 * 4. `put_down`, `use` — included only when actor holds at least one pickable entity.
 *    Enum restricted to held entity ids.
 * 5. `give` — included only when actor holds pickable entities AND has AIs in the
 *    actor's own cell or front arc. item enum = held entity ids, to enum = reachable AI ids.
 * 6. `examine` — included when any entity (any kind) is held by the actor OR rests
 *    anywhere in the full 9-cell cone (own + dist-1 arc + dist-2 fan).
 *    Enum restricted to those entity ids.
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

	// 3. pick_up — pickable entities in actor's own cell or front arc
	if (actorSpatial) {
		const arc = frontArc(actorSpatial.position, actorSpatial.facing);
		const reachableItems = pickable.filter((item) => {
			if (!isGridPosition(item.holder)) return false;
			if (positionsEqual(item.holder, actorSpatial.position)) return true;
			return arc.some((p) => positionsEqual(p, item.holder as GridPosition));
		});
		if (reachableItems.length > 0) {
			tools.push(
				cloneToolWithEnums("pick_up", {
					item: reachableItems.map((i) => i.id),
				}),
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

	// 5. give — held items AND AIs in own cell or front arc
	if (actorSpatial && heldItems.length > 0) {
		const arc = frontArc(actorSpatial.position, actorSpatial.facing);
		const reachableAiIds = Object.entries(phase.personaSpatial)
			.filter(([otherId, otherSpatial]) => {
				if (otherId === aiId) return false;
				if (positionsEqual(actorSpatial.position, otherSpatial.position))
					return true;
				return arc.some((p) => positionsEqual(p, otherSpatial.position));
			})
			.map(([otherId]) => otherId);

		if (reachableAiIds.length > 0) {
			tools.push(
				cloneToolWithEnums("give", {
					item: heldItems.map((i) => i.id),
					to: reachableAiIds,
				}),
			);
		}
	}

	// 6. examine — items held or in cone (own cell + dist-1 arc + dist-2 fan)
	if (actorSpatial) {
		const cone = projectCone(actorSpatial.position, actorSpatial.facing);
		const conePositions = cone.map((c) => c.position);
		const examineableIds = world.entities
			.filter((entity) => {
				if (entity.holder === aiId) return true;
				if (isGridPosition(entity.holder)) {
					return conePositions.some((p) =>
						positionsEqual(p, entity.holder as GridPosition),
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
