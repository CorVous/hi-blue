import type { AiId, GameState, GridPosition } from "../game/types.js";
import { projectVista } from "../game/vista-projector.js";

export function vistaMaskForPosition(
	observerRoomPosition: GridPosition,
): Set<string> {
	const mask = new Set<string>();

	for (const cell of projectVista(observerRoomPosition)) {
		if (cell.isWall) continue;
		mask.add(`${cell.position.row},${cell.position.col}`);
	}

	return mask;
}

export function vistaMaskForDaemon(state: GameState, aiId: AiId): Set<string> {
	const spatial = state.personaSpatial[aiId];
	if (!spatial) return new Set();

	return vistaMaskForPosition(spatial.position);
}
