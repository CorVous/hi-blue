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

function cloneToolWithEnums(
	toolName: string,
	enumOverrides: Record<string, string[]>,
): OpenAiTool {
	const base = TOOL_DEFINITIONS.find((t) => t.function.name === toolName);
	if (!base)
		throw new Error(`Tool "${toolName}" not found in TOOL_DEFINITIONS`);

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

export function availableTools(
	game: GameState,
	aiId: AiId,
	activeComplications: ActiveComplication[] = [],
): OpenAiTool[] {
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

	if (!disabledTools.has("message")) {
		const liveOtherDaemonIds = Object.keys(game.personaSpatial).filter(
			(id) => id !== aiId,
		);
		tools.push(
			cloneToolWithEnums("message", { to: ["blue", ...liveOtherDaemonIds] }),
		);
	}

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

	const heldItems = pickable.filter((item) => item.holder === aiId);
	if (!disabledTools.has("put_down") && heldItems.length > 0) {
		const heldIds = heldItems.map((i) => i.id);
		tools.push(cloneToolWithEnums("put_down", { item: heldIds }));
	}
	if (!disabledTools.has("use")) {
		const heldIds = heldItems.map((i) => i.id);

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
