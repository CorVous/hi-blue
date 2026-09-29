/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDualContentPacks } from "../../../content/content-pack-generator";
import { SINGLE_GAME_CONFIG } from "../../../content/phases";
import { SETTING_POOL } from "../../../content/pools";
import {
	loadSession,
	saveActiveSession,
} from "../../persistence/session-storage";
import type { RawBinding, RawBoundPack } from "../binding-aware-validator";
import { isPlayerChatLockedOut } from "../complication-engine";
import {
	type DualBindingContentPackInput,
	MockContentPackProvider,
} from "../content-pack-provider";
import {
	cellAtIndex,
	cellIndex,
	everyOpenCellReachable,
	type GridPosition,
	inBounds,
	isGridPosition,
	TOTAL_CELLS,
} from "../direction";
import { GameSession } from "../game-session";
import type {
	OpenAiMessage,
	RoundLLMProvider,
	RoundTurnResult,
} from "../round-llm-provider";
import { encodeRoundResult } from "../round-result-encoder";
import type { OpenAiTool } from "../tool-registry";
import type { AiId, GameState } from "../types";
import { isObjectiveSatisfied } from "../win-condition";
import { TEST_PERSONAS } from "./fixtures/make-game-state";

const GAMES = 20;
const ROUNDS_PER_GAME = 40;
const SAVE_ROUND_TRIP_EVERY = 5;
const BASE_SEED = 0x5eed;

function mulberry32(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s += 0x6d2b79f5;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(rng: () => number, items: readonly T[]): T {
	return items[Math.floor(rng() * items.length)] as T;
}

function rawBinding(
	binding: DualBindingContentPackInput["phases"][number]["bindings"][number],
	index: number,
	suffix: string,
): RawBinding {
	const common = {
		examineDescription: `Something ${index} ${suffix}.`,
		proximityFlavor: `Something ${index} is near.`,
	};
	switch (binding.type) {
		case "carry":
			return {
				id: `carry-${index}`,
				type: "carry",
				object: {
					...common,
					id: binding.objectId ?? `carry-${index}-obj`,
					name: `relic ${index} ${suffix}`,
					useOutcome: "{actor} turns it over.",
					placementFlavor: "{actor} sets it down.",
				},
				space: {
					...common,
					id: binding.spaceId ?? `carry-${index}-space`,
					name: `plinth ${index} ${suffix}`,
				},
			};
		case "use_space":
			return {
				id: `useSpace-${index}`,
				type: "use_space",
				space: {
					...common,
					id: binding.spaceId ?? `useSpace-${index}-space`,
					name: `panel ${index} ${suffix}`,
					activationFlavor: "The panel wakes.",
					satisfactionFlavor: "The panel is awake.",
					postExamineDescription: "An awake panel.",
					postLookFlavor: "It hums.",
				},
			};
		case "convergence":
			return {
				id: `convergence-${index}`,
				type: "convergence",
				space: {
					...common,
					id: binding.spaceId ?? `convergence-${index}-space`,
					name: `circle ${index} ${suffix}`,
					convergenceTier1Flavor: "One stands in the circle.",
					convergenceTier2Flavor: "Two stand in the circle.",
					convergenceTier1ActorFlavor: "You stand in the circle.",
					convergenceTier2ActorFlavor: "The circle closes.",
				},
			};
		default:
			return {
				id: `useItem-${index}`,
				type: "use_item",
				item: {
					...common,
					id: binding.itemId ?? `useItem-${index}-item`,
					name: `switch ${index} ${suffix}`,
					useOutcome: "{actor} flicks it.",
					activationFlavor: "The switch clicks on.",
					postExamineDescription: "A switch, on.",
					postLookFlavor: "It glows.",
				},
			};
	}
}

const packProvider = new MockContentPackProvider((input) => ({
	phases: input.phases.map((phase) => {
		const variant = (setting: string, suffix: string): RawBoundPack => ({
			setting,
			wallName: `wall ${suffix}`,
			bindings: phase.bindings.map((b, i) => rawBinding(b, i, suffix)),
			decoys: phase.decoyIds.map((id, i) => ({
				id,
				name: i === 0 ? `lamp ${suffix}` : `Lamp ${suffix}`,
				examineDescription: "A lamp.",
				proximityFlavor: "A lamp is near.",
				useOutcome: "{actor} clicks the lamp.",
			})),
			obstacles: Array.from({ length: phase.obstacleCount }, (_, i) => ({
				id: `obstacle-${i}`,
				name: `crate ${i} ${suffix}`,
				examineDescription: "A crate.",
				shiftFlavor: "The crate slides.",
			})),
		});
		return {
			rawPackA: variant(phase.settingA, "A"),
			rawPackB: variant(phase.settingB, "B"),
		};
	}),
}));

interface OfferedCall {
	aiId: AiId;
	id: string;
	name: string;
}

function argumentsFor(tool: OpenAiTool, rng: () => number): string {
	const properties = (tool.function.parameters.properties ?? {}) as Record<
		string,
		{ enum?: string[] }
	>;
	const args: Record<string, string> = {};
	for (const [key, schema] of Object.entries(properties)) {
		args[key] = schema.enum ? pick(rng, schema.enum) : `fuzz ${rng()}`;
	}
	return JSON.stringify(args);
}

const JUNK_CALLS: ReadonlyArray<{ name: string; argumentsJson: string }> = [
	{ name: "go", argumentsJson: '{"direction":"forward"}' },
	{ name: "go", argumentsJson: '{"direction":"north"' },
	{ name: "pick_up", argumentsJson: '{"item":"nothing at all"}' },
	{ name: "use", argumentsJson: "{}" },
	{ name: "put_down", argumentsJson: '{"item":"lamp A"}' },
	{ name: "face", argumentsJson: '{"direction":"north"}' },
	{ name: "teleport", argumentsJson: '{"to":"moon"}' },
	{ name: "message", argumentsJson: '{"to":"nobody","content":"hi"}' },
	{ name: "message", argumentsJson: "not json" },
	{ name: "message", argumentsJson: '{"to":"blue"}' },
];

class FuzzProvider implements RoundLLMProvider {
	readonly offered: OfferedCall[] = [];
	readonly calledFor: AiId[] = [];
	readonly violations: string[] = [];

	constructor(
		private readonly rng: () => number,
		private readonly round: number,
	) {}

	async streamRound(
		messages: OpenAiMessage[],
		tools: OpenAiTool[],
		_onDelta?: (text: string) => void,
		daemonId?: string,
	): Promise<RoundTurnResult> {
		const aiId = daemonId as AiId;
		this.calledFor.push(aiId);
		this.checkToolCallPairing(aiId, messages);

		const rng = this.rng;
		const costUsd = rng() * 0.03;
		const shape = rng();
		if (shape < 0.1) return { assistantText: "", toolCalls: [], costUsd };
		if (shape < 0.2) {
			return { assistantText: "just talking", toolCalls: [], costUsd };
		}

		const toolCalls: RoundTurnResult["toolCalls"] = [];
		const messageTool = tools.find((t) => t.function.name === "message");
		const actionTools = tools.filter((t) => t.function.name !== "message");
		const offer = (tool: OpenAiTool) => {
			const id = `offered-r${this.round}-${aiId}-${toolCalls.length}`;
			this.offered.push({ aiId, id, name: tool.function.name });
			toolCalls.push({
				id,
				name: tool.function.name,
				argumentsJson: argumentsFor(tool, rng),
			});
		};
		if (messageTool && rng() < 0.6) offer(messageTool);
		if (actionTools.length > 0 && rng() < 0.8) offer(pick(rng, actionTools));

		const junkCount = Math.floor(rng() * 3);
		for (let i = 0; i < junkCount; i++) {
			const junk =
				rng() < 0.5 || tools.length === 0
					? pick(rng, JUNK_CALLS)
					: (() => {
							const tool = pick(rng, tools);
							return {
								name: tool.function.name,
								argumentsJson: argumentsFor(tool, rng),
							};
						})();
			toolCalls.push({ id: pick(rng, ["", "call_0", "dup"]), ...junk });
		}
		return { assistantText: "", toolCalls, costUsd };
	}

	private checkToolCallPairing(aiId: AiId, messages: OpenAiMessage[]) {
		const seen = new Set<string>();
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i];
			if (message?.role === "tool" && !seen.has(message.tool_call_id)) {
				this.violations.push(
					`${aiId}: tool result ${message.tool_call_id} has no preceding call`,
				);
			}
			if (message?.role !== "assistant" || !message.tool_calls) continue;
			message.tool_calls.forEach((call, offset) => {
				if (call.id === "") this.violations.push(`${aiId}: empty tool call id`);
				if (seen.has(call.id)) {
					this.violations.push(`${aiId}: duplicate tool call id ${call.id}`);
				}
				seen.add(call.id);
				const result = messages[i + 1 + offset];
				if (result?.role !== "tool" || result.tool_call_id !== call.id) {
					this.violations.push(
						`${aiId}: tool call ${call.id} is not followed by its result`,
					);
				}
			});
			const results = messages.filter(
				(m) =>
					m.role === "tool" &&
					message.tool_calls?.some((c) => c.id === m.tool_call_id),
			);
			if (results.length !== message.tool_calls.length) {
				this.violations.push(
					`${aiId}: ${message.tool_calls.length} calls but ${results.length} results`,
				);
			}
		}
	}
}

function obstacleCells(state: GameState): Set<number> {
	return new Set(
		state.world.entities
			.filter((e) => e.kind === "obstacle" && isGridPosition(e.holder))
			.map((e) => cellIndex(e.holder as GridPosition)),
	);
}

function worldViolations(state: GameState): string[] {
	const violations: string[] = [];
	const blocked = obstacleCells(state);
	for (const [aiId, spatial] of Object.entries(state.personaSpatial)) {
		if (!inBounds(spatial.position)) violations.push(`${aiId} out of bounds`);
		else if (blocked.has(cellIndex(spatial.position))) {
			violations.push(`${aiId} stands on an obstacle`);
		}
	}
	for (const entity of state.world.entities) {
		if (isGridPosition(entity.holder)) {
			if (!inBounds(entity.holder)) {
				violations.push(`${entity.id} out of bounds`);
			} else if (
				entity.kind !== "obstacle" &&
				blocked.has(cellIndex(entity.holder))
			) {
				violations.push(`${entity.id} rests on an obstacle`);
			}
		} else if (
			entity.kind === "obstacle" ||
			entity.kind === "objective_space" ||
			!(entity.holder in state.personas)
		) {
			violations.push(`${entity.id} held by ${entity.holder}`);
		} else if (state.exhausted.has(entity.holder)) {
			violations.push(`${entity.id} held by exhausted ${entity.holder}`);
		}
	}
	const ids = state.world.entities.map((e) => e.id);
	if (new Set(ids).size !== ids.length) violations.push("duplicate entity ids");
	const obstacleCount = state.world.entities.filter(
		(e) => e.kind === "obstacle",
	).length;
	if (blocked.size !== obstacleCount) violations.push("obstacles share a cell");
	const open = Array.from({ length: TOTAL_CELLS }, (_, i) => i).filter(
		(i) => !blocked.has(i),
	);
	const firstOpen = open[0];
	if (
		firstOpen !== undefined &&
		!everyOpenCellReachable([cellAtIndex(firstOpen)], blocked)
	) {
		violations.push("grid is not connected");
	}
	return violations;
}

function offeredCallViolations(
	state: GameState,
	offered: OfferedCall[],
): string[] {
	const violations: string[] = [];
	for (const call of offered) {
		const log = state.conversationLogs[call.aiId] ?? [];
		if (call.name === "message") {
			const delivered = log.some(
				(e) => e.kind === "message" && e.toolCallId === call.id,
			);
			if (!delivered) {
				violations.push(`${call.aiId}: offered message ${call.id} failed`);
			}
			continue;
		}
		const entry = log.find(
			(e) => e.kind === "tool-call" && e.toolCallId === call.id,
		);
		if (entry?.kind !== "tool-call" || !entry.success) {
			violations.push(
				`${call.aiId}: offered ${call.name} ${call.id} failed: ${entry?.kind === "tool-call" ? entry.result : "no entry"}`,
			);
		}
	}
	return violations;
}

async function playGame(
	seed: number,
	stormy: boolean,
): Promise<{ rounds: number }> {
	const packRng = mulberry32(seed);
	const gameRng = mulberry32(seed ^ 0x9e3779b9);
	const llmRng = mulberry32(seed ^ 0x85ebca6b);
	vi.spyOn(Math, "random").mockImplementation(gameRng);

	const aiIds = Object.keys(TEST_PERSONAS);
	const { packA, packB, objectiveTypes } = await generateDualContentPacks(
		packRng,
		SETTING_POOL,
		SINGLE_GAME_CONFIG,
		packProvider,
		aiIds,
	);
	let session = new GameSession(
		packA,
		TEST_PERSONAS,
		[packA],
		[packB],
		gameRng,
		objectiveTypes,
	);
	const sessionId = `fuzz-${seed}`;
	const lockedInUi = new Set<AiId>();
	const satisfiedObjectives = new Set<string>();
	const where = (round: number) =>
		`seed ${seed}${stormy ? " (stormy)" : ""}, round ${round}`;

	let round = 0;
	for (; round < ROUNDS_PER_GAME; round++) {
		if (stormy && llmRng() < 0.6) {
			const state = session.getState();
			session = GameSession.restore({
				...state,
				complicationSchedule: { ...state.complicationSchedule, countdown: 1 },
			});
		}
		const before = session.getState();
		if (before.isComplete) break;
		const exhaustedBefore = new Set(before.exhausted);
		const provider = new FuzzProvider(llmRng, round);
		const addressed = pick(llmRng, aiIds);

		const { result, nextState } = await session.submitMessage(
			addressed,
			`hello ${round}`,
			provider,
		);

		expect(provider.violations, where(round)).toEqual([]);
		expect(worldViolations(nextState), where(round)).toEqual([]);
		expect(
			offeredCallViolations(nextState, provider.offered),
			where(round),
		).toEqual([]);
		expect(
			provider.calledFor.filter((id) => exhaustedBefore.has(id)),
			`${where(round)}: exhausted Daemons were prompted`,
		).toEqual([]);
		expect(
			result.actions.filter(
				(a) => exhaustedBefore.has(a.actor) && a.kind !== "lockout",
			),
			`${where(round)}: exhausted Daemons acted`,
		).toEqual([]);

		for (const objective of nextState.objectives) {
			if (isObjectiveSatisfied(objective, nextState.world)) {
				satisfiedObjectives.add(objective.id);
			} else {
				expect(
					satisfiedObjectives.has(objective.id),
					`${where(round)}: objective ${objective.id} un-satisfied`,
				).toBe(false);
			}
		}

		for (const event of encodeRoundResult(
			result,
			nextState,
			nextState.personas,
		)) {
			if (event.type === "chat_lockout") lockedInUi.add(event.aiId);
			if (event.type === "chat_lockout_resolved") lockedInUi.delete(event.aiId);
		}
		for (const aiId of aiIds) {
			expect(
				lockedInUi.has(aiId),
				`${where(round)}: UI chat lockout for ${aiId}`,
			).toBe(isPlayerChatLockedOut(nextState, aiId));
		}

		if ((round + 1) % SAVE_ROUND_TRIP_EVERY === 0) {
			expect(saveActiveSession(nextState, { sessionId }).ok, where(round)).toBe(
				true,
			);
			const loaded = loadSession(sessionId);
			expect(loaded.kind, where(round)).toBe("ok");
			if (loaded.kind === "ok") {
				expect(loaded.state, `${where(round)}: save round-trip`).toEqual(
					nextState,
				);
			}
		}
	}
	return { rounds: round };
}

describe("round fuzz", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
	});

	it(`keeps the round invariants over ${GAMES} seeded games`, async () => {
		let totalRounds = 0;
		for (let game = 0; game < GAMES; game++) {
			const { rounds } = await playGame(BASE_SEED + game, game % 2 === 1);
			totalRounds += rounds;
			vi.restoreAllMocks();
		}
		expect(totalRounds).toBeGreaterThan(GAMES * 5);
	});
});
