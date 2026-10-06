import {
	type EmittedToolCall,
	type SettledDaemonTurn,
	settleDaemonTurn,
} from "../src/spa/game/daemon-turn.js";
import { buildOpenAiMessages } from "../src/spa/game/openai-message-builder.js";
import {
	buildAiContext,
	type DiskEntityState,
} from "../src/spa/game/prompt-builder.js";
import type { OpenAiMessage } from "../src/spa/game/round-llm-provider.js";
import type {
	AiId,
	GameState,
	ToolRoundtripMessage,
} from "../src/spa/game/types.js";

export interface DaemonTurnMemory {
	diskSnapshot?: string | undefined;
	diskEntities?: Record<string, DiskEntityState> | undefined;
	toolRoundtrip?: ToolRoundtripMessage | undefined;
}

export interface PreparedDaemonTurn {
	messages: OpenAiMessage[];
	promptEntities: Record<string, DiskEntityState>;
	memoryAfterPrompt: DaemonTurnMemory;
}

export function prepareDaemonTurn(
	game: GameState,
	aiId: AiId,
	memory: DaemonTurnMemory,
): PreparedDaemonTurn {
	const ctx = buildAiContext(game, aiId, {
		prevDiskSnapshot: memory.diskSnapshot,
		prevDiskEntities: memory.diskEntities,
	});
	const promptEntities = ctx.diskEntities();
	return {
		messages: buildOpenAiMessages(ctx, memory.toolRoundtrip, game.round),
		promptEntities,
		memoryAfterPrompt: {
			diskSnapshot: ctx.diskSnapshot(),
			diskEntities: promptEntities,
		},
	};
}

export function settlePreparedTurn(
	game: GameState,
	aiId: AiId,
	prepared: PreparedDaemonTurn,
	toolCalls: EmittedToolCall[],
	costUsd?: number,
): { settled: SettledDaemonTurn; memory: DaemonTurnMemory } {
	const settled = settleDaemonTurn(game, aiId, {
		toolCalls,
		costUsd,
		promptMessages: prepared.messages,
		promptEntities: prepared.promptEntities,
	});
	return {
		settled,
		memory: {
			...prepared.memoryAfterPrompt,
			toolRoundtrip: settled.toolRoundtrip,
		},
	};
}
