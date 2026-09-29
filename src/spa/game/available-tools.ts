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

export function pairedSpaceHoldingItem(
	item: WorldEntity,
	entities: WorldEntity[],
): WorldEntity | undefined {
	if (!item.pairsWithSpaceId || !isGridPosition(item.holder)) return undefined;
	const itemPos = item.holder;
	return entities.find(
		(e) =>
			e.id === item.pairsWithSpaceId &&
			e.kind === "objective_space" &&
			isGridPosition(e.holder) &&
			positionsEqual(e.holder, itemPos),
	);
}

export function pickableEntities(entities: WorldEntity[]): WorldEntity[] {
	return entities.filter(
		(e) => e.kind === "objective_object" || e.kind === "interesting_object",
	);
}

export function obstaclePositions(entities: WorldEntity[]): GridPosition[] {
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

export function disabledToolsFor(
	activeComplications: ActiveComplication[],
	aiId: AiId,
): Set<ToolName> {
	return new Set<ToolName>(
		activeComplications
			.filter(
				(c): c is Extract<ActiveComplication, { kind: "tool_disable" }> =>
					c.kind === "tool_disable" && c.target === aiId,
			)
			.map((c) => c.tool),
	);
}

export type ItemToolName = "pick_up" | "put_down" | "use";

function isTargetable(entity: WorldEntity): boolean {
	return (
		entity.kind === "objective_object" ||
		entity.kind === "interesting_object" ||
		entity.kind === "objective_space"
	);
}

function handleKey(handle: string): string {
	return handle.trim().toLowerCase();
}

export function targetHandles(entities: WorldEntity[]): Map<string, string> {
	const targetable = entities.filter(isTargetable);
	const nameCounts = new Map<string, number>();
	for (const e of targetable) {
		const nameKey = handleKey(e.name);
		nameCounts.set(nameKey, (nameCounts.get(nameKey) ?? 0) + 1);
	}
	const isShared = (name: string): boolean =>
		(nameCounts.get(handleKey(name)) ?? 0) > 1;
	const taken = new Set(
		targetable
			.map((e) => e.name.trim())
			.filter((name) => !isShared(name))
			.map(handleKey),
	);
	const lastOrdinal = new Map<string, number>();
	const handles = new Map<string, string>();
	for (const e of targetable) {
		const name = e.name.trim();
		if (!isShared(name)) {
			handles.set(e.id, name);
			continue;
		}
		const nameKey = handleKey(name);
		let ordinal = lastOrdinal.get(nameKey) ?? 0;
		let handle: string;
		do {
			ordinal++;
			handle = `${name} #${ordinal}`;
		} while (taken.has(handleKey(handle)));
		lastOrdinal.set(nameKey, ordinal);
		taken.add(handleKey(handle));
		handles.set(e.id, handle);
	}
	return handles;
}

export function entityHandle(
	entities: WorldEntity[],
	entity: WorldEntity,
): string {
	return targetHandles(entities).get(entity.id) ?? entity.name.trim();
}

function toolTargetCandidates(
	game: GameState,
	aiId: AiId,
	tool: ItemToolName,
): WorldEntity[] {
	const actorSpatial = game.personaSpatial[aiId];
	const { entities } = game.world;
	const pickable = pickableEntities(entities);
	const held = pickable.filter((item) => item.holder === aiId);

	switch (tool) {
		case "pick_up":
			if (!actorSpatial) return [];
			return pickable.filter(
				(item) =>
					isGridPosition(item.holder) &&
					withinInteractionRange(actorSpatial.position, item.holder) &&
					!pairedSpaceHoldingItem(item, entities),
			);
		case "put_down":
			return held;
		case "use": {
			if (!actorSpatial) return held;
			const usableSpaces = entities.filter(
				(e) =>
					e.kind === "objective_space" &&
					e.useAvailable !== false &&
					isGridPosition(e.holder) &&
					withinInteractionRange(actorSpatial.position, e.holder),
			);
			return [...held, ...usableSpaces];
		}
	}
}

function findByHandle(
	candidates: WorldEntity[],
	handles: Map<string, string>,
	handle: string,
): WorldEntity | undefined {
	const exact = candidates.find((e) => handles.get(e.id) === handle);
	if (exact) return exact;
	const folded = handleKey(handle);
	return candidates.find((e) => {
		const candidateHandle = handles.get(e.id);
		return (
			candidateHandle !== undefined && handleKey(candidateHandle) === folded
		);
	});
}

export function resolveToolTarget(
	game: GameState,
	aiId: AiId,
	tool: ItemToolName,
	handle: string,
): WorldEntity | undefined {
	const { entities } = game.world;
	const handles = targetHandles(entities);
	return (
		findByHandle(toolTargetCandidates(game, aiId, tool), handles, handle) ??
		findByHandle(entities.filter(isTargetable), handles, handle) ??
		entities.find((e) => e.id === handle)
	);
}

function handlesOf(game: GameState, targets: WorldEntity[]): string[] {
	const handles = targetHandles(game.world.entities);
	return targets.map((e) => handles.get(e.id) ?? e.name.trim());
}

export function availableTools(
	game: GameState,
	aiId: AiId,
	activeComplications: ActiveComplication[] = [],
): OpenAiTool[] {
	const disabledTools = disabledToolsFor(activeComplications, aiId);
	const actorSpatial = game.personaSpatial[aiId];
	const obstacles = obstaclePositions(game.world.entities);

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

	for (const tool of ["pick_up", "put_down", "use"] as const) {
		if (disabledTools.has(tool)) continue;
		const targets = toolTargetCandidates(game, aiId, tool);
		if (targets.length > 0) {
			tools.push(cloneToolWithEnums(tool, { item: handlesOf(game, targets) }));
		}
	}

	return tools;
}
