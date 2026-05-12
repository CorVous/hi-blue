/**
 * win-condition.ts
 *
 * Pure helpers for the multi-pair objective win condition (issue #126, PRD #120).
 *
 * checkWinCondition: returns true iff every objective in the objectives array is
 * satisfied — checks each objective type with the appropriate predicate.
 *
 * checkPlacementFlavor: returns the per-pair placementFlavor string (with {actor}
 * substituted to "you") when a put_down action lands an objective_object on its
 * matching space's cell, or null otherwise.
 */

import type {
	AiId,
	AiTurnAction,
	CarryObjective,
	ContentPack,
	ConvergenceObjective,
	GridPosition,
	Objective,
	PersonaSpatialState,
	UseItemObjective,
	UseSpaceObjective,
	WorldState,
} from "./types";

/** Narrow-check: is `holder` a GridPosition (not an AiId string)? */
function isGridPosition(holder: unknown): holder is GridPosition {
	return typeof holder === "object" && holder !== null;
}

/** Return true when two GridPositions refer to the same cell. */
function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

/**
 * Returns true when a CarryObjective is satisfied:
 *  - The object's holder is a GridPosition (not held by an AI)
 *  - The space's holder is a GridPosition
 *  - Their row/col are equal
 */
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

/**
 * Returns true when a UseItemObjective is satisfied:
 * The objective's satisfactionState is "satisfied".
 */
export function isUseItemObjectiveSatisfied(
	objective: UseItemObjective,
): boolean {
	return objective.satisfactionState === "satisfied";
}

/**
 * Returns true when a UseSpaceObjective is satisfied:
 * The objective's satisfactionState is "satisfied".
 */
export function isUseSpaceObjectiveSatisfied(
	objective: UseSpaceObjective,
): boolean {
	return objective.satisfactionState === "satisfied";
}

/**
 * Returns the convergence tier for the given ConvergenceObjective:
 *  - tier 0: space entity missing, or its holder is not a GridPosition, or zero Daemons on the space cell
 *  - tier 1: exactly one Daemon on the space cell
 *  - tier 2: two or more Daemons share the space cell (clamped to 2)
 *
 * Also returns the spaceId for the caller's convenience.
 */
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

/**
 * Returns true iff every objective in the objectives array is satisfied.
 *
 * - CarryObjective: checks world state (object and space share same cell)
 * - UseItemObjective: checks objective.satisfactionState
 * - UseSpaceObjective: checks objective.satisfactionState
 * - ConvergenceObjective: checks objective.satisfactionState
 *
 * K=0 (empty objectives) vacuously returns true.
 */
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

/**
 * Returns true when every AI in allAiIds is in lockedOut.
 *
 * Vacuously true when allAiIds is empty (no AIs to exhaust).
 */
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

/**
 * Returns the actor-substituted placementFlavor string when a put_down action
 * lands an objective_object on its paired objective_space's cell.
 *
 * Returns null if:
 * - The action is not a put_down
 * - The dropped item is not an objective_object with pairsWithSpaceId
 * - The item's new location does not equal the paired space's location
 * - The pair is not structurally matched (wrong space at same cell, etc.)
 *
 * The returned string has {actor} replaced with "you" (actor-perspective for
 * the tool-result description). Witness / third-person rendering arrives in #129.
 */
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

	// Find the live object entity in world (post-execute, so holder is now a GridPosition)
	const objectEntity = world.entities.find((e) => e.id === itemId);
	if (!objectEntity) return null;

	// Must be an objective_object with a pairing
	if (objectEntity.kind !== "objective_object") return null;
	const spaceId = objectEntity.pairsWithSpaceId;
	if (!spaceId) return null;
	const placementFlavor = objectEntity.placementFlavor;
	if (!placementFlavor) return null;

	// Object must now be on the ground (put_down succeeded)
	if (!isGridPosition(objectEntity.holder)) return null;

	// Find the paired space entity in world
	const spaceEntity = world.entities.find((e) => e.id === spaceId);
	if (!spaceEntity) return null;

	// Space must be a GridPosition
	if (!isGridPosition(spaceEntity.holder)) return null;

	// Object must now be on the same cell as its paired space
	if (!positionsEqual(objectEntity.holder, spaceEntity.holder)) return null;

	// Pair matched — return flavor with {actor} substituted to "you"
	return placementFlavor.replace(/\{actor\}/g, "you");
}

/**
 * Returns the activationFlavor string for the `use` call that satisfies a
 * UseItemObjective on an interesting_object, or null otherwise.
 *
 * Detection compares pre-execute and post-execute world snapshots:
 *  - The action must be a `use` on an interesting_object that has an
 *    `activationFlavor` field.
 *  - The entity's `satisfactionState` must have flipped from
 *    pending / undefined (pre) to `"satisfied"` (post). Only the call that
 *    just satisfied the objective returns activationFlavor; subsequent calls
 *    on an already-satisfied item fall through to `useOutcome`.
 *
 * activationFlavor has no `{actor}` token (validator-enforced), so the same
 * string is returned to the actor and used verbatim for the witness fan-out.
 */
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
	// "just satisfied" means the pre-state was not yet satisfied
	if (preEntity?.satisfactionState === "satisfied") return null;

	return postEntity.activationFlavor;
}
