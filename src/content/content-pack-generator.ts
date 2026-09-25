import type {
	RawBinding,
	RawBoundPack,
} from "../spa/game/binding-aware-validator.js";
import { buildDualBindingPrompt } from "../spa/game/binding-prompt-builder.js";
import type {
	ContentPackProvider,
	DualBindingContentPackInput,
} from "../spa/game/content-pack-provider.js";
import { rollObjectiveTypes } from "../spa/game/objective-type-roll.js";
import {
	boundSpaces,
	carryPairs,
	interestingObjects,
	obstacles as obstacleEntities,
} from "../spa/game/pack-selectors.js";
import type {
	AiId,
	ContentPack,
	GridPosition,
	ObjectiveType,
	PersonaSpatialState,
	WorldEntity,
} from "../spa/game/types.js";

export interface SingleGameConfig {
	mRange: [number, number];
}

import { THEME_POOL } from "./theme-pool.js";
import { TIME_OF_DAY_POOL } from "./time-of-day-pool.js";
import { WEATHER_POOL } from "./weather-pool.js";

const GRID_ROWS = 5;
const GRID_COLS = 5;
const TOTAL_CELLS = GRID_ROWS * GRID_COLS;
const MAX_PLACEMENT_ATTEMPTS = 200;
const OBJECTIVES_PER_GAME = 3;

function rollInt(rng: () => number, lo: number, hi: number): number {
	return lo + Math.floor(rng() * (hi - lo + 1));
}

function posKey(pos: GridPosition): number {
	return pos.row * GRID_COLS + pos.col;
}

function keyToPos(key: number): GridPosition {
	return { row: Math.floor(key / GRID_COLS), col: key % GRID_COLS };
}

function drawDistinct<T>(
	rng: () => number,
	poolShuffledInPlace: T[],
	count: number,
): T[] {
	const result: T[] = [];
	for (let i = 0; i < count; i++) {
		const j = i + Math.floor(rng() * (poolShuffledInPlace.length - i));
		const tmp = poolShuffledInPlace[i] as T;
		poolShuffledInPlace[i] = poolShuffledInPlace[j] as T;
		poolShuffledInPlace[j] = tmp;
		result.push(poolShuffledInPlace[i] as T);
	}
	return result;
}

function pickOne(rng: () => number, pool: readonly string[]): string {
	return pool[Math.floor(rng() * pool.length)] as string;
}

function reachableCellsFrom(
	start: GridPosition,
	obstacleSet: Set<number>,
): Set<number> {
	const startKey = posKey(start);
	const visited = new Set<number>([startKey]);
	const queue: number[] = [startKey];

	while (queue.length > 0) {
		const current = queue.shift() as number;
		const pos = keyToPos(current);
		const neighbors: GridPosition[] = [
			{ row: pos.row - 1, col: pos.col },
			{ row: pos.row + 1, col: pos.col },
			{ row: pos.row, col: pos.col - 1 },
			{ row: pos.row, col: pos.col + 1 },
		];
		for (const nb of neighbors) {
			if (
				nb.row < 0 ||
				nb.row >= GRID_ROWS ||
				nb.col < 0 ||
				nb.col >= GRID_COLS
			)
				continue;
			const nbKey = posKey(nb);
			if (obstacleSet.has(nbKey)) continue;
			if (visited.has(nbKey)) continue;
			visited.add(nbKey);
			queue.push(nbKey);
		}
	}
	return visited;
}

function everyOpenCellReachable(
	startPositions: GridPosition[],
	obstacleSet: Set<number>,
	openCells: number[],
): boolean {
	return startPositions.every((start) => {
		const reachable = reachableCellsFrom(start, obstacleSet);
		return openCells.every((cellKey) => reachable.has(cellKey));
	});
}

function tryPlacePhase(
	rng: () => number,
	pack: ContentPack,
	aiIds: AiId[],
): ContentPack | null {
	const packCarryPairs = carryPairs(pack);
	const packBoundSpaces = boundSpaces(pack);
	const packInteresting = interestingObjects(pack);
	const packObstacles = obstacleEntities(pack);

	const carryPairCount = packCarryPairs.length;
	const standaloneSpaceCount = packBoundSpaces.length;
	const totalSpaces = carryPairCount + standaloneSpaceCount;
	const interestingCount = packInteresting.length;
	const obstacleCount = packObstacles.length;

	const nonObstacleCellsNeeded =
		aiIds.length + totalSpaces + carryPairCount + interestingCount;
	const layoutCannotFit = obstacleCount + nonObstacleCellsNeeded > TOTAL_CELLS;
	if (layoutCannotFit) return null;

	const allCells = Array.from({ length: TOTAL_CELLS }, (_, i) => i);

	const obstacleKeys = drawDistinct(rng, [...allCells], obstacleCount);
	const obstacleSet = new Set(obstacleKeys);
	const nonObstacleCells = allCells.filter((k) => !obstacleSet.has(k));

	if (nonObstacleCells.length < aiIds.length) return null;
	const aiStartKeys = drawDistinct(rng, [...nonObstacleCells], aiIds.length);
	const aiStartSet = new Set(aiStartKeys);

	const aiStarts: Record<AiId, PersonaSpatialState> = {};
	for (let i = 0; i < aiIds.length; i++) {
		const key = aiStartKeys[i] as number;
		const pos = keyToPos(key);
		aiStarts[aiIds[i] as AiId] = { position: pos };
	}

	const spaceCandidates = nonObstacleCells.filter((k) => !aiStartSet.has(k));
	if (spaceCandidates.length < totalSpaces) return null;
	const allSpaceKeys = drawDistinct(rng, [...spaceCandidates], totalSpaces);
	const carrySpaceKeys = allSpaceKeys.slice(0, carryPairCount);
	const standaloneSpaceKeys = allSpaceKeys.slice(carryPairCount);
	const spaceKeySet = new Set(allSpaceKeys);

	const objectCandidates = nonObstacleCells.filter(
		(cellKey) => !spaceKeySet.has(cellKey),
	);
	if (objectCandidates.length < carryPairCount) return null;
	const objectKeys = drawDistinct(rng, [...objectCandidates], carryPairCount);

	const interestingCandidates = nonObstacleCells.filter(
		(k) => !aiStartSet.has(k),
	);
	if (interestingCandidates.length < interestingCount) return null;
	const interestingKeys = drawDistinct(
		rng,
		[...interestingCandidates],
		interestingCount,
	);

	const aiStartPositions = aiStartKeys.map(keyToPos);
	if (
		!everyOpenCellReachable(aiStartPositions, obstacleSet, nonObstacleCells)
	) {
		return null;
	}

	const holderById = new Map<string, GridPosition>();
	packCarryPairs.forEach((pair, i) => {
		holderById.set(pair.object.id, keyToPos(objectKeys[i] as number));
		holderById.set(pair.space.id, keyToPos(carrySpaceKeys[i] as number));
	});
	packBoundSpaces.forEach((space, i) => {
		holderById.set(space.id, keyToPos(standaloneSpaceKeys[i] as number));
	});
	packInteresting.forEach((obj, i) => {
		holderById.set(obj.id, keyToPos(interestingKeys[i] as number));
	});
	packObstacles.forEach((obs, i) => {
		holderById.set(obs.id, keyToPos(obstacleKeys[i] as number));
	});

	const updatedEntities = pack.entities.map((entity) => {
		const holder = holderById.get(entity.id);
		return holder !== undefined ? { ...entity, holder } : entity;
	});

	return {
		...pack,
		entities: updatedEntities,
		aiStarts,
	};
}

function placePhases(
	rng: () => number,
	packs: ContentPack[],
	aiIds: AiId[],
): ContentPack[] {
	return packs.map((pack, i) => {
		for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
			const result = tryPlacePhase(rng, pack, aiIds);
			if (result !== null) return result;
		}
		throw new Error(
			`generateDualContentPacks: could not place phase ${i + 1} after ${MAX_PLACEMENT_ATTEMPTS} attempts. ` +
				`Check that m (${obstacleEntities(pack).length}) obstacles leave enough room for AI starts and entities.`,
		);
	});
}

function rawBoundPackToContentPack(
	rawPack: RawBoundPack,
	objectiveTypes: ObjectiveType[],
	weather: string,
	timeOfDay: string,
): ContentPack {
	const entities: WorldEntity[] = [];

	const bindings = rawPack.bindings ?? [];
	for (const [i, type] of objectiveTypes.entries()) {
		const binding: RawBinding | undefined = bindings[i];
		if (!binding) continue;

		switch (type) {
			case "carry": {
				const obj = binding.object;
				const spc = binding.space;
				if (obj && spc) {
					entities.push({
						id: obj.id ?? `carry-${i}-obj`,
						kind: "objective_object",
						name: obj.name ?? "",
						examineDescription: obj.examineDescription ?? "",
						useOutcome: obj.useOutcome ?? "",
						pairsWithSpaceId: spc.id ?? `carry-${i}-space`,
						placementFlavor: obj.placementFlavor ?? "{actor}",
						proximityFlavor: obj.proximityFlavor ?? "",
						holder: { row: 0, col: 0 },
					});
					entities.push({
						id: spc.id ?? `carry-${i}-space`,
						kind: "objective_space",
						name: spc.name ?? "",
						examineDescription: spc.examineDescription ?? "",
						proximityFlavor: spc.proximityFlavor ?? "",
						holder: { row: 0, col: 0 },
					});
				}
				break;
			}
			case "use_space": {
				const spc = binding.space;
				if (spc) {
					const entity: WorldEntity = {
						id: spc.id ?? `useSpace-${i}-space`,
						kind: "objective_space",
						name: spc.name ?? "",
						examineDescription: spc.examineDescription ?? "",
						proximityFlavor: spc.proximityFlavor ?? "",
						holder: { row: 0, col: 0 },
					};
					if (spc.activationFlavor !== undefined)
						entity.activationFlavor = spc.activationFlavor;
					if (spc.satisfactionFlavor !== undefined)
						entity.satisfactionFlavor = spc.satisfactionFlavor;
					if (spc.postExamineDescription !== undefined)
						entity.postExamineDescription = spc.postExamineDescription;
					if (spc.postLookFlavor !== undefined)
						entity.postLookFlavor = spc.postLookFlavor;
					entities.push(entity);
				}
				break;
			}
			case "convergence": {
				const spc = binding.space;
				if (spc) {
					const entity: WorldEntity = {
						id: spc.id ?? `convergence-${i}-space`,
						kind: "objective_space",
						name: spc.name ?? "",
						examineDescription: spc.examineDescription ?? "",
						proximityFlavor: spc.proximityFlavor ?? "",
						holder: { row: 0, col: 0 },
					};
					if (spc.convergenceTier1Flavor !== undefined)
						entity.convergenceTier1Flavor = spc.convergenceTier1Flavor;
					if (spc.convergenceTier2Flavor !== undefined)
						entity.convergenceTier2Flavor = spc.convergenceTier2Flavor;
					if (spc.convergenceTier1ActorFlavor !== undefined)
						entity.convergenceTier1ActorFlavor =
							spc.convergenceTier1ActorFlavor;
					if (spc.convergenceTier2ActorFlavor !== undefined)
						entity.convergenceTier2ActorFlavor =
							spc.convergenceTier2ActorFlavor;
					entities.push(entity);
				}
				break;
			}
			case "use_item": {
				const item = binding.item;
				if (item) {
					const entity: WorldEntity = {
						id: item.id ?? `useItem-${i}-item`,
						kind: "interesting_object",
						name: item.name ?? "",
						examineDescription: item.examineDescription ?? "",
						proximityFlavor: item.proximityFlavor ?? "",
						holder: { row: 0, col: 0 },
					};
					if (item.useOutcome !== undefined)
						entity.useOutcome = item.useOutcome;
					if (item.activationFlavor !== undefined)
						entity.activationFlavor = item.activationFlavor;
					if (item.postExamineDescription !== undefined)
						entity.postExamineDescription = item.postExamineDescription;
					if (item.postLookFlavor !== undefined)
						entity.postLookFlavor = item.postLookFlavor;
					entities.push(entity);
				}
				break;
			}
		}
	}

	for (const decoy of rawPack.decoys ?? []) {
		const entity: WorldEntity = {
			id: decoy.id ?? "decoy-unknown",
			kind: "interesting_object",
			name: decoy.name ?? "",
			examineDescription: decoy.examineDescription ?? "",
			proximityFlavor: decoy.proximityFlavor ?? "",
			holder: { row: 0, col: 0 },
		};
		if (decoy.useOutcome !== undefined) entity.useOutcome = decoy.useOutcome;
		entities.push(entity);
	}

	for (const obs of rawPack.obstacles ?? []) {
		entities.push({
			id: obs.id ?? "obstacle-unknown",
			kind: "obstacle",
			name: obs.name ?? "",
			examineDescription: obs.examineDescription ?? "",
			shiftFlavor: obs.shiftFlavor ?? "",
			holder: { row: 0, col: 0 },
		});
	}

	return {
		setting: rawPack.setting ?? "",
		weather,
		timeOfDay,
		entities,
		wallName: rawPack.wallName ?? "",
		aiStarts: {},
	};
}

export async function generateDualContentPacks(
	rng: () => number,
	settings: readonly string[],
	config: SingleGameConfig,
	llm: ContentPackProvider,
	aiIdsOrPromise: AiId[] | Promise<AiId[]>,
): Promise<{
	packA: ContentPack;
	packB: ContentPack;
	objectiveTypes: ObjectiveType[];
}> {
	if (settings.length < 2) {
		throw new Error(
			`generateDualContentPacks: setting pool must have at least 2 entries (has ${settings.length})`,
		);
	}

	const [settingA, settingB] = drawDistinct(rng, [...settings], 2) as [
		string,
		string,
	];
	const weatherA = pickOne(rng, WEATHER_POOL);
	const weatherB = pickOne(rng, WEATHER_POOL);
	const timeOfDayA = pickOne(rng, TIME_OF_DAY_POOL);
	const timeOfDayB = pickOne(rng, TIME_OF_DAY_POOL);
	const theme = pickOne(rng, THEME_POOL);
	const obstacleCount = rollInt(rng, config.mRange[0], config.mRange[1]);
	const objectiveTypes = rollObjectiveTypes(rng, OBJECTIVES_PER_GAME);

	const bindingPrompt = buildDualBindingPrompt(
		objectiveTypes,
		settingA,
		settingB,
		theme,
		weatherA,
		weatherB,
		timeOfDayA,
		timeOfDayB,
		obstacleCount,
	);

	const llmInput: DualBindingContentPackInput = {
		phases: [
			{
				settingA,
				settingB,
				theme,
				weatherA,
				weatherB,
				timeOfDayA,
				timeOfDayB,
				bindings: bindingPrompt.skeletons,
				decoyIds: ["decoy-0", "decoy-1"],
				obstacleCount,
			},
		],
	};

	const llmCallPromise = llm.generateDualContentPacks(llmInput);
	const [llmResult, aiIds] = await Promise.all([
		llmCallPromise,
		Promise.resolve(aiIdsOrPromise),
	]);

	const phase = llmResult.phases[0];
	if (!phase)
		throw new Error("generateDualContentPacks: LLM returned no phases");

	const unplacedPackA = rawBoundPackToContentPack(
		phase.rawPackA,
		objectiveTypes,
		weatherA,
		timeOfDayA,
	);
	const unplacedPackB = rawBoundPackToContentPack(
		phase.rawPackB,
		objectiveTypes,
		weatherB,
		timeOfDayB,
	);

	const placedPacksA = placePhases(rng, [unplacedPackA], aiIds);
	const placedPackA = placedPacksA[0];
	if (!placedPackA)
		throw new Error("generateDualContentPacks: placement failed");

	const packB = copyPlacementsById(placedPackA, unplacedPackB);
	return { packA: placedPackA, packB, objectiveTypes };
}

function copyPlacementsById(
	placedPack: ContentPack,
	unplacedPack: ContentPack,
): ContentPack {
	const holderById = new Map<string, AiId | GridPosition>();
	for (const entity of placedPack.entities) {
		holderById.set(entity.id, entity.holder);
	}
	return {
		...unplacedPack,
		entities: unplacedPack.entities.map((entity) => ({
			...entity,
			holder: holderById.get(entity.id) ?? { row: 0, col: 0 },
		})),
		aiStarts: { ...placedPack.aiStarts },
	};
}
