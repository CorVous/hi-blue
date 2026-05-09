/**
 * game-storage.ts
 *
 * Serialises/deserialises GameState to/from localStorage so the player can
 * refresh mid-game and pick up where they left off.
 *
 * Design notes:
 * - `lockedOut: Set<AiId>` and `chatLockouts: Map<AiId, number>` are not
 *   JSON-serializable; they are converted to arrays on save and hydrated back
 *   on load.
 * - Function fields (`winCondition`, `nextPhaseConfig.winCondition`) are NOT
 *   persisted — they are re-derived from the canonical phase configs in
 *   `src/content/phases.ts` keyed on `phaseNumber`.
 * - `schemaVersion` allows future incompatible changes to be detected.
 */

import {
	PHASE_1_CONFIG,
	PHASE_2_CONFIG,
	PHASE_3_CONFIG,
} from "../../content/phases.js";
import type {
	AiBudget,
	AiId,
	AiPersona,
	ChatMessage,
	ContentPack,
	GameState,
	PersonaSpatialState,
	PhaseConfig,
	PhaseState,
	WhisperMessage,
	WorldState,
} from "../game/types.js";

// ── Schema version ────────────────────────────────────────────────────────────

export const STORAGE_KEY = "hi-blue-game-state";
export const STORAGE_SCHEMA_VERSION = 5 as const;

// ── Persisted shape ───────────────────────────────────────────────────────────

export interface PersistedPhaseState {
	phaseNumber: 1 | 2 | 3;
	setting: string;
	aiGoals: Record<AiId, string>;
	round: number;
	world: WorldState;
	budgets: Record<AiId, AiBudget>;
	chatHistories: Record<AiId, ChatMessage[]>;
	whispers: WhisperMessage[];
	lockedOut: AiId[];
	chatLockouts: Array<[AiId, number]>;
	personaSpatial: Record<AiId, PersonaSpatialState>;
}

export interface PersistedGameState {
	currentPhase: 1 | 2 | 3;
	isComplete: boolean;
	personas: Record<AiId, AiPersona>;
	phases: PersistedPhaseState[];
	contentPacks: ContentPack[];
}

export interface PersistedGame {
	schemaVersion: typeof STORAGE_SCHEMA_VERSION;
	savedAt: string;
	game: PersistedGameState;
	transcripts?: Partial<Record<AiId, string>>;
}

// ── Phase config lookup by number ─────────────────────────────────────────────

const PHASE_CONFIGS: Record<1 | 2 | 3, PhaseConfig> = {
	1: PHASE_1_CONFIG,
	2: PHASE_2_CONFIG,
	3: PHASE_3_CONFIG,
};

// ── Feature detection ─────────────────────────────────────────────────────────

const PROBE_KEY = `hi-blue-storage-probe-${Math.random().toString(36).slice(2)}`;

/**
 * Feature-detect localStorage via a probe write/remove.
 * Returns false when localStorage is disabled (privacy mode / SecurityError)
 * or not available.
 */
export function isStorageAvailable(): boolean {
	try {
		localStorage.setItem(PROBE_KEY, "1");
		localStorage.removeItem(PROBE_KEY);
		return true;
	} catch {
		return false;
	}
}

// ── Serialization ─────────────────────────────────────────────────────────────

function serializePhaseState(phase: PhaseState): PersistedPhaseState {
	return {
		phaseNumber: phase.phaseNumber,
		setting: phase.setting,
		aiGoals: { ...phase.aiGoals },
		round: phase.round,
		world: structuredClone(phase.world),
		budgets: { ...phase.budgets },
		chatHistories: Object.fromEntries(
			Object.entries(phase.chatHistories).map(([k, v]) => [k, [...v]]),
		) as Record<string, import("../game/types.js").ChatMessage[]>,
		whispers: [...phase.whispers],
		lockedOut: Array.from(phase.lockedOut) as AiId[],
		chatLockouts: Array.from(phase.chatLockouts.entries()) as Array<
			[AiId, number]
		>,
		personaSpatial: structuredClone(phase.personaSpatial),
	};
}

export function serializeGameState(state: GameState): PersistedGame {
	return {
		schemaVersion: STORAGE_SCHEMA_VERSION,
		savedAt: new Date().toISOString(),
		game: {
			currentPhase: state.currentPhase,
			isComplete: state.isComplete,
			personas: { ...state.personas },
			phases: state.phases.map(serializePhaseState),
			contentPacks: structuredClone(state.contentPacks),
		},
	};
}

// ── Deserialization ───────────────────────────────────────────────────────────

function deserializePhaseState(
	persisted: PersistedPhaseState,
	contentPacks: ContentPack[],
): PhaseState {
	const config = PHASE_CONFIGS[persisted.phaseNumber];
	// Find the content pack for this phase
	const contentPack = contentPacks.find(
		(p) => p.phaseNumber === persisted.phaseNumber,
	) ?? {
		phaseNumber: persisted.phaseNumber,
		setting: persisted.setting,
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		aiStarts: {},
	};
	return {
		phaseNumber: persisted.phaseNumber,
		setting: persisted.setting,
		contentPack,
		aiGoals: { ...persisted.aiGoals },
		round: persisted.round,
		world: structuredClone(persisted.world),
		budgets: { ...persisted.budgets },
		chatHistories: Object.fromEntries(
			Object.entries(persisted.chatHistories).map(([k, v]) => [
				k,
				[...(v ?? [])],
			]),
		) as Record<string, ChatMessage[]>,
		whispers: [...persisted.whispers],
		// physicalLog is not persisted (derived on-demand for prompts, safe to reset on reload)
		physicalLog: [],
		conversationLogs: {},
		lockedOut: new Set<AiId>(persisted.lockedOut),
		chatLockouts: new Map<AiId, number>(persisted.chatLockouts),
		personaSpatial: structuredClone(persisted.personaSpatial ?? {}),
		// Re-attach function fields from canonical config
		...(config?.winCondition !== undefined
			? { winCondition: config.winCondition }
			: {}),
		...(config?.nextPhaseConfig !== undefined
			? { nextPhaseConfig: config.nextPhaseConfig }
			: {}),
	};
}

export function deserializeGameState(persisted: PersistedGame): GameState {
	const contentPacks = persisted.game.contentPacks ?? [];
	return {
		currentPhase: persisted.game.currentPhase,
		isComplete: persisted.game.isComplete,
		personas: { ...persisted.game.personas },
		phases: persisted.game.phases.map((p) =>
			deserializePhaseState(p, contentPacks),
		),
		contentPacks,
	};
}

// ── Load / Save / Clear ───────────────────────────────────────────────────────

export type LoadResult =
	| {
			state: GameState;
			transcripts: Partial<Record<AiId, string>>;
			error?: never;
	  }
	| { state: null; error: "unavailable" | "corrupt" | "version-mismatch" }
	| { state: null; error?: never };

/**
 * Attempt to load persisted game state from localStorage.
 * Returns `{ state: null }` when nothing is saved (fresh game).
 * Returns `{ state: null, error: "..." }` when something went wrong.
 */
export function loadGame(): LoadResult {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw === null) return { state: null };

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return { state: null, error: "corrupt" };
		}

		if (
			parsed === null ||
			typeof parsed !== "object" ||
			!("schemaVersion" in parsed)
		) {
			return { state: null, error: "corrupt" };
		}

		const asObj = parsed as Record<string, unknown>;
		if (asObj.schemaVersion !== STORAGE_SCHEMA_VERSION) {
			return { state: null, error: "version-mismatch" };
		}

		const persisted = parsed as PersistedGame;
		let state: GameState;
		try {
			state = deserializeGameState(persisted);
		} catch {
			return { state: null, error: "corrupt" };
		}
		// Default transcripts to {} when the field is absent or not a plain object
		const rawTranscripts = asObj.transcripts;
		const transcripts: Partial<Record<AiId, string>> =
			rawTranscripts !== null &&
			typeof rawTranscripts === "object" &&
			!Array.isArray(rawTranscripts)
				? (rawTranscripts as Partial<Record<AiId, string>>)
				: {};
		return { state, transcripts };
	} catch {
		return { state: null, error: "unavailable" };
	}
}

export type SaveResult =
	| { ok: true }
	| { ok: false; reason: "unavailable" | "quota" | "unknown" };

/**
 * Attempt to save game state to localStorage.
 * Handles quota-exceeded and privacy-mode errors gracefully.
 */
export function saveGame(
	state: GameState,
	transcripts: Partial<Record<AiId, string>>,
): SaveResult {
	try {
		const persisted: PersistedGame = {
			...serializeGameState(state),
			transcripts,
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
		return { ok: true };
	} catch (err) {
		if (err instanceof DOMException) {
			const name = err.name;
			// QuotaExceededError is the standard name; NS_ERROR_DOM_QUOTA_REACHED
			// is a Firefox variant. SecurityError covers privacy mode.
			if (
				name === "QuotaExceededError" ||
				name === "NS_ERROR_DOM_QUOTA_REACHED"
			) {
				return { ok: false, reason: "quota" };
			}
			if (name === "SecurityError") {
				return { ok: false, reason: "unavailable" };
			}
		}
		return { ok: false, reason: "unknown" };
	}
}

/**
 * Remove the persisted game state from localStorage.
 * Errors are silently swallowed — best-effort only.
 */
export function clearGame(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// swallow
	}
}
