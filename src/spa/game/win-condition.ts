/**
 * win-condition.ts
 *
 * Pure helpers for win/lose condition checking and placement flavor.
 *
 * checkWinCondition(objectives): returns true iff all objectives are satisfied.
 * checkLoseCondition(lockedOut, allAiIds): returns true iff all AIs are locked out.
 * checkPlacementFlavor: returns the per-pair placementFlavor string (with {actor}
 * substituted to "you") when a put_down action lands an objective_object on its
 * matching space's cell, or null otherwise.
 */

import type {
	AiId,
	AiTurnAction,
	ContentPack,
	GridPosition,
	Objective,
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
 * Returns true iff all objectives are satisfied.
 *
 * Returns false when objectives is empty (no objectives → game cannot be won yet).
 * Satisfaction logic is implemented in issues #303-#305.
 */
export function checkWinCondition(objectives: Objective[]): boolean {
	if (objectives.length === 0) return false;
	return objectives.every((o) => o.satisfactionState === "satisfied");
}

/**
 * Returns true iff all AIs are locked out (budget-exhausted).
 *
 * Returns false when allAiIds is empty.
 */
export function checkLoseCondition(
	lockedOut: AiId[],
	allAiIds: AiId[],
): boolean {
	if (allAiIds.length === 0) return false;
	return allAiIds.every((id) => lockedOut.includes(id));
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
