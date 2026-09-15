/**
 * available-tools.ts
 *
 * Computes the per-AI per-turn list of legal OpenAI tool definitions.
 * Filters out tools that are structurally impossible given the current
 * game state (empty item cell for pick_up, no held items for put_down/use,
 * no legal cardinal step for go).
 *
 * The surface is the five-tool Daemon tool set (ADR 0015): `go`, `pick_up`,
 * `put_down`, `use`, `message`. There is no `face` tool and no
 * facing-relative movement vocabulary.
 *
 * Reach is the **Interaction range** (ADR 0015): the Daemon's own cell plus
 * all eight adjacent cells, including diagonals. It is strictly shorter than
 * the 13-cell **Vista**, so a target two cardinal steps away is visible but
 * out of reach.
 */

import {
	applyDirection,
	CARDINAL_DIRECTIONS,
	inBounds,
	isGridPosition,
	positionsEqual,
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

/**
 * True when `target` lies inside `origin`'s **Interaction range**: the
 * Daemon's own cell plus all eight adjacent cells, including diagonals —
 * integer offsets with `max(|drow|, |dcol|) ≤ 1`, nine cells total
 * (ADR 0015). Strictly shorter than the **Vista**: cells two cardinal steps
 * away are visible but outside this range. Facing plays no part — the range
 * is omnidirectional.
 *
 * This is the single source of truth for that range: availability here,
 * validation and effects in the dispatcher, and proximity hints in the
 * prompt builder all agree on it.
 */
export function withinInteractionRange(
	origin: GridPosition,
	target: GridPosition,
): boolean {
	return (
		Math.max(
			Math.abs(target.row - origin.row),
			Math.abs(target.col - origin.col),
		) <= 1
	);
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
 * 1. `go` — included only when at least one cardinal direction is in-bounds
 *    AND non-obstacle. Enum restricted to those legal directions.
 * 2. `pick_up` — included only when pickable entities are on the ground within
 *    the actor's interaction range (own cell plus the eight adjacent cells).
 *    Enum restricted to those entity ids.
 * 3. `put_down`, `use` — included only when actor holds at least one pickable entity.
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

	// 1. go — restricted to legal cardinal directions
	if (actorSpatial && !disabledTools.has("go")) {
		const legalDirections = CARDINAL_DIRECTIONS.filter((cardinal) => {
			const next = applyDirection(actorSpatial.position, cardinal);
			if (!inBounds(next)) return false;
			if (obstacles.some((o) => positionsEqual(o, next))) return false;
			return true;
		});
		if (legalDirections.length > 0) {
			tools.push(cloneToolWithEnums("go", { direction: legalDirections }));
		}
	}

	// 2. pick_up — pickable entities on the ground within interaction range
	if (actorSpatial && !disabledTools.has("pick_up")) {
		const reachableItems = pickable.filter(
			(item) =>
				isGridPosition(item.holder) &&
				withinInteractionRange(actorSpatial.position, item.holder),
		);
		if (reachableItems.length > 0) {
			tools.push(
				cloneToolWithEnums("pick_up", {
					item: reachableItems.map((i) => i.id),
				}),
			);
		}
	}

	// 3. put_down and use — pickable entities held by this actor; also spaces in reach
	const heldItems = pickable.filter((item) => item.holder === aiId);
	if (!disabledTools.has("put_down") && heldItems.length > 0) {
		const heldIds = heldItems.map((i) => i.id);
		tools.push(cloneToolWithEnums("put_down", { item: heldIds }));
	}
	if (!disabledTools.has("use")) {
		// Held item ids
		const heldIds = heldItems.map((i) => i.id);

		// Reachable objective_space ids: space must be within interaction range
		// (including the actor's own cell), and must have useAvailable !== false.
		// No held item is required.
		let reachableSpaceIds: string[] = [];
		if (actorSpatial) {
			reachableSpaceIds = world.entities
				.filter((e) => {
					if (e.kind !== "objective_space") return false;
					if (e.useAvailable === false) return false;
					if (!isGridPosition(e.holder)) return false;
					return withinInteractionRange(actorSpatial.position, e.holder);
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
