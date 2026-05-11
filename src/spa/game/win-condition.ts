/**
 * win-condition.ts
 *
 * Pure helpers for the multi-pair objective win condition (issue #126, PRD #120).
 *
 * checkWinCondition: returns true iff every objective pair in the ContentPack is
 * satisfied — i.e. each objective_object's current holder cell equals its paired
 * objective_space's holder cell, using the structural pairsWithSpaceId link (not
 * coincidental coordinate equality).
 *
 * checkPlacementFlavor: returns the per-pair placementFlavor string (with {actor}
 * substituted to "you") when a put_down action lands an objective_object on its
 * matching space's cell, or null otherwise.
 */

import type {
	AiId,
	AiTurnAction,
	ContentPack,
	GridPosition,
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
 * Returns true iff every objective pair in the ContentPack is satisfied.
 *
 * A pair is satisfied when:
 *  - The object's holder is a GridPosition (not held by any AI)
 *  - The space's holder is a GridPosition
 *  - Their row/col are equal
 *  - The lookup is structural (via pairsWithSpaceId), not just coincidental coord equality
 *
 * K=0 vacuously returns true (no pairs to satisfy).
 */
export function checkWinCondition(
	world: WorldState,
	contentPack: ContentPack,
): boolean {
	for (const pair of contentPack.objectivePairs) {
		// Find the live object entity in world
		const objectEntity = world.entities.find((e) => e.id === pair.object.id);
		if (!objectEntity) return false;

		// Object must be on the ground (GridPosition), not held by an AI
		if (!isGridPosition(objectEntity.holder)) return false;

		// Find the paired space using the structural pairsWithSpaceId link
		const spaceId = objectEntity.pairsWithSpaceId;
		if (!spaceId) return false;

		// The space must be the one this object is structurally paired with
		const spaceEntity = world.entities.find((e) => e.id === spaceId);
		if (!spaceEntity) return false;

		// Space must also be a GridPosition
		if (!isGridPosition(spaceEntity.holder)) return false;

		// Object and space must share the same cell
		if (!positionsEqual(objectEntity.holder, spaceEntity.holder)) return false;
	}

	// All pairs satisfied (vacuously true if K=0)
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
