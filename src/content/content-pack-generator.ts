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
	ContentPackProvider,
	ContentPackProviderInput,
	DualContentPackProviderInput,
} from "../spa/game/content-pack-provider.js";
import type {
	AiId,
	CardinalDirection,
	ContentPack,
	GridPosition,
	PersonaSpatialState,
	PhaseConfig,
	WorldEntity,
} from "../spa/game/types.js";
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
	const k = pack.objectivePairs.length;
	const n = pack.interestingObjects.length;
	const m = pack.obstacles.length;

	// We need: m obstacles + |aiIds| AI starts + k spaces + k objects (not on their space) + n interesting objects
	// Total non-obstacle cells needed: |aiIds| + k spaces + k objects + n
	const nonObstacleNeeded = aiIds.length + k + k + n;
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

	// 4. Place objective spaces: distinct, non-obstacle, off AI start cells
	const spaceCandidates = nonObstacleCells.filter((k) => !aiStartSet.has(k));
	if (spaceCandidates.length < k) return null;
	const spaceCandidatePool = [...spaceCandidates];
	const spaceKeys = drawDistinctCells(rng, spaceCandidatePool, k);
	const spaceKeySet = new Set(spaceKeys);

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

	// Build updated pack with placements
	const updatedObjectivePairs = pack.objectivePairs.map((pair, i) => {
		const spaceKey = spaceKeys[i] as number;
		const objectKey = objectKeys[i] as number;
		return {
			object: { ...pair.object, holder: keyToPos(objectKey) },
			space: { ...pair.space, holder: keyToPos(spaceKey) },
		};
	});

	const updatedInterestingObjects = pack.interestingObjects.map((obj, i) => ({
		...obj,
		holder: keyToPos(interestingKeys[i] as number),
	}));

	const updatedObstacles = pack.obstacles.map((obs, i) => ({
		...obs,
		holder: keyToPos(obstacleKeys[i] as number),
	}));

	return {
		...pack,
		objectivePairs: updatedObjectivePairs,
		interestingObjects: updatedInterestingObjects,
		obstacles: updatedObstacles,
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
	return packs.map((pack) => {
		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			const result = tryPlacePhase(rng, pack, aiIds);
			if (result !== null) return result;
		}
		throw new Error(
			`generateContentPacks: could not place phase ${pack.phaseNumber} after ${MAX_ATTEMPTS} attempts. ` +
				`Check that m (${pack.obstacles.length}) obstacles leave enough room for AI starts and entities.`,
		);
	});
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

	// Roll k/n/m per phase
	const phaseInputs: ContentPackProviderInput["phases"] = configs.map(
		(cfg, i) => ({
			phaseNumber: cfg.phaseNumber,
			setting: drawnSettings[i] as string,
			theme: drawnThemes[i] as string,
			k: rollInt(rng, cfg.kRange[0], cfg.kRange[1]),
			n: rollInt(rng, cfg.nRange[0], cfg.nRange[1]),
			m: rollInt(rng, cfg.mRange[0], cfg.mRange[1]),
		}),
	);

	// Kick off LLM call immediately (parallel with aiIds resolution)
	const llmCallPromise = llm.generateContentPacks({ phases: phaseInputs });

	// Await both in parallel
	const [llmResult, aiIds] = await Promise.all([
		llmCallPromise,
		Promise.resolve(aiIdsOrPromise),
	]);

	// Build placeholder ContentPack structures from LLM result (no placements yet)
	const unplacedPacks: ContentPack[] = llmResult.packs.map((pack, i) => ({
		phaseNumber: pack.phaseNumber,
		setting: pack.setting,
		weather: drawnWeather[i] as string,
		timeOfDay: drawnTimeOfDay[i] as string,
		objectivePairs: pack.objectivePairs,
		interestingObjects: pack.interestingObjects as WorldEntity[],
		obstacles: pack.obstacles as WorldEntity[],
		landmarks: pack.landmarks,
		aiStarts: {},
	}));

	// Run placement engine
	return placePhases(rng, unplacedPacks, aiIds);
}

/**
 * Generate paired A/B ContentPacks for all three phases in one LLM call.
 *
 * Pack A and Pack B share identical entity IDs and grid placements; only
 * names, descriptions, and flavor strings differ (re-flavored per setting).
 *
 * @param rng        Seeded random number generator.
 * @param settings   The pool of setting nouns (must have >= 4 entries: 3 for Pack A + 1 more for Pack B pairs).
 * @param configs    The three phase configs (in order).
 * @param llm        ContentPackProvider for the LLM call.
 * @param aiIdsOrPromise  AiId list or a Promise resolving to one.
 * @returns          `{ packsA, packsB }` — placed ContentPack arrays, one per phase.
 */
export async function generateDualContentPacks(
	rng: () => number,
	settings: readonly string[],
	configs: [PhaseConfig, PhaseConfig, PhaseConfig],
	llm: ContentPackProvider,
	aiIdsOrPromise: AiId[] | Promise<AiId[]>,
): Promise<{ packsA: ContentPack[]; packsB: ContentPack[] }> {
	if (settings.length < 6) {
		throw new Error(
			`generateDualContentPacks: setting pool must have at least 6 entries (has ${settings.length})`,
		);
	}

	// Draw 6 distinct settings (3 for A, 3 for B) via partial Fisher-Yates
	const settingPool = [...settings];
	const drawnSettings: string[] = [];
	for (let i = 0; i < 6; i++) {
		const j = i + Math.floor(rng() * (settingPool.length - i));
		const tmp = settingPool[i] as string;
		settingPool[i] = settingPool[j] as string;
		settingPool[j] = tmp;
		drawnSettings.push(settingPool[i] as string);
	}
	const settingsA = drawnSettings.slice(0, 3) as [string, string, string];
	const settingsB = drawnSettings.slice(3, 6) as [string, string, string];

	// Draw weather, time-of-day, and theme independently per phase (one set each; B reuses same ambient)
	const drawnWeatherA = Array.from(
		{ length: 3 },
		() => WEATHER_POOL[Math.floor(rng() * WEATHER_POOL.length)] as string,
	);
	const drawnWeatherB = Array.from(
		{ length: 3 },
		() => WEATHER_POOL[Math.floor(rng() * WEATHER_POOL.length)] as string,
	);
	const drawnTimeOfDayA = Array.from(
		{ length: 3 },
		() =>
			TIME_OF_DAY_POOL[Math.floor(rng() * TIME_OF_DAY_POOL.length)] as string,
	);
	const drawnTimeOfDayB = Array.from(
		{ length: 3 },
		() =>
			TIME_OF_DAY_POOL[Math.floor(rng() * TIME_OF_DAY_POOL.length)] as string,
	);
	const drawnThemes = Array.from(
		{ length: 3 },
		() => THEME_POOL[Math.floor(rng() * THEME_POOL.length)] as string,
	);

	// Roll k/n/m per phase (shared between A and B — same entity counts)
	const phaseInputs: DualContentPackProviderInput["phases"] = configs.map(
		(cfg, i) => ({
			phaseNumber: cfg.phaseNumber,
			settingA: settingsA[i] as string,
			settingB: settingsB[i] as string,
			theme: drawnThemes[i] as string,
			k: rollInt(rng, cfg.kRange[0], cfg.kRange[1]),
			n: rollInt(rng, cfg.nRange[0], cfg.nRange[1]),
			m: rollInt(rng, cfg.mRange[0], cfg.mRange[1]),
		}),
	);

	// Kick off dual LLM call and aiIds resolution in parallel
	const llmCallPromise = llm.generateDualContentPacks({ phases: phaseInputs });
	const [llmResult, aiIds] = await Promise.all([
		llmCallPromise,
		Promise.resolve(aiIdsOrPromise),
	]);

	// Build unplaced Pack A and Pack B from LLM result
	const unplacedPacksA: ContentPack[] = llmResult.phases.map((ph, i) => ({
		phaseNumber: ph.phaseNumber,
		setting: ph.packA.setting,
		weather: drawnWeatherA[i] as string,
		timeOfDay: drawnTimeOfDayA[i] as string,
		objectivePairs: ph.packA.objectivePairs,
		interestingObjects: ph.packA.interestingObjects as WorldEntity[],
		obstacles: ph.packA.obstacles as WorldEntity[],
		landmarks: ph.packA.landmarks,
		aiStarts: {},
	}));

	// Run placement engine on Pack A
	const placedPacksA = placePhases(rng, unplacedPacksA, aiIds);

	// Apply the same placements to Pack B by matching entity IDs
	const packsB: ContentPack[] = llmResult.phases.map((ph, i) => {
		const placedA = placedPacksA[i] as ContentPack;

		// Build ID → holder map from placed Pack A
		const holderById = new Map<string, AiId | import("../spa/game/types.js").GridPosition>();
		for (const pair of placedA.objectivePairs) {
			holderById.set(pair.object.id, pair.object.holder);
			holderById.set(pair.space.id, pair.space.holder);
		}
		for (const obj of placedA.interestingObjects) holderById.set(obj.id, obj.holder);
		for (const obs of placedA.obstacles) holderById.set(obs.id, obs.holder);

		const applyHolder = (entity: WorldEntity): WorldEntity => ({
			...entity,
			holder: holderById.get(entity.id) ?? { row: 0, col: 0 },
		});

		return {
			phaseNumber: ph.phaseNumber,
			setting: ph.packB.setting,
			weather: drawnWeatherB[i] as string,
			timeOfDay: drawnTimeOfDayB[i] as string,
			objectivePairs: ph.packB.objectivePairs.map((pair) => ({
				object: applyHolder(pair.object),
				space: applyHolder(pair.space),
			})),
			interestingObjects: (ph.packB.interestingObjects as WorldEntity[]).map(applyHolder),
			obstacles: (ph.packB.obstacles as WorldEntity[]).map(applyHolder),
			landmarks: ph.packB.landmarks,
			aiStarts: { ...placedA.aiStarts },
		};
	});

	return { packsA: placedPacksA, packsB };
}
