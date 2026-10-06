import {
	type EmittedToolCall,
	type PreparedDaemonTurn,
	type SettledDaemonTurn,
	settleDaemonTurn,
} from "../src/spa/game/daemon-turn.js";
import type { GameState } from "../src/spa/game/types.js";

export {
	type DaemonTurnMemory,
	memoryAfterTurn,
	type PreparedDaemonTurn,
	prepareDaemonTurn,
} from "../src/spa/game/daemon-turn.js";

export function settlePreparedTurn(
	game: GameState,
	prepared: PreparedDaemonTurn,
	toolCalls: EmittedToolCall[],
	costUsd?: number,
): SettledDaemonTurn {
	return settleDaemonTurn(game, prepared, { toolCalls, costUsd });
}
