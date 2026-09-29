import { runRound } from "../round-coordinator";
import type { RoundTurnResult } from "../round-llm-provider";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { GameState } from "../types";
import {
	makeSilentProvider,
	seededRng,
	withCountdownZero,
} from "./fixtures/make-game-state";

export type ScriptedToolCall = RoundTurnResult["toolCalls"][number];

export function toolCall(
	id: string,
	name: string,
	args: Record<string, unknown> | string,
): ScriptedToolCall {
	return {
		id,
		name,
		argumentsJson: typeof args === "string" ? args : JSON.stringify(args),
	};
}

export function firstTurnActs(
	toolCalls: ScriptedToolCall[],
	turn: Omit<Partial<RoundTurnResult>, "toolCalls"> = {},
): MockRoundLLMProvider {
	return new MockRoundLLMProvider([
		{ assistantText: "", ...turn, toolCalls },
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
	]);
}

export function runComplicationRound(
	game: GameState,
	draws: readonly number[],
	fallback: () => number = () => 0,
) {
	return runRound(withCountdownZero(game), "red", "hi", makeSilentProvider(), {
		rng: seededRng(draws, fallback),
	});
}
