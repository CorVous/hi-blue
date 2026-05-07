/**
 * Integration tests for generateContentPacks (AC #12).
 *
 * Uses a seeded RNG + MockContentPackProvider to exercise the real placement
 * engine and assert every placement constraint individually.
 */

import { describe, expect, it } from "vitest";
import type {
	ContentPackProviderInput,
	ContentPackProviderResult,
} from "../../spa/game/content-pack-provider.js";
import { MockContentPackProvider } from "../../spa/game/content-pack-provider.js";
import type { PhaseConfig } from "../../spa/game/types.js";
import { generateContentPacks } from "../content-pack-generator.js";

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
const FIXED_PHASE_CONFIGS: [PhaseConfig, PhaseConfig, PhaseConfig] = [
	{
		phaseNumber: 1,
		kRange: [1, 1],
		nRange: [1, 1],
		mRange: [1, 1],
		budgetPerAi: 5,
		aiGoalPool: ["find the key"],
	},
	{
		phaseNumber: 2,
		kRange: [1, 1],
		nRange: [1, 1],
		mRange: [1, 1],
		budgetPerAi: 5,
		aiGoalPool: ["guard the door"],
	},
	{
		phaseNumber: 3,
		kRange: [1, 1],
		nRange: [1, 1],
		mRange: [1, 1],
		budgetPerAi: 5,
		aiGoalPool: ["solve the puzzle"],
	},
];

const SETTING_POOL_6: readonly string[] = [
	"abandoned subway station",
	"sun-baked salt flat",
	"forgotten laboratory",
	"moonlit greenhouse ruin",
	"stripped server vault",
	"tide-flooded boardwalk",
];

const AI_IDS = ["red", "green", "blue"];

// ── MockContentPackProvider factory ──────────────────────────────────────────

/**
 * Build a MockContentPackProvider that returns exactly the entity counts
 * requested (k=1, n=1, m=1) with well-formed data.
 * All placementFlavor strings contain "{actor}" as required.
 */
function makeMockProvider(): MockContentPackProvider {
	return new MockContentPackProvider(
		(input: ContentPackProviderInput): ContentPackProviderResult => {
			const packs: ContentPackProviderResult["packs"] = input.phases.map(
				(phase) => {
					const phaseNumber = phase.phaseNumber;
					const spaceId = `p${phaseNumber}_space`;
					const objId = `p${phaseNumber}_obj`;
					const interestingId = `p${phaseNumber}_interesting`;
					const obstacleId = `p${phaseNumber}_obstacle`;

					return {
						phaseNumber,
						setting: phase.setting,
						objectivePairs: Array.from({ length: phase.k }, (_, i) => ({
							space: {
								id: `${spaceId}_${i}`,
								kind: "objective_space" as const,
								name: `Space ${phaseNumber} ${i}`,
								examineDescription: `A space in phase ${phaseNumber}.`,
								holder: { row: 0, col: 0 } as never,
							},
							object: {
								id: `${objId}_${i}`,
								kind: "objective_object" as const,
								name: `Object ${phaseNumber} ${i}`,
								examineDescription: `An object in phase ${phaseNumber} that belongs on Space ${phaseNumber} ${i}.`,
								useOutcome: `You use object ${phaseNumber} ${i}.`,
								pairsWithSpaceId: `${spaceId}_${i}`,
								placementFlavor: `{actor} places the object on the space in phase ${phaseNumber}.`,
								holder: { row: 0, col: 0 } as never,
							},
						})),
						interestingObjects: Array.from({ length: phase.n }, (_, i) => ({
							id: `${interestingId}_${i}`,
							kind: "interesting_object" as const,
							name: `Interesting ${phaseNumber} ${i}`,
							examineDescription: `Something interesting in phase ${phaseNumber}.`,
							useOutcome: `You interact with interesting ${phaseNumber} ${i}.`,
							holder: { row: 0, col: 0 } as never,
						})),
						obstacles: Array.from({ length: phase.m }, (_, i) => ({
							id: `${obstacleId}_${i}`,
							kind: "obstacle" as const,
							name: `Obstacle ${phaseNumber} ${i}`,
							examineDescription: `An impassable obstacle in phase ${phaseNumber}.`,
							holder: { row: 0, col: 0 } as never,
						})),
						aiStarts: {} as Record<string, never>,
					};
				},
			);
			return { packs };
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

		for (const pack of packs) {
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
					`Phase ${pack.phaseNumber}: AI ${aiId} start is on an obstacle`,
				).toBe(false);
			}

			// 2. For every objective pair, object.holder ≠ space.holder
			for (const pair of pack.objectivePairs) {
				const objPos = pair.object.holder as { row: number; col: number };
				const spacePos = pair.space.holder as { row: number; col: number };
				expect(
					gridPosKey(objPos) === gridPosKey(spacePos),
					`Phase ${pack.phaseNumber}: objective object ${pair.object.id} is on its paired space`,
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
					`Phase ${pack.phaseNumber}: entity ${entity.id} (${entity.kind}) is on an obstacle`,
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
						`Phase ${pack.phaseNumber}: cell ${cell} not reachable from AI ${aiId} start`,
					).toBe(true);
				}
			}

			// 5. Each AI's facing is a cardinal direction
			for (const [aiId, spatial] of Object.entries(pack.aiStarts)) {
				expect(
					CARDINAL.has(spatial.facing),
					`Phase ${pack.phaseNumber}: AI ${aiId} has non-cardinal facing "${spatial.facing}"`,
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
					`Phase ${pack.phaseNumber}: object ${pair.object.id} missing placementFlavor`,
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
				phaseNumber: 1,
				// k=0, n=0, m=23 → only 2 non-obstacle cells for 3 AI starts → impossible
				kRange: [0, 0],
				nRange: [0, 0],
				mRange: [23, 23],
				budgetPerAi: 5,
				aiGoalPool: ["survive"],
			},
			{
				phaseNumber: 2,
				kRange: [0, 0],
				nRange: [0, 0],
				mRange: [23, 23],
				budgetPerAi: 5,
				aiGoalPool: ["survive"],
			},
			{
				phaseNumber: 3,
				kRange: [0, 0],
				nRange: [0, 0],
				mRange: [23, 23],
				budgetPerAi: 5,
				aiGoalPool: ["survive"],
			},
		];

		const rng = seededRng(42);

		const impossibleProvider = new MockContentPackProvider(
			(input: ContentPackProviderInput): ContentPackProviderResult => ({
				packs: input.phases.map((phase) => ({
					phaseNumber: phase.phaseNumber,
					setting: phase.setting,
					objectivePairs: [],
					interestingObjects: [],
					obstacles: Array.from({ length: phase.m }, (_, i) => ({
						id: `obstacle_p${phase.phaseNumber}_${i}`,
						kind: "obstacle" as const,
						name: `Obstacle ${i}`,
						examineDescription: "An impassable obstacle.",
						holder: { row: 0, col: 0 } as never,
					})),
					aiStarts: {} as Record<string, never>,
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
