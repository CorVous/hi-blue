import { isGridPosition, positionsEqual } from "./direction";
import type {
	AiId,
	AiTurnAction,
	CarryObjective,
	ContentPack,
	ConvergenceObjective,
	Objective,
	PersonaSpatialState,
	UseItemObjective,
	UseSpaceObjective,
	WorldState,
} from "./types";

export function isCarryObjectiveSatisfied(
	objective: CarryObjective,
	world: WorldState,
): boolean {
	const objectEntity = world.entities.find((e) => e.id === objective.objectId);
	if (!objectEntity) return false;

	if (!isGridPosition(objectEntity.holder)) return false;

	const spaceEntity = world.entities.find((e) => e.id === objective.spaceId);
	if (!spaceEntity) return false;

	if (!isGridPosition(spaceEntity.holder)) return false;

	return positionsEqual(objectEntity.holder, spaceEntity.holder);
}

export function isUseItemObjectiveSatisfied(
	objective: UseItemObjective,
): boolean {
	return objective.satisfactionState === "satisfied";
}

export function isUseSpaceObjectiveSatisfied(
	objective: UseSpaceObjective,
): boolean {
	return objective.satisfactionState === "satisfied";
}

export function checkConvergenceTier(
	objective: ConvergenceObjective,
	world: WorldState,
	personaSpatial: Record<AiId, PersonaSpatialState>,
): { tier: 0 | 1 | 2; spaceId: string } {
	const spaceId = objective.spaceId;
	const spaceEntity = world.entities.find((e) => e.id === spaceId);
	if (!spaceEntity) return { tier: 0, spaceId };

	if (!isGridPosition(spaceEntity.holder)) return { tier: 0, spaceId };

	const spaceCell = spaceEntity.holder;

	let count = 0;
	for (const spatial of Object.values(personaSpatial)) {
		if (positionsEqual(spatial.position, spaceCell)) {
			count++;
		}
	}

	if (count === 0) return { tier: 0, spaceId };
	if (count === 1) return { tier: 1, spaceId };
	return { tier: 2, spaceId };
}

export function checkWinCondition(
	world: WorldState,
	objectives: Objective[],
): boolean {
	for (const objective of objectives) {
		switch (objective.kind) {
			case "carry":
				if (!isCarryObjectiveSatisfied(objective, world)) return false;
				break;
			case "use_item":
				if (!isUseItemObjectiveSatisfied(objective)) return false;
				break;
			case "use_space":
				if (!isUseSpaceObjectiveSatisfied(objective)) return false;
				break;
			case "convergence":
				if (objective.satisfactionState !== "satisfied") return false;
				break;
		}
	}

	return true;
}

export function checkLoseCondition(
	lockedOut: ReadonlySet<AiId> | AiId[],
	allAiIds: AiId[],
): boolean {
	const lockedSet = lockedOut instanceof Set ? lockedOut : new Set(lockedOut);
	for (const aiId of allAiIds) {
		if (!lockedSet.has(aiId)) return false;
	}
	return true;
}

export function checkPlacementFlavor(
	action: AiTurnAction,
	_contentPack: ContentPack,
	world: WorldState,
): string | null {
	const toolCall = action.toolCall;
	if (!toolCall) return null;
	const toolName = toolCall.name;
	if (toolName !== "put_down" && toolName !== "use") return null;

	const itemId = toolCall.args.item;
	if (!itemId) return null;

	const objectEntity = world.entities.find((e) => e.id === itemId);
	if (!objectEntity) return null;

	if (objectEntity.kind !== "objective_object") return null;
	const spaceId = objectEntity.pairsWithSpaceId;
	if (!spaceId) return null;
	const placementFlavor = objectEntity.placementFlavor;
	if (!placementFlavor) return null;

	if (!isGridPosition(objectEntity.holder)) return null;

	const spaceEntity = world.entities.find((e) => e.id === spaceId);
	if (!spaceEntity) return null;

	if (!isGridPosition(spaceEntity.holder)) return null;

	if (!positionsEqual(objectEntity.holder, spaceEntity.holder)) return null;

	return placementFlavor.replace(/\{actor\}/g, "you");
}

export function checkUseItemActivation(
	action: AiTurnAction,
	preWorld: WorldState,
	postWorld: WorldState,
): string | null {
	const toolCall = action.toolCall;
	if (!toolCall || toolCall.name !== "use") return null;

	const itemId = toolCall.args.item;
	if (!itemId) return null;

	const postEntity = postWorld.entities.find((e) => e.id === itemId);
	if (!postEntity) return null;
	if (postEntity.kind !== "interesting_object") return null;
	if (!postEntity.activationFlavor) return null;
	if (postEntity.satisfactionState !== "satisfied") return null;

	const preEntity = preWorld.entities.find((e) => e.id === itemId);
	if (preEntity?.satisfactionState === "satisfied") return null;

	return postEntity.activationFlavor;
}
