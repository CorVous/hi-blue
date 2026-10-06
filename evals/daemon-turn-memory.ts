import {
	type DaemonTurnMemory,
	type EmittedToolCall,
	type PreparedDaemonTurn,
	type SettledDaemonTurn,
	settleDaemonTurn,
} from "../src/spa/game/daemon-turn.js";
import type { GameState } from "../src/spa/game/types.js";

export {
	type DaemonTurnMemory,
	type PreparedDaemonTurn,
	prepareDaemonTurn,
} from "../src/spa/game/daemon-turn.js";

export function settlePreparedTurn(
	game: GameState,
	prepared: PreparedDaemonTurn,
	toolCalls: EmittedToolCall[],
	costUsd?: number,
): { settled: SettledDaemonTurn; memory: DaemonTurnMemory } {
	const settled = settleDaemonTurn(game, prepared, { toolCalls, costUsd });
	return {
		settled,
		memory: memoryAfterPrompt(prepared, settled.toolRoundtrip),
	};
}

export function memoryAfterPrompt(
	prepared: PreparedDaemonTurn,
	toolRoundtrip?: DaemonTurnMemory["toolRoundtrip"],
): DaemonTurnMemory {
	return {
		diskSnapshot: prepared.diskSnapshot,
		diskEntities: prepared.promptEntities,
		toolRoundtrip,
	};
}
