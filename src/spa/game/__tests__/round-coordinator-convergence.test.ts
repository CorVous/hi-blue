import { describe, expect, it } from "vitest";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type {
	ConvergenceObjective,
	ConversationEntry,
	WorldEntity,
} from "../types";
import {
	makeSilentProvider,
	makeTestGame,
	withPackOrderedWorld,
} from "./fixtures/make-game-state";
import { firstTurnActs, toolCall } from "./round-coordinator-harness";

const CONVERGENCE_SPACE: WorldEntity = {
	id: "altar_space",
	kind: "objective_space",
	name: "Stone Altar",
	examineDescription: "A weathered stone altar.",
	holder: { row: 4, col: 4 },
	convergenceTier1Flavor: "A single presence lingers at the Stone Altar.",
	convergenceTier2Flavor: "Two presences converge at the Stone Altar.",
	convergenceTier1ActorFlavor:
		"You linger at the Stone Altar; the air seems to wait.",
	convergenceTier2ActorFlavor:
		"You stand at the Stone Altar; another presence shares the place.",
};

const CONVERGENCE_OBJECT: WorldEntity = {
	id: "altar_obj",
	kind: "objective_object",
	name: "Altar Stone",
	examineDescription: "A small stone for the Stone Altar.",
	holder: { row: 0, col: 0 },
	pairsWithSpaceId: "altar_space",
	placementFlavor: "{actor} places it on the altar.",
};

const CONVERGENCE_OBJECTIVE: ConvergenceObjective = {
	id: "obj-conv",
	kind: "convergence",
	description: "Two Daemons must share the Stone Altar.",
	satisfactionState: "pending",
	spaceId: "altar_space",
};

function makeBaseGame() {
	const base = makeTestGame({
		entities: [CONVERGENCE_OBJECT, CONVERGENCE_SPACE],
		pack: {
			aiStarts: {
				red: { position: { row: 4, col: 4 } },
				green: { position: { row: 0, col: 0 } },
				cyan: { position: { row: 0, col: 2 } },
			},
		},
		budgetPerAi: 99,
	});
	return { ...withPackOrderedWorld(base), objectives: [CONVERGENCE_OBJECTIVE] };
}

function withRedWestOfAltar<T extends ReturnType<typeof makeBaseGame>>(
	game: T,
): T {
	return {
		...game,
		personaSpatial: {
			...game.personaSpatial,
			red: { position: { row: 4, col: 3 } },
		},
	};
}

function withGreenOnAltar<T extends ReturnType<typeof makeBaseGame>>(
	game: T,
): T {
	return {
		...game,
		personaSpatial: {
			...game.personaSpatial,
			green: { position: { row: 4, col: 4 } },
		},
	};
}

function makeRedStepsOntoAltarProvider() {
	return firstTurnActs([toolCall("go-east", "go", { direction: "east" })]);
}

type ConvergenceEntry = Extract<
	ConversationEntry,
	{ kind: "witnessed-convergence" }
>;

function convergenceEntriesOf(
	log: readonly ConversationEntry[] | undefined,
): ConvergenceEntry[] {
	return (log ?? []).filter(
		(e): e is ConvergenceEntry => e.kind === "witnessed-convergence",
	);
}

describe("runRound — end-of-round convergence evaluation", () => {
	it("tier-1: one Daemon arriving on the space → witnessed-convergence tier-1 entry in their log", async () => {
		const game = withRedWestOfAltar(makeBaseGame());

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeRedStepsOntoAltarProvider(),
		);

		const convergenceEntries = convergenceEntriesOf(
			nextState.conversationLogs.red,
		);
		expect(convergenceEntries).toHaveLength(1);
		const entry = convergenceEntries[0];
		expect(entry?.tier).toBe(1);
		expect(entry?.spaceId).toBe("altar_space");
		expect(entry?.audience).toBe("actor");
		expect(entry?.flavor).toBe(CONVERGENCE_SPACE.convergenceTier1ActorFlavor);
	});

	it("tier-1: a Daemon whose Vista does NOT contain the space cell does NOT receive an entry", async () => {
		const game = makeBaseGame();

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
		);

		const greenConvergence = convergenceEntriesOf(
			nextState.conversationLogs.green,
		);
		const cyanConvergence = convergenceEntriesOf(
			nextState.conversationLogs.cyan,
		);

		expect(greenConvergence).toHaveLength(0);
		expect(cyanConvergence).toHaveLength(0);
	});

	it("tier-1: satisfactionState remains 'pending' after one Daemon on the space", async () => {
		const game = makeBaseGame();

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
		);

		const convergenceObj = nextState.objectives.find(
			(o) => o.kind === "convergence",
		);
		expect(convergenceObj?.satisfactionState).toBe("pending");
	});

	it("tier-2: two Daemons on the space → witnessed-convergence tier-2 entries and satisfactionState flips to 'satisfied'", async () => {
		const game = withGreenOnAltar(makeBaseGame());

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
		);

		const redConvergence = convergenceEntriesOf(nextState.conversationLogs.red);
		const greenConvergence = convergenceEntriesOf(
			nextState.conversationLogs.green,
		);
		const cyanConvergence = convergenceEntriesOf(
			nextState.conversationLogs.cyan,
		);

		expect(redConvergence).toHaveLength(1);
		expect(redConvergence[0]?.tier).toBe(2);
		expect(redConvergence[0]?.audience).toBe("actor");
		expect(redConvergence[0]?.flavor).toBe(
			CONVERGENCE_SPACE.convergenceTier2ActorFlavor,
		);

		expect(greenConvergence).toHaveLength(1);
		expect(greenConvergence[0]?.tier).toBe(2);
		expect(greenConvergence[0]?.audience).toBe("actor");
		expect(greenConvergence[0]?.flavor).toBe(
			CONVERGENCE_SPACE.convergenceTier2ActorFlavor,
		);

		expect(cyanConvergence).toHaveLength(0);

		const convergenceObj = nextState.objectives.find(
			(o) => o.kind === "convergence",
		);
		expect(convergenceObj?.satisfactionState).toBe("satisfied");
		const space = nextState.world.entities.find((e) => e.id === "altar_space");
		expect(space?.satisfactionState).toBe("satisfied");
	});

	it("re-trigger guard: a third round with both Daemons still on the space does NOT add new convergence entries", async () => {
		const gameTwoOnSpace = withGreenOnAltar(makeBaseGame());

		const { nextState: afterRound1 } = await runRound(
			gameTwoOnSpace,
			"red",
			"hi",
			makeSilentProvider(),
		);

		const obj1 = afterRound1.objectives.find((o) => o.kind === "convergence");
		expect(obj1?.satisfactionState).toBe("satisfied");

		const redCountAfterRound1 = convergenceEntriesOf(
			afterRound1.conversationLogs.red,
		).length;
		expect(redCountAfterRound1).toBeGreaterThanOrEqual(1);

		const { nextState: afterRound2 } = await runRound(
			afterRound1,
			"red",
			"hi",
			makeSilentProvider(),
		);

		const obj2 = afterRound2.objectives.find((o) => o.kind === "convergence");
		expect(obj2?.satisfactionState).toBe("satisfied");

		const redCountAfterRound2 = convergenceEntriesOf(
			afterRound2.conversationLogs.red,
		).length;
		expect(redCountAfterRound2).toBe(redCountAfterRound1);
	});
});

describe("runRound — convergence split fan-out (actor vs witness) — #336", () => {
	it("tier-1: the sole occupant gets the actor flavor; a non-occupant Vista-witness gets the witness flavor", async () => {
		const baseGame = withRedWestOfAltar(makeBaseGame());
		const game = {
			...baseGame,
			personaSpatial: {
				...baseGame.personaSpatial,
				cyan: { position: { row: 3, col: 4 } },
			},
		};

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeRedStepsOntoAltarProvider(),
		);

		const redEntry = (nextState.conversationLogs.red ?? []).find(
			(e) => e.kind === "witnessed-convergence",
		);
		expect(redEntry).toBeDefined();
		expect(redEntry?.audience).toBe("actor");
		expect(redEntry?.flavor).toBe(
			CONVERGENCE_SPACE.convergenceTier1ActorFlavor,
		);

		const cyanEntry = (nextState.conversationLogs.cyan ?? []).find(
			(e) => e.kind === "witnessed-convergence",
		);
		expect(cyanEntry).toBeDefined();
		expect(cyanEntry?.audience).toBe("witness");
		expect(cyanEntry?.flavor).toBe(CONVERGENCE_SPACE.convergenceTier1Flavor);
	});

	it("tier-2: every occupant gets the actor flavor; a non-occupant Vista-witness gets the witness flavor", async () => {
		const baseGame = makeBaseGame();
		const game = {
			...baseGame,
			personaSpatial: {
				red: { position: { row: 4, col: 4 } },
				green: { position: { row: 4, col: 4 } },
				cyan: { position: { row: 3, col: 4 } },
			},
		};

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
		);

		for (const aiId of ["red", "green"] as const) {
			const entry = (nextState.conversationLogs[aiId] ?? []).find(
				(e) => e.kind === "witnessed-convergence",
			);
			expect(entry).toBeDefined();
			expect(entry?.audience).toBe("actor");
			expect(entry?.flavor).toBe(CONVERGENCE_SPACE.convergenceTier2ActorFlavor);
		}

		const cyanEntry = (nextState.conversationLogs.cyan ?? []).find(
			(e) => e.kind === "witnessed-convergence",
		);
		expect(cyanEntry).toBeDefined();
		expect(cyanEntry?.audience).toBe("witness");
		expect(cyanEntry?.flavor).toBe(CONVERGENCE_SPACE.convergenceTier2Flavor);
	});
});

describe("runRound — convergence Vista boundary (ADR 0015)", () => {
	it("a Daemon at offset (2, 0) from the space is a witness; one at (2, 1) is not — the occupant stays the actor", async () => {
		const baseGame = withRedWestOfAltar(makeBaseGame());
		const game = {
			...baseGame,
			personaSpatial: {
				...baseGame.personaSpatial,
				green: { position: { row: 4, col: 2 } },
				cyan: { position: { row: 3, col: 2 } },
			},
		};

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeRedStepsOntoAltarProvider(),
		);

		const redEntries = convergenceEntriesOf(nextState.conversationLogs.red);
		expect(redEntries).toHaveLength(1);
		expect(redEntries[0]?.audience).toBe("actor");
		expect(redEntries[0]?.flavor).toBe(
			CONVERGENCE_SPACE.convergenceTier1ActorFlavor,
		);

		const greenEntries = convergenceEntriesOf(nextState.conversationLogs.green);
		expect(greenEntries).toHaveLength(1);
		expect(greenEntries[0]?.audience).toBe("witness");
		expect(greenEntries[0]?.flavor).toBe(
			CONVERGENCE_SPACE.convergenceTier1Flavor,
		);

		expect(convergenceEntriesOf(nextState.conversationLogs.cyan)).toHaveLength(
			0,
		);
	});
});

describe("runRound — convergence emits on tier changes only", () => {
	it("a Daemon that stays on the space adds no new entry in the following round", async () => {
		const { nextState: afterArrival } = await runRound(
			withRedWestOfAltar(makeBaseGame()),
			"red",
			"hi",
			makeRedStepsOntoAltarProvider(),
		);
		const countAfterArrival = convergenceEntriesOf(
			afterArrival.conversationLogs.red,
		).length;
		expect(countAfterArrival).toBe(1);

		const { nextState: afterStaying } = await runRound(
			afterArrival,
			"red",
			"hi",
			makeSilentProvider(),
		);
		const countAfterStaying = convergenceEntriesOf(
			afterStaying.conversationLogs.red,
		).length;
		expect(countAfterStaying).toBe(countAfterArrival);
	});
});

describe("runRound — convergence emits when the set of occupants changes", () => {
	it("an occupant swap (one Daemon leaves as another arrives) tells the newcomer and the witnesses", async () => {
		const baseGame = makeBaseGame();
		const game = {
			...baseGame,
			round: 3,
			personaSpatial: {
				...baseGame.personaSpatial,
				green: { position: { row: 3, col: 4 } },
			},
		};
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{ id: "red-west", name: "go", argumentsJson: '{"direction":"west"}' },
				],
			},
			{
				assistantText: "",
				toolCalls: [
					{
						id: "green-south",
						name: "go",
						argumentsJson: '{"direction":"south"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
		]);

		const { nextState } = await runRound(game, "red", "hi", provider);

		expect(nextState.personaSpatial.green?.position).toEqual({
			row: 4,
			col: 4,
		});
		expect(nextState.personaSpatial.red?.position).toEqual({ row: 4, col: 3 });

		const greenEntries = convergenceEntriesOf(nextState.conversationLogs.green);
		expect(greenEntries).toHaveLength(1);
		expect(greenEntries[0]?.tier).toBe(1);
		expect(greenEntries[0]?.audience).toBe("actor");

		const redEntries = convergenceEntriesOf(nextState.conversationLogs.red);
		expect(redEntries).toHaveLength(1);
		expect(redEntries[0]?.audience).toBe("witness");
		expect(redEntries[0]?.flavor).toBe(
			CONVERGENCE_SPACE.convergenceTier1Flavor,
		);
	});

	it("a Daemon that stays alone on the space after the first round gets no new entry", async () => {
		const game = { ...makeBaseGame(), round: 3 };

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
		);

		expect(convergenceEntriesOf(nextState.conversationLogs.red)).toHaveLength(
			0,
		);
	});

	it("a Daemon whose start cell is the space gets its tier-1 actor flavor in the first round", async () => {
		const game = makeBaseGame();
		expect(game.round).toBe(0);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
		);

		const redEntries = convergenceEntriesOf(nextState.conversationLogs.red);
		expect(redEntries).toHaveLength(1);
		expect(redEntries[0]?.tier).toBe(1);
		expect(redEntries[0]?.audience).toBe("actor");
		expect(redEntries[0]?.flavor).toBe(
			CONVERGENCE_SPACE.convergenceTier1ActorFlavor,
		);
	});
});

describe("runRound — convergence satisfaction reaches the perception delta", () => {
	it("the next round tells an occupant that the space is now satisfied", async () => {
		const game = withGreenOnAltar(makeBaseGame());

		const { nextState, diskEntities } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
		);

		const provider = makeSilentProvider();
		await runRound(nextState, "red", "hi", provider, {
			priorDiskEntities: diskEntities,
		});

		const redPrompt = JSON.stringify(provider.calls[0]?.messages ?? []);
		expect(redPrompt).toContain("Stone Altar is now");
	});
});
