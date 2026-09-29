import { TEST_PERSONAS } from "../../game/__tests__/fixtures/make-game-state.js";
import { makeTestPack } from "../../game/__tests__/fixtures/make-test-pack.js";
import { startGame } from "../../game/engine.js";
import type { GameState } from "../../game/types.js";

const TEST_CONTENT_PACK = makeTestPack([], { wallName: "wall" });

export function makeFreshGame(): GameState {
	return startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
		budgetPerAi: 5,
		rng: () => 0,
	});
}
