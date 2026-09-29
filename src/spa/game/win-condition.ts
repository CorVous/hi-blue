import { isGridPosition, positionsEqual } from "./direction";
import type {
	AiId,
	AiTurnAction,
	CarryObjective,
	ConvergenceObjective,
	GameState,
	Objective,
	PersonaSpatialState,
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

export function isObjectiveSatisfied(
	objective: Objective,
	world: WorldState,
): boolean {
	if (objective.kind === "carry") {
		return isCarryObjectiveSatisfied(objective, world);
	}
	return objective.satisfactionState === "satisfied";
}

export function checkWinCondition(
	world: WorldState,
	objectives: Objective[],
): boolean {
	return objectives.every((objective) =>
		isObjectiveSatisfied(objective, world),
	);
}

export function checkBudgetExhausted(
	exhausted: ReadonlySet<AiId> | AiId[],
	allAiIds: AiId[],
): boolean {
	const exhaustedSet =
		exhausted instanceof Set ? exhausted : new Set(exhausted);
	for (const aiId of allAiIds) {
		if (!exhaustedSet.has(aiId)) return false;
	}
	return true;
}

export function outcomeOfCompletedGame(
	state: Pick<GameState, "world" | "objectives" | "exhausted" | "personas">,
): "win" | "lose" {
	const allObjectivesSatisfied = checkWinCondition(
		state.world,
		state.objectives,
	);
	const everyBudgetExhausted = checkBudgetExhausted(
		state.exhausted,
		Object.keys(state.personas),
	);
	return everyBudgetExhausted && !allObjectivesSatisfied ? "lose" : "win";
}

export function checkPlacementFlavor(
	action: AiTurnAction,
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
