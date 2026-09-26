import { describe, expect, it } from "vitest";
import type {
	RawBinding,
	RawBoundPack,
} from "../../spa/game/binding-aware-validator.js";
import type {
	BindingContentPackInput,
	BindingContentPackProviderResult,
	DualBindingContentPackInput,
	DualBindingContentPackProviderResult,
} from "../../spa/game/content-pack-provider.js";
import { MockContentPackProvider } from "../../spa/game/content-pack-provider.js";
import { isGridPosition } from "../../spa/game/direction.js";
import { carryPairs, obstacles } from "../../spa/game/pack-selectors.js";
import type {
	ContentPack,
	GridPosition,
	WorldEntity,
} from "../../spa/game/types.js";
import {
	generateDualContentPacks,
	type SingleGameConfig,
} from "../content-pack-generator.js";

function mulberry32Rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s += 0x6d2b79f5;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const ONE_OBSTACLE_CONFIG: SingleGameConfig = {
	mRange: [1, 1],
};

const SETTING_POOL_2: readonly string[] = [
	"abandoned subway station",
	"sun-baked salt flat",
];

const AI_IDS = ["red", "green", "cyan"];

function makeRawBinding(
	binding: BindingContentPackInput["phases"][number]["bindings"][number],
	phaseIdx: number,
	bindingIdx: number,
): RawBinding {
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

function makeDualMockProvider(): MockContentPackProvider {
	return new MockContentPackProvider(
		(_input: BindingContentPackInput): BindingContentPackProviderResult => ({
			phases: [],
		}),
		(
			input: DualBindingContentPackInput,
		): DualBindingContentPackProviderResult => {
			const phases = input.phases.map((phase, phaseIdx) => {
				const makeRawPackVariant = (
					setting: string,
					suffix: string,
				): RawBoundPack => {
					const bindings: RawBinding[] = phase.bindings.map(
						(binding, bindingIdx) => {
							const raw = makeRawBinding(binding, phaseIdx, bindingIdx);
							if (raw.object)
								raw.object = {
									...raw.object,
									name: `${raw.object.name} ${suffix}`,
								};
							if (raw.space)
								raw.space = {
									...raw.space,
									name: `${raw.space.name} ${suffix}`,
								};
							if (raw.item)
								raw.item = { ...raw.item, name: `${raw.item.name} ${suffix}` };
							return raw;
						},
					);
					return {
						setting,
						wallName: `wall ${suffix}`,
						bindings,
						decoys: [
							{
								id: "decoy-0",
								name: `Decoy 0 ${suffix}`,
								examineDescription: `A plain item (${suffix}).`,
								proximityFlavor: `A decoy.`,
								useOutcome: `Nothing.`,
							},
							{
								id: "decoy-1",
								name: `Decoy 1 ${suffix}`,
								examineDescription: `Another plain item (${suffix}).`,
								proximityFlavor: `Another decoy.`,
								useOutcome: `Nothing.`,
							},
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

function allEntityIds(pack: ContentPack): string[] {
	return pack.entities.map((e) => e.id).sort();
}

describe("generateDualContentPacks — entity ID parity (issue #302)", () => {
	it("produces packA and packB with identical entity IDs", async () => {
		const rng = mulberry32Rng(99);
		const provider = makeDualMockProvider();

		const { packA, packB } = await generateDualContentPacks(
			rng,
			SETTING_POOL_2,
			ONE_OBSTACLE_CONFIG,
			provider,
			AI_IDS,
		);

		expect(allEntityIds(packA)).toEqual(allEntityIds(packB));
	});

	it("Pack A and Pack B have different settings", async () => {
		const rng = mulberry32Rng(99);
		const provider = makeDualMockProvider();

		const { packA, packB } = await generateDualContentPacks(
			rng,
			SETTING_POOL_2,
			ONE_OBSTACLE_CONFIG,
			provider,
			AI_IDS,
		);

		expect(packA.setting).not.toBe(packB.setting);
	});

	it("Pack B entities have the same holder positions as Pack A (placement parity)", async () => {
		const rng = mulberry32Rng(99);
		const provider = makeDualMockProvider();

		const { packA, packB } = await generateDualContentPacks(
			rng,
			SETTING_POOL_2,
			ONE_OBSTACLE_CONFIG,
			provider,
			AI_IDS,
		);

		const holderByIdInPackA = new Map<string, unknown>();
		for (const e of packA.entities) holderByIdInPackA.set(e.id, e.holder);

		for (const e of packB.entities) {
			expect(e.holder).toEqual(holderByIdInPackA.get(e.id));
		}
	});

	it("makes exactly one LLM call for the dual packs", async () => {
		const rng = mulberry32Rng(99);
		const provider = makeDualMockProvider();

		await generateDualContentPacks(
			rng,
			SETTING_POOL_2,
			ONE_OBSTACLE_CONFIG,
			provider,
			AI_IDS,
		);

		expect(provider.dualCalls).toHaveLength(1);
		expect(provider.calls).toHaveLength(0);
	});

	it("throws when settings pool has fewer than 2 entries", async () => {
		const rng = mulberry32Rng(99);
		const provider = makeDualMockProvider();

		await expect(
			generateDualContentPacks(
				rng,
				["only one setting"],
				ONE_OBSTACLE_CONFIG,
				provider,
				AI_IDS,
			),
		).rejects.toThrow(
			/generateDualContentPacks: setting pool must have at least 2 entries/,
		);
	});
});

describe("generateDualContentPacks — placement constraints", () => {
	const GRID_SIZE = 5;
	const SEEDS = [0, 1, 7, 13, 42, 99, 12345, 0xdeadbeef];
	const SEVERAL_OBSTACLES_CONFIG: SingleGameConfig = { mRange: [4, 8] };

	function cellKey(pos: GridPosition): number {
		return pos.row * GRID_SIZE + pos.col;
	}

	function gridHolder(entity: WorldEntity): GridPosition {
		expect(isGridPosition(entity.holder), `${entity.id} is on the grid`).toBe(
			true,
		);
		return entity.holder as GridPosition;
	}

	function obstacleCells(pack: ContentPack): number[] {
		return obstacles(pack).map((o) => cellKey(gridHolder(o)));
	}

	function reachableFrom(
		start: GridPosition,
		blocked: ReadonlySet<number>,
	): Set<number> {
		const seen = new Set([cellKey(start)]);
		const queue = [start];
		for (let next = queue.shift(); next; next = queue.shift()) {
			for (const [dRow, dCol] of [
				[-1, 0],
				[1, 0],
				[0, -1],
				[0, 1],
			] as const) {
				const neighbour = { row: next.row + dRow, col: next.col + dCol };
				const onGrid =
					neighbour.row >= 0 &&
					neighbour.row < GRID_SIZE &&
					neighbour.col >= 0 &&
					neighbour.col < GRID_SIZE;
				const key = cellKey(neighbour);
				if (!onGrid || blocked.has(key) || seen.has(key)) continue;
				seen.add(key);
				queue.push(neighbour);
			}
		}
		return seen;
	}

	async function placedPacksFor(seed: number): Promise<ContentPack[]> {
		const { packA, packB } = await generateDualContentPacks(
			mulberry32Rng(seed),
			SETTING_POOL_2,
			SEVERAL_OBSTACLES_CONFIG,
			makeDualMockProvider(),
			AI_IDS,
		);
		return [packA, packB];
	}

	it.each(SEEDS)("seed %s: obstacles never share a cell", async (seed) => {
		for (const pack of await placedPacksFor(seed)) {
			const cells = obstacleCells(pack);
			expect(cells.length).toBeGreaterThanOrEqual(4);
			expect(new Set(cells).size).toBe(cells.length);
		}
	});

	it.each(
		SEEDS,
	)("seed %s: no AI start or other entity sits on an obstacle", async (seed) => {
		for (const pack of await placedPacksFor(seed)) {
			const blocked = new Set(obstacleCells(pack));
			for (const [aiId, { position }] of Object.entries(pack.aiStarts)) {
				expect(blocked.has(cellKey(position)), `${aiId} start`).toBe(false);
			}
			for (const entity of pack.entities) {
				if (entity.kind === "obstacle") continue;
				expect(blocked.has(cellKey(gridHolder(entity))), entity.id).toBe(false);
			}
		}
	});

	it.each(
		SEEDS,
	)("seed %s: every open cell is reachable from every AI start", async (seed) => {
		for (const pack of await placedPacksFor(seed)) {
			const blocked = new Set(obstacleCells(pack));
			const openCells = Array.from(
				{ length: GRID_SIZE * GRID_SIZE },
				(_, key) => key,
			).filter((key) => !blocked.has(key));
			for (const [aiId, { position }] of Object.entries(pack.aiStarts)) {
				const reachable = reachableFrom(position, blocked);
				for (const key of openCells) {
					expect(reachable.has(key), `cell ${key} from ${aiId}`).toBe(true);
				}
			}
		}
	});

	it("an objective object is never placed on its own space (seeds 0-299)", async () => {
		let pairsChecked = 0;
		for (let seed = 0; seed < 300; seed++) {
			for (const pack of await placedPacksFor(seed)) {
				for (const { object, space } of carryPairs(pack)) {
					pairsChecked++;
					expect(
						cellKey(gridHolder(object)),
						`seed ${seed}: ${object.id}`,
					).not.toBe(cellKey(gridHolder(space)));
				}
			}
		}
		expect(pairsChecked).toBeGreaterThan(100);
	});

	it("throws after exhausting placement attempts when obstacles leave no room for AI starts", async () => {
		await expect(
			generateDualContentPacks(
				mulberry32Rng(42),
				SETTING_POOL_2,
				{ mRange: [23, 23] },
				makeDualMockProvider(),
				AI_IDS,
			),
		).rejects.toThrow(/could not place phase 1 after 200 attempts/);
	});
});
