/**
 * available-tools.ts
 *
 * Computes the per-AI per-turn list of legal OpenAI tool definitions.
 * Filters out tools that are structurally impossible given the current
 * game state (empty item cell for pick_up, no held items for put_down/use,
 * no legal direction for go).
 *
 * `face` is always present with the 3-direction enum (excludes "forward", the current facing).
 */

import {
	applyDirection,
	frontArc,
	inBounds,
	isGridPosition,
	positionsEqual,
	RELATIVE_DIRECTIONS,
	relativeToCardinal,
} from "./direction.js";
import { type OpenAiTool, TOOL_DEFINITIONS } from "./tool-registry.js";
import type {
	ActiveComplication,
	AiId,
	GameState,
	GridPosition,
	ToolName,
	WorldEntity,
} from "./types.js";

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
 * 1. `face` — always present, RELATIVE_DIRECTIONS enum excluding "forward" (current facing is no-op).
 * 2. `go` — included only when at least one direction is in-bounds AND non-obstacle.
 *    Enum restricted to legal directions.
 * 3. `pick_up` — included only when pickable entities are in the actor's own cell
 *    OR the 3-cell front arc (dist-1: front-left, ahead, front-right).
 *    Enum restricted to those entity ids.
 * 4. `put_down`, `use` — included only when actor holds at least one pickable entity.
 *    Enum restricted to held entity ids.
 *
 * Spaces and obstacles are never pickupable.
 *
 * @param activeComplications  The phase's active complications list. Any
 *   `tool_disable` entries for `aiId` will remove that tool from the returned list.
 */
export function availableTools(
	game: GameState,
	aiId: AiId,
	activeComplications: ActiveComplication[] = [],
): OpenAiTool[] {
	// Build set of tools disabled for this AI
	const disabledTools = new Set<ToolName>(
		activeComplications
			.filter(
				(c): c is Extract<ActiveComplication, { kind: "tool_disable" }> =>
					c.kind === "tool_disable" && c.target === aiId,
			)
			.map((c) => c.tool),
	);
	const actorSpatial = game.personaSpatial[aiId];
	const { world } = game;
	const pickable = pickableEntities(world.entities);
	const obstacles = obstaclePositions(world.entities);

	const tools: OpenAiTool[] = [];

	// 0. message — always present; restrict 'to' to blue + live other daemon ids
	if (!disabledTools.has("message")) {
		const liveOtherDaemonIds = Object.keys(game.personaSpatial).filter(
			(id) => id !== aiId,
		);
		tools.push(
			cloneToolWithEnums("message", { to: ["blue", ...liveOtherDaemonIds] }),
		);
	}

	// 1. face — always present, excluding "forward" (current facing is no-op)
	if (!disabledTools.has("face")) {
		const faceDirections = RELATIVE_DIRECTIONS.filter((d) => d !== "forward");
		tools.push(cloneToolWithEnums("face", { direction: faceDirections }));
	}

	// 2. go — restricted to legal directions
	if (actorSpatial && !disabledTools.has("go")) {
		const legalDirections = RELATIVE_DIRECTIONS.filter((relDir) => {
			const cardinal = relativeToCardinal(actorSpatial.facing, relDir);
			const next = applyDirection(actorSpatial.position, cardinal);
			if (!inBounds(next)) return false;
			if (obstacles.some((o) => positionsEqual(o, next))) return false;
			return true;
		});
		if (legalDirections.length > 0) {
			tools.push(cloneToolWithEnums("go", { direction: legalDirections }));
		}
	}

	// 3. pick_up — pickable entities in actor's own cell or front arc
	if (actorSpatial && !disabledTools.has("pick_up")) {
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

	// 4. put_down and use — pickable entities held by this actor; also spaces in reach
	const heldItems = pickable.filter((item) => item.holder === aiId);
	if (!disabledTools.has("put_down") && heldItems.length > 0) {
		const heldIds = heldItems.map((i) => i.id);
		tools.push(cloneToolWithEnums("put_down", { item: heldIds }));
	}
	if (!disabledTools.has("use")) {
		// Held item ids
		const heldIds = heldItems.map((i) => i.id);

		// Reachable objective_space ids: space must be in actor's own cell or front arc,
		// and must have useAvailable !== false.
		let reachableSpaceIds: string[] = [];
		if (actorSpatial) {
			const arc = frontArc(actorSpatial.position, actorSpatial.facing);
			reachableSpaceIds = world.entities
				.filter((e) => {
					if (e.kind !== "objective_space") return false;
					if (e.useAvailable === false) return false;
					if (!isGridPosition(e.holder)) return false;
					const spacePos = e.holder as GridPosition;
					if (positionsEqual(spacePos, actorSpatial.position)) return true;
					return arc.some((p) => positionsEqual(p, spacePos));
				})
				.map((e) => e.id);
		}

		const useIds = [...heldIds, ...reachableSpaceIds];
		if (useIds.length > 0) {
			tools.push(cloneToolWithEnums("use", { item: useIds }));
		}
	}

	return tools;
}
