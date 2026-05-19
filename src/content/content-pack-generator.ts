/**
 * content-pack-generator.ts
 *
 * Generates all three ContentPacks at game start:
 * 1. Draws 3 distinct settings from the pool (partial Fisher-Yates).
 * 2. Rolls k/n/m per phase.
 * 3. Makes one batched LLM call.
 * 4. Runs engine-randomized placement under constraints.
 *
 * Placement constraints:
 * - Obstacles placed first, m distinct cells.
 * - AI starts: distinct non-obstacle cells, uniform-random cardinal facing.
 * - Objective spaces: distinct, non-obstacle, off AI start cells.
 * - Objective objects: distinct, non-obstacle, NOT on their matched space's cell.
 * - Interesting objects: distinct from obstacle and AI start cells (may stack with other items).
 * - BFS reachability: every non-obstacle cell must be reachable from every AI start.
 * - Up to MAX_ATTEMPTS retries before throwing.
 */

import type {
	RawBinding,
	RawBoundPack,
} from "../spa/game/binding-aware-validator.js";
import {
	buildBindingPrompt,
	buildDualBindingPrompt,
} from "../spa/game/binding-prompt-builder.js";
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
	CardinalDirection,
	ContentPack,
	GridPosition,
	ObjectiveType,
	PersonaSpatialState,
	WorldEntity,
} from "../spa/game/types.js";

/**
 * Configuration for a single game's content pack generation.
 */
export interface SingleGameConfig {
	/** Roll k (objective pairs). */
	kRange: [number, number];
	/** Roll n (interesting objects). */
	nRange: [number, number];
	/** Roll m (obstacles). */
	mRange: [number, number];
	budgetPerAi: number;
}

/**
 * Legacy per-phase config shape. Kept for backward-compat with generateContentPacks.
 * @deprecated use SingleGameConfig + generateContentPack
 */
export interface PhaseConfig {
	kRange: [number, number];
	nRange: [number, number];
	mRange: [number, number];
	budgetPerAi: number;
	aiGoalPool: string[];
}

import { THEME_POOL } from "./theme-pool.js";
import { TIME_OF_DAY_POOL } from "./time-of-day-pool.js";
import { WEATHER_POOL } from "./weather-pool.js";

const GRID_ROWS = 5;
const GRID_COLS = 5;
const TOTAL_CELLS = GRID_ROWS * GRID_COLS;
const CARDINAL_DIRECTIONS: CardinalDirection[] = [
	"north",
	"south",
	"east",
	"west",
];
const MAX_ATTEMPTS = 200;

/** Roll an integer in [lo, hi] inclusive using the provided rng. */
function rollInt(rng: () => number, lo: number, hi: number): number {
	return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Encode a GridPosition as a single integer key. */
function posKey(pos: GridPosition): number {
	return pos.row * GRID_COLS + pos.col;
}

/** Decode an integer cell key to a GridPosition. */
function keyToPos(key: number): GridPosition {
	return { row: Math.floor(key / GRID_COLS), col: key % GRID_COLS };
}

/**
 * Draw `count` distinct integers from [0, TOTAL_CELLS) using partial Fisher-Yates.
 * Returns them as cell indices.
 */
function drawDistinctCells(
	rng: () => number,
	pool: number[],
	count: number,
): number[] {
	// Pool is a mutable copy; we do partial in-place shuffle.
	const result: number[] = [];
	for (let i = 0; i < count; i++) {
		const j = i + Math.floor(rng() * (pool.length - i));
		const tmp = pool[i] as number;
		pool[i] = pool[j] as number;
		pool[j] = tmp;
		result.push(pool[i] as number);
	}
	return result;
}

/**
 * BFS over non-obstacle cells from a start position.
 * Returns the set of reachable cell keys.
 */
function bfsReachable(
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

/**
 * Attempt to place all entities and AI starts for a single phase.
 * Returns null if placement constraints cannot be satisfied.
 */
function tryPlacePhase(
	rng: () => number,
	pack: ContentPack,
	aiIds: AiId[],
): ContentPack | null {
	const packCarryPairs = carryPairs(pack);
	const packBoundSpaces = boundSpaces(pack);
	const packInteresting = interestingObjects(pack);
	const packObstacles = obstacleEntities(pack);

	const k = packCarryPairs.length; // carry pairs
	const s = packBoundSpaces.length; // standalone bound spaces
	const totalSpaces = k + s;
	const n = packInteresting.length;
	const m = packObstacles.length;

	// nonObstacleNeeded: AI starts + all spaces + carry objects + interesting objects
	const nonObstacleNeeded = aiIds.length + totalSpaces + k + n;
	if (m + nonObstacleNeeded > TOTAL_CELLS) {
		return null; // Impossible layout
	}

	// Build full cell pool
	const allCells = Array.from({ length: TOTAL_CELLS }, (_, i) => i);

	// 1. Place obstacles
	const cellPool = [...allCells];
	const obstacleKeys = drawDistinctCells(rng, cellPool, m);
	const obstacleSet = new Set(obstacleKeys);

	// 2. Non-obstacle cell pool
	const nonObstacleCells = allCells.filter((k) => !obstacleSet.has(k));

	// 3. Place AI starts: distinct non-obstacle cells
	const nonObstaclePool = [...nonObstacleCells];
	if (nonObstaclePool.length < aiIds.length) return null;
	const aiStartKeys = drawDistinctCells(rng, nonObstaclePool, aiIds.length);
	const aiStartSet = new Set(aiStartKeys);

	// Draw AI facings
	const aiStarts: Record<AiId, PersonaSpatialState> = {};
	for (let i = 0; i < aiIds.length; i++) {
		const key = aiStartKeys[i] as number;
		const pos = keyToPos(key);
		const facingIdx = Math.floor(rng() * CARDINAL_DIRECTIONS.length);
		const facing: CardinalDirection = CARDINAL_DIRECTIONS[
			facingIdx
		] as CardinalDirection;
		aiStarts[aiIds[i] as AiId] = { position: pos, facing };
	}

	// 4. Place all spaces (carry spaces + standalone bound spaces): distinct, non-obstacle, off AI start cells
	const spaceCandidates = nonObstacleCells.filter((k) => !aiStartSet.has(k));
	if (spaceCandidates.length < totalSpaces) return null;
	const spaceCandidatePool = [...spaceCandidates];
	const allSpaceKeys = drawDistinctCells(rng, spaceCandidatePool, totalSpaces);
	// First k go to carry pair spaces; remaining s go to standalone bound spaces
	const spaceKeys = allSpaceKeys.slice(0, k);
	const spaceKeySet = new Set(allSpaceKeys); // all spaces forbidden for objects

	// 5. Place objective objects: distinct, non-obstacle, NOT on their matched space
	const objectCandidates = nonObstacleCells.filter(
		(cellKey) => !spaceKeySet.has(cellKey),
	);
	if (objectCandidates.length < k) return null;
	const objectCandidatePool = [...objectCandidates];
	const objectKeys = drawDistinctCells(rng, objectCandidatePool, k);

	// 6. Place interesting objects: distinct from obstacle and AI start cells (may stack with other items)
	const interestingCandidates = nonObstacleCells.filter(
		(k) => !aiStartSet.has(k),
	);
	if (interestingCandidates.length < n) return null;
	const interestingPool = [...interestingCandidates];
	// We draw n from this pool (stacking with other items is fine — no uniqueness constraint vs objects/spaces)
	// But we must draw distinct cells (no two interesting objects forced to same cell by this algorithm;
	// stacking with objective items is allowed per spec)
	const interestingKeys = drawDistinctCells(rng, interestingPool, n);

	// BFS reachability check: all non-obstacle cells must be reachable from every AI start
	const nonObstacleSet = new Set(nonObstacleCells);
	for (const aiId of aiIds) {
		const spatial = aiStarts[aiId];
		if (!spatial) return null;
		const reachable = bfsReachable(spatial.position, obstacleSet);
		// Every non-obstacle cell must be reachable
		for (const cellKey of nonObstacleSet) {
			if (!reachable.has(cellKey)) return null; // Disconnected grid
		}
	}

	// Build holder map keyed by entity id from the placement draws.
	const holderById = new Map<string, GridPosition>();
	packCarryPairs.forEach((pair, i) => {
		holderById.set(pair.object.id, keyToPos(objectKeys[i] as number));
		holderById.set(pair.space.id, keyToPos(spaceKeys[i] as number));
	});
	const standaloneSpaceKeys = allSpaceKeys.slice(k);
	packBoundSpaces.forEach((space, i) => {
		holderById.set(space.id, keyToPos(standaloneSpaceKeys[i] as number));
	});
	packInteresting.forEach((obj, i) => {
		holderById.set(obj.id, keyToPos(interestingKeys[i] as number));
	});
	packObstacles.forEach((obs, i) => {
		holderById.set(obs.id, keyToPos(obstacleKeys[i] as number));
	});

	// Write the placements back via one entities.map, preserving pack-order.
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

/**
 * Place all phases with retries. Throws after MAX_ATTEMPTS if any phase
 * cannot be placed satisfying all constraints.
 */
function placePhases(
	rng: () => number,
	packs: ContentPack[],
	aiIds: AiId[],
): ContentPack[] {
	return packs.map((pack, i) => {
		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			const result = tryPlacePhase(rng, pack, aiIds);
			if (result !== null) return result;
		}
		throw new Error(
			`generateContentPacks: could not place phase ${i + 1} after ${MAX_ATTEMPTS} attempts. ` +
				`Check that m (${obstacleEntities(pack).length}) obstacles leave enough room for AI starts and entities.`,
		);
	});
}

/**
 * Convert a validated RawBoundPack to a ContentPack (without placements).
 *
 * All entities are accumulated into a single `entities` array in canonical
 * order: per binding index, carry pairs emit object then space; use_space and
 * convergence bindings emit a space; use_item bindings emit an item. Decoys
 * then obstacles are appended at the end. This is the same order the v10→v11
 * migration uses, so persisted packs and freshly-generated packs walk
 * `entities` identically.
 */
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

	// Add decoys (interesting_object kind) after binding-derived entities
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

	// Add obstacles last
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
		landmarks: (rawPack.landmarks as ContentPack["landmarks"]) ?? {
			north: { shortName: "", horizonPhrase: "" },
			south: { shortName: "", horizonPhrase: "" },
			east: { shortName: "", horizonPhrase: "" },
			west: { shortName: "", horizonPhrase: "" },
		},
		wallName: rawPack.wallName ?? "",
		aiStarts: {},
	};
}

/**
 * Generate all three ContentPacks for a game.
 *
 * @param rng        Seeded random number generator.
 * @param settings   The pool of setting nouns to draw from (must have >= 3 entries).
 * @param configs    The three phase configs (in order).
 * @param llm        ContentPackProvider for the LLM call.
 * @param aiIdsOrPromise  AiId list or a Promise resolving to one (enables true parallelism).
 */
export async function generateContentPacks(
	rng: () => number,
	settings: readonly string[],
	configs: [PhaseConfig, PhaseConfig, PhaseConfig],
	llm: ContentPackProvider,
	aiIdsOrPromise: AiId[] | Promise<AiId[]>,
): Promise<ContentPack[]> {
	if (settings.length < 3) {
		throw new Error(
			`generateContentPacks: setting pool must have at least 3 entries (has ${settings.length})`,
		);
	}

	// Draw 3 distinct settings via partial Fisher-Yates
	const settingPool = [...settings];
	const drawnSettings: string[] = [];
	for (let i = 0; i < 3; i++) {
		const j = i + Math.floor(rng() * (settingPool.length - i));
		const tmp = settingPool[i] as string;
		settingPool[i] = settingPool[j] as string;
		settingPool[j] = tmp;
		drawnSettings.push(settingPool[i] as string);
	}

	// Draw weather, time-of-day, and theme independently per phase (with replacement)
	const drawnWeather = Array.from(
		{ length: 3 },
		() => WEATHER_POOL[Math.floor(rng() * WEATHER_POOL.length)] as string,
	);
	const drawnTimeOfDay = Array.from(
		{ length: 3 },
		() =>
			TIME_OF_DAY_POOL[Math.floor(rng() * TIME_OF_DAY_POOL.length)] as string,
	);
	const drawnThemes = Array.from(
		{ length: 3 },
		() => THEME_POOL[Math.floor(rng() * THEME_POOL.length)] as string,
	);

	// Roll m per phase and type-first objective types
	const phaseMValues = configs.map((cfg) =>
		rollInt(rng, cfg.mRange[0], cfg.mRange[1]),
	);
	const phaseObjectiveTypes = configs.map(() => rollObjectiveTypes(rng, 3));

	// Build binding-format phases for LLM
	const phaseInputs = configs.map((_cfg, i) => {
		const objectiveTypes = phaseObjectiveTypes[i] ?? [];
		const m = phaseMValues[i] ?? 0;
		const weather = drawnWeather[i] ?? "clear";
		const timeOfDay = drawnTimeOfDay[i] ?? "morning";
		const theme = drawnThemes[i] ?? "mundane";
		const setting = drawnSettings[i] ?? "";
		const bp = buildBindingPrompt(
			objectiveTypes,
			setting,
			theme,
			weather,
			timeOfDay,
			m,
		);
		return {
			setting,
			theme,
			weather,
			timeOfDay,
			bindings: bp.skeletons,
			decoyIds: ["decoy-0", "decoy-1"] as [string, string],
			obstacleCount: m,
		};
	});

	// Kick off LLM call immediately (parallel with aiIds resolution)
	const llmCallPromise = llm.generateContentPacks({ phases: phaseInputs });

	// Await both in parallel
	const [llmResult, aiIds] = await Promise.all([
		llmCallPromise,
		Promise.resolve(aiIdsOrPromise),
	]);

	// Build unplaced ContentPack structures from LLM result using converter
	const unplacedPacks: ContentPack[] = llmResult.phases.map((phase, i) => {
		const objectiveTypes = phaseObjectiveTypes[i] ?? [];
		const weather = drawnWeather[i] ?? "clear";
		const timeOfDay = drawnTimeOfDay[i] ?? "morning";
		return rawBoundPackToContentPack(
			phase.rawPack,
			objectiveTypes,
			weather,
			timeOfDay,
		);
	});

	// Run placement engine
	return placePhases(rng, unplacedPacks, aiIds);
}

/**
 * Generate a paired A/B ContentPack in one LLM call (type-first authoring).
 *
 * Objective types are rolled BEFORE the LLM call. The LLM receives pre-minted
 * entity-ID skeletons and authors only flavor fields. Pack A and Pack B share
 * identical entity IDs and grid placements; only names, descriptions, and flavor
 * strings differ (re-flavored per setting).
 *
 * @param rng        Seeded random number generator.
 * @param settings   The pool of setting nouns (must have >= 2 entries: 1 for Pack A, 1 for Pack B).
 * @param config     Single-game config (kRange, nRange, mRange) — same for both packs.
 * @param llm        ContentPackProvider for the LLM call.
 * @param aiIdsOrPromise  AiId list or a Promise resolving to one.
 * @returns          `{ packA, packB, objectiveTypes }` — placed ContentPack pair with identical entity IDs/placements.
 */
export async function generateDualContentPacks(
	rng: () => number,
	settings: readonly string[],
	config: PhaseConfig,
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

	// Draw 2 distinct settings (1 for A, 1 for B) via partial Fisher-Yates
	const settingPool = [...settings];
	const drawnSettings: string[] = [];
	for (let i = 0; i < 2; i++) {
		const j = i + Math.floor(rng() * (settingPool.length - i));
		const tmp = settingPool[i] as string;
		settingPool[i] = settingPool[j] as string;
		settingPool[j] = tmp;
		drawnSettings.push(settingPool[i] as string);
	}
	const settingA = drawnSettings[0] as string;
	const settingB = drawnSettings[1] as string;

	// Draw weather, time-of-day, and theme independently for A and B
	const weatherA = WEATHER_POOL[
		Math.floor(rng() * WEATHER_POOL.length)
	] as string;
	const weatherB = WEATHER_POOL[
		Math.floor(rng() * WEATHER_POOL.length)
	] as string;
	const timeOfDayA = TIME_OF_DAY_POOL[
		Math.floor(rng() * TIME_OF_DAY_POOL.length)
	] as string;
	const timeOfDayB = TIME_OF_DAY_POOL[
		Math.floor(rng() * TIME_OF_DAY_POOL.length)
	] as string;
	const theme = THEME_POOL[Math.floor(rng() * THEME_POOL.length)] as string;

	// Roll m for obstacles
	const m = rollInt(rng, config.mRange[0], config.mRange[1]);

	// === TYPE-FIRST: roll objectives BEFORE the LLM call ===
	const objectiveTypes = rollObjectiveTypes(rng, 3);

	// Build binding prompt (pre-minted IDs) and dual LLM input
	const bindingPrompt = buildDualBindingPrompt(
		objectiveTypes,
		settingA,
		settingB,
		theme,
		weatherA,
		weatherB,
		timeOfDayA,
		timeOfDayB,
		m,
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
				obstacleCount: m,
			},
		],
	};

	// Kick off dual LLM call and aiIds resolution in parallel
	const llmCallPromise = llm.generateDualContentPacks(llmInput);
	const [llmResult, aiIds] = await Promise.all([
		llmCallPromise,
		Promise.resolve(aiIdsOrPromise),
	]);

	const phase = llmResult.phases[0];
	if (!phase)
		throw new Error("generateDualContentPacks: LLM returned no phases");

	// Convert binding-shaped packs to ContentPack (no placements yet)
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

	// Run placement engine on Pack A
	const placedPacksA = placePhases(rng, [unplacedPackA], aiIds);
	const placedPackA = placedPacksA[0];
	if (!placedPackA)
		throw new Error("generateDualContentPacks: placement failed");

	// Build ID → holder map from placed Pack A by walking entities directly.
	const holderById = new Map<string, AiId | GridPosition>();
	for (const entity of placedPackA.entities) {
		holderById.set(entity.id, entity.holder);
	}

	// Apply the same placements to Pack B by matching entity IDs (one entities.map).
	const packB: ContentPack = {
		...unplacedPackB,
		entities: unplacedPackB.entities.map((entity) => ({
			...entity,
			holder: holderById.get(entity.id) ?? { row: 0, col: 0 },
		})),
		aiStarts: { ...placedPackA.aiStarts },
	};

	return { packA: placedPackA, packB, objectiveTypes };
}

/**
 * Generate a single ContentPack for a single-game session.
 *
 * @param rng        Seeded random number generator.
 * @param settings   The pool of setting nouns to draw from (must have >= 1 entry).
 * @param config     Single-game config (kRange, nRange, mRange).
 * @param llm        ContentPackProvider for the LLM call.
 * @param aiIdsOrPromise  AiId list or a Promise resolving to one.
 */
export async function generateContentPack(
	rng: () => number,
	settings: readonly string[],
	config: SingleGameConfig,
	llm: ContentPackProvider,
	aiIdsOrPromise: AiId[] | Promise<AiId[]>,
): Promise<ContentPack> {
	if (settings.length < 1) {
		throw new Error(
			`generateContentPack: setting pool must have at least 1 entry (has ${settings.length})`,
		);
	}

	// Draw 1 setting
	const settingIdx = Math.floor(rng() * settings.length);
	const setting = settings[settingIdx] as string;

	// Draw weather, time-of-day, and theme
	const weather = WEATHER_POOL[
		Math.floor(rng() * WEATHER_POOL.length)
	] as string;
	const timeOfDay = TIME_OF_DAY_POOL[
		Math.floor(rng() * TIME_OF_DAY_POOL.length)
	] as string;
	const theme = THEME_POOL[Math.floor(rng() * THEME_POOL.length)] as string;

	// Roll m and type-first objective types
	const m = rollInt(rng, config.mRange[0], config.mRange[1]);
	const objectiveTypes = rollObjectiveTypes(rng, 3);

	// Build binding prompt
	const bp = buildBindingPrompt(
		objectiveTypes,
		setting,
		theme,
		weather,
		timeOfDay,
		m,
	);
	const phaseInput = {
		setting,
		theme,
		weather,
		timeOfDay,
		bindings: bp.skeletons,
		decoyIds: ["decoy-0", "decoy-1"] as [string, string],
		obstacleCount: m,
	};

	// Kick off LLM call immediately (parallel with aiIds resolution)
	const llmCallPromise = llm.generateContentPacks({ phases: [phaseInput] });

	// Await both in parallel
	const [llmResult, aiIds] = await Promise.all([
		llmCallPromise,
		Promise.resolve(aiIdsOrPromise),
	]);

	// Build placeholder ContentPack from LLM result using converter
	const phase = llmResult.phases[0];
	if (!phase) throw new Error("generateContentPack: LLM returned no phases");

	const unplacedPack = rawBoundPackToContentPack(
		phase.rawPack,
		objectiveTypes,
		weather,
		timeOfDay,
	);

	// Run placement engine
	const placed = placePhases(rng, [unplacedPack], aiIds);
	const result = placed[0];
	if (!result) throw new Error("generateContentPack: placement failed");
	return result;
}
