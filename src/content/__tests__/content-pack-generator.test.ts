/**
 * Integration tests for generateContentPacks (AC #12).
 *
 * Uses a seeded RNG + MockContentPackProvider to exercise the real placement
 * engine and assert every placement constraint individually.
 */

import { describe, expect, it } from "vitest";
import type {
	BindingContentPackInput,
	BindingContentPackProviderResult,
	DualBindingContentPackInput,
	DualBindingContentPackProviderResult,
} from "../../spa/game/content-pack-provider.js";
import { MockContentPackProvider } from "../../spa/game/content-pack-provider.js";
import { DEFAULT_LANDMARKS } from "../../spa/game/direction.js";
import type { ContentPack } from "../../spa/game/types.js";
import type { RawBoundPack, RawBinding } from "../../spa/game/binding-aware-validator.js";
import {
	generateContentPacks,
	generateDualContentPacks,
	type PhaseConfig,
} from "../content-pack-generator.js";

// ── Seeded RNG ────────────────────────────────────────────────────────────────

/** Mulberry32 PRNG — returns a function that yields floats in [0, 1). */
function seededRng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s += 0x6d2b79f5;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ── Constants (must match content-pack-generator.ts internals) ────────────────

const GRID_ROWS = 5;
const GRID_COLS = 5;
const CARDINAL = new Set(["north", "south", "east", "west"]);

// ── Fixed phase configs for tests ─────────────────────────────────────────────

/** Minimal k=1, n=1, m=1 — stays well within the 5x5 grid. */
const FIXED_PHASE_CONFIG: PhaseConfig = {
	kRange: [1, 1],
	nRange: [1, 1],
	mRange: [1, 1],
	budgetPerAi: 5,
	aiGoalPool: ["find the key"],
};

/** Three-phase config array for generateContentPacks tests. */
const FIXED_PHASE_CONFIGS: [PhaseConfig, PhaseConfig, PhaseConfig] = [
	FIXED_PHASE_CONFIG,
	FIXED_PHASE_CONFIG,
	FIXED_PHASE_CONFIG,
];

const SETTING_POOL_6: readonly string[] = [
	"abandoned subway station",
	"sun-baked salt flat",
	"forgotten laboratory",
	"moonlit greenhouse ruin",
	"stripped server vault",
	"tide-flooded boardwalk",
];

const SETTING_POOL_2: readonly string[] = [
	"abandoned subway station",
	"sun-baked salt flat",
];

const AI_IDS = ["red", "green", "cyan"];

// ── MockContentPackProvider factory ──────────────────────────────────────────

/**
 * Build a raw binding from a skeleton binding (given the bindings in the input).
 */
function makeRawBinding(binding: BindingContentPackInput["phases"][number]["bindings"][number], phaseIdx: number, bindingIdx: number): RawBinding {
	switch (binding.type) {
		case "carry":
			return {
				id: `carry-${bindingIdx}`,
				type: "carry",
				object: {
					id: binding.objectId ?? `carry-${bindingIdx}-obj`,
					name: `Carry Object p${phaseIdx + 1}-${bindingIdx}`,
					examineDescription: `An object in phase ${phaseIdx + 1} that belongs on Carry Space p${phaseIdx + 1}-${bindingIdx}.`,
					useOutcome: `You use the carry object.`,
					placementFlavor: `{actor} places the carry object on its space.`,
					proximityFlavor: `The carry object hums near its space.`,
				},
				space: {
					id: binding.spaceId ?? `carry-${bindingIdx}-space`,
					name: `Carry Space p${phaseIdx + 1}-${bindingIdx}`,
					examineDescription: `A carry destination space in phase ${phaseIdx + 1}.`,
					proximityFlavor: `The carry space emanates a faint pull.`,
				},
			};
		case "use_space":
			return {
				id: `useSpace-${bindingIdx}`,
				type: "use_space",
				space: {
					id: binding.spaceId ?? `useSpace-${bindingIdx}-space`,
					name: `Use Space p${phaseIdx + 1}-${bindingIdx}`,
					examineDescription: `A panel with a button to press in phase ${phaseIdx + 1}.`,
					proximityFlavor: `The use space glows faintly.`,
					activationFlavor: `The panel activates.`,
					satisfactionFlavor: `The panel has been activated.`,
					postExamineDescription: `The panel is now active.`,
					postLookFlavor: `The panel glows steadily.`,
				},
			};
		case "convergence":
			return {
				id: `convergence-${bindingIdx}`,
				type: "convergence",
				space: {
					id: binding.spaceId ?? `convergence-${bindingIdx}-space`,
					name: `Convergence Space p${phaseIdx + 1}-${bindingIdx}`,
					examineDescription: `A meeting place where two are needed in phase ${phaseIdx + 1}.`,
					proximityFlavor: `The convergence space awaits company.`,
					convergenceTier1Flavor: `A daemon stands here alone.`,
					convergenceTier2Flavor: `Two daemons share this space.`,
					convergenceTier1ActorFlavor: `You stand here alone, waiting.`,
					convergenceTier2ActorFlavor: `You feel the convergence complete.`,
				},
			};
		case "use_item":
			return {
				id: `useItem-${bindingIdx}`,
				type: "use_item",
				item: {
					id: binding.itemId ?? `useItem-${bindingIdx}-item`,
					name: `Use Item p${phaseIdx + 1}-${bindingIdx}`,
					examineDescription: `An item with a switch to activate in phase ${phaseIdx + 1}.`,
					proximityFlavor: `The use item sits nearby.`,
					useOutcome: `You use the item.`,
					activationFlavor: `The item activates.`,
					postExamineDescription: `The item is now used.`,
					postLookFlavor: `The item glows.`,
				},
			};
	}
}

/**
 * Build a MockContentPackProvider that returns binding-shaped packs based on
 * the input binding schedule. Well-formed data for placement constraint tests.
 */
function makeMockProvider(): MockContentPackProvider {
	return new MockContentPackProvider(
		(input: BindingContentPackInput): BindingContentPackProviderResult => {
			const phases = input.phases.map((phase, phaseIdx) => {
				const bindings: RawBinding[] = phase.bindings.map((binding, bindingIdx) =>
					makeRawBinding(binding, phaseIdx, bindingIdx)
				);

				const rawPack: RawBoundPack = {
					setting: phase.setting,
					wallName: "wall",
					landmarks: DEFAULT_LANDMARKS as unknown as undefined,
					bindings,
					decoys: [
						{
							id: "decoy-0",
							name: `Decoy 0 p${phaseIdx + 1}`,
							examineDescription: `A plain item in phase ${phaseIdx + 1}.`,
							proximityFlavor: `A decoy sits nearby.`,
							useOutcome: `Nothing happens.`,
						},
						{
							id: "decoy-1",
							name: `Decoy 1 p${phaseIdx + 1}`,
							examineDescription: `Another plain item in phase ${phaseIdx + 1}.`,
							proximityFlavor: `Another decoy sits nearby.`,
							useOutcome: `Nothing happens.`,
						},
					],
					obstacles: Array.from({ length: phase.obstacleCount }, (_, i) => ({
						id: `obstacle-${i}`,
						name: `Obstacle ${i} p${phaseIdx + 1}`,
						examineDescription: `An impassable obstacle in phase ${phaseIdx + 1}.`,
						shiftFlavor: `The obstacle shifts.`,
					})),
				};
				return { rawPack };
			});
			return { phases };
		},
	);
}

// ── BFS reachability helper ───────────────────────────────────────────────────

function posKey(row: number, col: number): number {
	return row * GRID_COLS + col;
}

function bfsReachable(
	startRow: number,
	startCol: number,
	obstacleKeys: Set<number>,
): Set<number> {
	const start = posKey(startRow, startCol);
	const visited = new Set<number>([start]);
	const queue = [start];

	while (queue.length > 0) {
		const cur = queue.shift() as number;
		const row = Math.floor(cur / GRID_COLS);
		const col = cur % GRID_COLS;
		const neighbors = [
			[row - 1, col],
			[row + 1, col],
			[row, col - 1],
			[row, col + 1],
		];
		for (const [nr, nc] of neighbors) {
			if (nr == null || nc == null) continue;
			if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
			const nk = posKey(nr, nc);
			if (obstacleKeys.has(nk)) continue;
			if (visited.has(nk)) continue;
			visited.add(nk);
			queue.push(nk);
		}
	}
	return visited;
}

function gridPosKey(pos: { row: number; col: number }): number {
	return posKey(pos.row, pos.col);
}

// ── Main integration tests ────────────────────────────────────────────────────

describe("generateContentPacks — placement constraints", () => {
	it("returns 3 packs with distinct settings and makes exactly 1 LLM call", async () => {
		const rng = seededRng(42);
		const mockProvider = makeMockProvider();

		const packs = await generateContentPacks(
			rng,
			SETTING_POOL_6,
			FIXED_PHASE_CONFIGS,
			mockProvider,
			AI_IDS,
		);

		expect(packs).toHaveLength(3);
		expect(new Set(packs.map((p) => p.setting)).size).toBe(3);
		expect(mockProvider.calls).toHaveLength(1);
	});

	it("all placement constraints hold for each phase (seed=42)", async () => {
		const rng = seededRng(42);
		const mockProvider = makeMockProvider();

		const packs = await generateContentPacks(
			rng,
			SETTING_POOL_6,
			FIXED_PHASE_CONFIGS,
			mockProvider,
			AI_IDS,
		);

		for (let packIdx = 0; packIdx < packs.length; packIdx++) {
			const pack = packs[packIdx] as ContentPack;
			// Build obstacle set
			const obstacleKeys = new Set(
				pack.obstacles.map((obs) => {
					const pos = obs.holder as { row: number; col: number };
					return gridPosKey(pos);
				}),
			);

			// 1. Every AI start is NOT on an obstacle
			for (const [aiId, spatial] of Object.entries(pack.aiStarts)) {
				const key = gridPosKey(spatial.position);
				expect(
					obstacleKeys.has(key),
					`Pack ${packIdx}: AI ${aiId} start is on an obstacle`,
				).toBe(false);
			}

			// 2. For every objective pair, object.holder ≠ space.holder
			for (const pair of pack.objectivePairs) {
				const objPos = pair.object.holder as { row: number; col: number };
				const spacePos = pair.space.holder as { row: number; col: number };
				expect(
					gridPosKey(objPos) === gridPosKey(spacePos),
					`Pack ${packIdx}: objective object ${pair.object.id} is on its paired space`,
				).toBe(false);
			}

			// 3. No non-obstacle entity shares a cell with an obstacle
			const allNonObstacleEntities = [
				...pack.objectivePairs.flatMap((p) => [p.object, p.space]),
				...pack.interestingObjects,
			];
			for (const entity of allNonObstacleEntities) {
				const pos = entity.holder as { row: number; col: number };
				const key = gridPosKey(pos);
				expect(
					obstacleKeys.has(key),
					`Pack ${packIdx}: entity ${entity.id} (${entity.kind}) is on an obstacle`,
				).toBe(false);
			}

			// 4. BFS reachability: every non-obstacle cell is reachable from every AI start
			const nonObstacleCells = new Set<number>();
			for (let r = 0; r < GRID_ROWS; r++) {
				for (let c = 0; c < GRID_COLS; c++) {
					const k = posKey(r, c);
					if (!obstacleKeys.has(k)) nonObstacleCells.add(k);
				}
			}
			for (const [aiId, spatial] of Object.entries(pack.aiStarts)) {
				const reachable = bfsReachable(
					spatial.position.row,
					spatial.position.col,
					obstacleKeys,
				);
				for (const cell of nonObstacleCells) {
					expect(
						reachable.has(cell),
						`Pack ${packIdx}: cell ${cell} not reachable from AI ${aiId} start`,
					).toBe(true);
				}
			}

			// 5. Each AI's facing is a cardinal direction
			for (const [aiId, spatial] of Object.entries(pack.aiStarts)) {
				expect(
					CARDINAL.has(spatial.facing),
					`Pack ${packIdx}: AI ${aiId} has non-cardinal facing "${spatial.facing}"`,
				).toBe(true);
			}

			// 6. pairsWithSpaceId links
			for (const pair of pack.objectivePairs) {
				expect(pair.object.pairsWithSpaceId).toBe(pair.space.id);
			}

			// 7. placementFlavor contains "{actor}"
			for (const pair of pack.objectivePairs) {
				expect(
					pair.object.placementFlavor,
					`Pack ${packIdx}: object ${pair.object.id} missing placementFlavor`,
				).toBeTruthy();
				expect(pair.object.placementFlavor).toContain("{actor}");
			}

			// 8. useOutcome and examineDescription are non-empty
			for (const pair of pack.objectivePairs) {
				expect(pair.object.useOutcome).toBeTruthy();
				expect(pair.object.examineDescription).toBeTruthy();
				expect(pair.space.examineDescription).toBeTruthy();
			}
			for (const obj of pack.interestingObjects) {
				expect(obj.useOutcome).toBeTruthy();
				expect(obj.examineDescription).toBeTruthy();
			}

			// 9. All four horizon landmarks are present, non-empty, and distinct
			const dirs = ["north", "south", "east", "west"] as const;
			for (const dir of dirs) {
				const lm = pack.landmarks[dir];
				expect(
					lm.shortName,
					`Pack ${packIdx}: landmarks.${dir}.shortName missing`,
				).toBeTruthy();
				expect(
					lm.horizonPhrase,
					`Pack ${packIdx}: landmarks.${dir}.horizonPhrase missing`,
				).toBeTruthy();
			}
			// All four shortNames should be distinct (the mock returns DEFAULT_LANDMARKS
			// which has four different shortNames)
			const shortNames = dirs.map((d) => pack.landmarks[d].shortName);
			expect(new Set(shortNames).size).toBe(4);
		}
	});

	it("constraints hold across multiple seeds", async () => {
		const seeds = [0, 1, 7, 13, 99, 12345, 0xdeadbeef];

		for (const seed of seeds) {
			const rng = seededRng(seed);
			const mockProvider = makeMockProvider();

			const packs = await generateContentPacks(
				rng,
				SETTING_POOL_6,
				FIXED_PHASE_CONFIGS,
				mockProvider,
				AI_IDS,
			);

			expect(packs).toHaveLength(3);
			// Distinct settings
			expect(
				new Set(packs.map((p) => p.setting)).size,
				`seed=${seed}: expected 3 distinct settings`,
			).toBe(3);
		}
	});

	it("draws 3 distinct settings from a pool of 6 across many seeds", async () => {
		const seeds = [0, 1, 2, 3, 4, 5, 10, 20, 50, 100];

		for (const seed of seeds) {
			const rng = seededRng(seed);
			const mockProvider = makeMockProvider();
			const packs = await generateContentPacks(
				rng,
				SETTING_POOL_6,
				FIXED_PHASE_CONFIGS,
				mockProvider,
				AI_IDS,
			);
			expect(
				new Set(packs.map((p) => p.setting)).size,
				`seed=${seed}: settings not distinct`,
			).toBe(3);
		}
	});
});

// ── Degenerate config test ────────────────────────────────────────────────────

describe("generateContentPacks — degenerate config throws after MAX_ATTEMPTS", () => {
	it("throws when m is so large that no valid placement exists", async () => {
		// A 5x5 grid has 25 cells. With 3 AI starts, we need at least 3 non-obstacle cells.
		// Setting m=23 leaves only 2 non-obstacle cells, which is fewer than the 3 AI starts.
		// This makes placement impossible.
		const impossibleConfigs: [PhaseConfig, PhaseConfig, PhaseConfig] = [
			{
				// k=0, n=0, m=23 → only 2 non-obstacle cells for 3 AI starts → impossible
				kRange: [0, 0],
				nRange: [0, 0],
				mRange: [23, 23],
				budgetPerAi: 5,
				aiGoalPool: ["survive"],
			},
			{
				kRange: [0, 0],
				nRange: [0, 0],
				mRange: [23, 23],
				budgetPerAi: 5,
				aiGoalPool: ["survive"],
			},
			{
				kRange: [0, 0],
				nRange: [0, 0],
				mRange: [23, 23],
				budgetPerAi: 5,
				aiGoalPool: ["survive"],
			},
		];

		const rng = seededRng(42);

		const impossibleProvider = new MockContentPackProvider(
			(input: BindingContentPackInput): BindingContentPackProviderResult => ({
				phases: input.phases.map((phase, phaseIdx) => ({
					rawPack: {
						setting: phase.setting,
						wallName: "wall",
						landmarks: DEFAULT_LANDMARKS as unknown as undefined,
						bindings: [],
						decoys: [
							{ id: "decoy-0", name: "Decoy 0", examineDescription: "A plain item.", proximityFlavor: "A decoy.", useOutcome: "Nothing." },
							{ id: "decoy-1", name: "Decoy 1", examineDescription: "Another plain item.", proximityFlavor: "Another decoy.", useOutcome: "Nothing." },
						],
						obstacles: Array.from({ length: phase.obstacleCount }, (_, i) => ({
							id: `obstacle-${i}`,
							name: `Obstacle ${i}`,
							examineDescription: "An impassable obstacle.",
							shiftFlavor: `The obstacle ${phaseIdx} shifts.`,
						})),
					},
				})),
			}),
		);

		await expect(
			generateContentPacks(
				rng,
				SETTING_POOL_6,
				impossibleConfigs,
				impossibleProvider,
				AI_IDS,
			),
		).rejects.toThrow(/could not place phase/);
	});
});

// ── generateDualContentPacks — entity ID parity (issue #302) ──────────────────

/** Build a dual-pack MockContentPackProvider for entity ID parity tests. */
function makeDualMockProvider(): MockContentPackProvider {
	return new MockContentPackProvider(
		(_input: BindingContentPackInput): BindingContentPackProviderResult => ({
			phases: [],
		}),
		(input: DualBindingContentPackInput): DualBindingContentPackProviderResult => {
			const phases = input.phases.map((phase, phaseIdx) => {
				const makeRawPackVariant = (setting: string, suffix: string): RawBoundPack => {
					const bindings: RawBinding[] = phase.bindings.map((binding, bindingIdx) => {
						const raw = makeRawBinding(binding, phaseIdx, bindingIdx);
						// Re-flavor names for this variant
						if (raw.object) raw.object = { ...raw.object, name: `${raw.object.name} ${suffix}` };
						if (raw.space) raw.space = { ...raw.space, name: `${raw.space.name} ${suffix}` };
						if (raw.item) raw.item = { ...raw.item, name: `${raw.item.name} ${suffix}` };
						return raw;
					});
					return {
						setting,
						wallName: `wall ${suffix}`,
						landmarks: DEFAULT_LANDMARKS as unknown as undefined,
						bindings,
						decoys: [
							{ id: "decoy-0", name: `Decoy 0 ${suffix}`, examineDescription: `A plain item (${suffix}).`, proximityFlavor: `A decoy.`, useOutcome: `Nothing.` },
							{ id: "decoy-1", name: `Decoy 1 ${suffix}`, examineDescription: `Another plain item (${suffix}).`, proximityFlavor: `Another decoy.`, useOutcome: `Nothing.` },
						],
						obstacles: Array.from({ length: phase.obstacleCount }, (_, i) => ({
							id: `obstacle-${i}`,
							name: `Obstacle ${i} ${suffix}`,
							examineDescription: `An obstacle (${suffix}).`,
							shiftFlavor: `The obstacle shifts.`,
						})),
					};
				};

				return {
					rawPackA: makeRawPackVariant(phase.settingA, "A"),
					rawPackB: makeRawPackVariant(phase.settingB, "B"),
				};
			});
			return { phases };
		},
	);
}

/** Extract all entity IDs from a ContentPack. */
function allEntityIds(pack: ContentPack): string[] {
	return [
		...pack.objectivePairs.flatMap((p) => [p.object.id, p.space.id]),
		...(pack.boundSpaces ?? []).map((e) => e.id),
		...pack.interestingObjects.map((e) => e.id),
		...pack.obstacles.map((e) => e.id),
	].sort();
}

describe("generateDualContentPacks — entity ID parity (issue #302)", () => {
	it("produces packA and packB with identical entity IDs", async () => {
		const rng = seededRng(99);
		const provider = makeDualMockProvider();

		const { packA, packB } = await generateDualContentPacks(
			rng,
			SETTING_POOL_2,
			FIXED_PHASE_CONFIG,
			provider,
			AI_IDS,
		);

		expect(allEntityIds(packA)).toEqual(allEntityIds(packB));
	});

	it("Pack A and Pack B have different settings", async () => {
		const rng = seededRng(99);
		const provider = makeDualMockProvider();

		const { packA, packB } = await generateDualContentPacks(
			rng,
			SETTING_POOL_2,
			FIXED_PHASE_CONFIG,
			provider,
			AI_IDS,
		);

		expect(packA.setting).not.toBe(packB.setting);
	});

	it("Pack B entities have the same holder positions as Pack A (placement parity)", async () => {
		const rng = seededRng(99);
		const provider = makeDualMockProvider();

		const { packA, packB } = await generateDualContentPacks(
			rng,
			SETTING_POOL_2,
			FIXED_PHASE_CONFIG,
			provider,
			AI_IDS,
		);

		// Build ID→holder map for A
		const holdersA = new Map<string, unknown>();
		for (const pair of packA.objectivePairs) {
			holdersA.set(pair.object.id, pair.object.holder);
			holdersA.set(pair.space.id, pair.space.holder);
		}
		for (const e of packA.boundSpaces ?? []) holdersA.set(e.id, e.holder);
		for (const e of packA.interestingObjects) holdersA.set(e.id, e.holder);
		for (const e of packA.obstacles) holdersA.set(e.id, e.holder);

		// Verify B holders match A holders by entity ID
		for (const pair of packB.objectivePairs) {
			expect(pair.object.holder).toEqual(holdersA.get(pair.object.id));
			expect(pair.space.holder).toEqual(holdersA.get(pair.space.id));
		}
		for (const e of packB.boundSpaces ?? []) {
			expect(e.holder).toEqual(holdersA.get(e.id));
		}
		for (const e of packB.interestingObjects) {
			expect(e.holder).toEqual(holdersA.get(e.id));
		}
		for (const e of packB.obstacles) {
			expect(e.holder).toEqual(holdersA.get(e.id));
		}
	});

	it("makes exactly one LLM call for the dual packs", async () => {
		const rng = seededRng(99);
		const provider = makeDualMockProvider();

		await generateDualContentPacks(
			rng,
			SETTING_POOL_2,
			FIXED_PHASE_CONFIG,
			provider,
			AI_IDS,
		);

		expect(provider.dualCalls).toHaveLength(1);
		expect(provider.calls).toHaveLength(0);
	});

	it("throws when settings pool has fewer than 2 entries", async () => {
		const rng = seededRng(99);
		const provider = makeDualMockProvider();

		await expect(
			generateDualContentPacks(
				rng,
				["only one setting"],
				FIXED_PHASE_CONFIG,
				provider,
				AI_IDS,
			),
		).rejects.toThrow(
			/generateDualContentPacks: setting pool must have at least 2 entries/,
		);
	});
});
