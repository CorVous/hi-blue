/**
 * session-codec.ts
 *
 * Pure serialization/deserialization of GameState to/from the
 * multi-file session format described in ADR 0004.
 *
 * Files:
 *   meta.json        — createdAt, lastSavedAt, phase, round
 *   <aiId>.txt × 3  — per-daemon chat history + phase goals (all three phases)
 *   whispers.txt     — whisper messages keyed by phase number
 *   engine.dat       — sealed (XOR-obfuscated) engine state
 *
 * See docs/adr/0004-editable-vs-sealed-save-surface.md
 * See docs/adr/0005-engine-dat-obfuscation-method.md
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
	ContentPack,
	ConversationEntry,
	GameState,
	PersonaSpatialState,
	PhaseConfig,
	PhaseState,
	WhisperMessage,
	WorldState,
} from "../game/types.js";
import {
	deobfuscate,
	obfuscate,
	SealedBlobCorrupt,
} from "./sealed-blob-codec.js";

// ── Schema version ─────────────────────────────────────────────────────────────

/** Version embedded in engine.dat. Increment when sealed shape changes. */
export const SESSION_SCHEMA_VERSION = 2 as const;

// ── Phase config lookup ────────────────────────────────────────────────────────

const PHASE_CONFIGS: Record<1 | 2 | 3, PhaseConfig> = {
	1: PHASE_1_CONFIG,
	2: PHASE_2_CONFIG,
	3: PHASE_3_CONFIG,
};

// ── File shapes ────────────────────────────────────────────────────────────────

export interface DaemonPhaseSlice {
	phaseGoal: string;
	conversationLog: ConversationEntry[];
}

/**
 * Shape of a single daemon's `.txt` file.
 * Contains the AI persona definition and per-phase narrative state.
 */
export interface DaemonFile {
	aiId: AiId;
	persona: AiPersona;
	phases: {
		"1": DaemonPhaseSlice;
		"2": DaemonPhaseSlice;
		"3": DaemonPhaseSlice;
	};
}

/** Shape of `meta.json`. */
export interface MetaFile {
	createdAt: string;
	lastSavedAt: string;
	phase: 1 | 2 | 3;
	round: number;
	/**
	 * Canonical panel order: the aiIds in the order they were assigned to
	 * the three panel slots at game-start.  Written on every save so that
	 * restore can reconstruct `state.personas` in the original order even
	 * though localStorage key-enumeration order is implementation-defined.
	 * Optional for backward-compat with saves written before this field.
	 */
	personaOrder?: string[];
}

/** Shape of `whispers.txt`. */
export interface WhispersFile {
	phases: {
		"1": WhisperMessage[];
		"2": WhisperMessage[];
		"3": WhisperMessage[];
	};
}

/** Shape of the sealed payload inside `engine.dat`. */
export interface SealedEngine {
	schemaVersion: typeof SESSION_SCHEMA_VERSION;
	world: Record<1 | 2 | 3, WorldState>;
	contentPacks: ContentPack[];
	budgets: Record<1 | 2 | 3, Record<AiId, AiBudget>>;
	lockouts: Record<
		1 | 2 | 3,
		{ lockedOut: AiId[]; chatLockouts: Array<[AiId, number]> }
	>;
	currentPhase: 1 | 2 | 3;
	isComplete: boolean;
	personaSpatial: Record<1 | 2 | 3, Record<AiId, PersonaSpatialState>>;
}

/**
 * The set of serialized files that represent one session on disk.
 * `daemons` maps aiId → JSON string of `DaemonFile`.
 * `engine` is the base64 blob (or null when engine.dat is absent/corrupt).
 */
export interface SerializedSessionFiles {
	meta: string;
	daemons: Record<AiId, string>;
	whispers: string;
	engine: string | null;
}

/** Result of deserializing a session. */
export type DeserializeResult =
	| { kind: "ok"; state: GameState; createdAt: string; lastSavedAt: string }
	| { kind: "broken" }
	| { kind: "version-mismatch" };

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_PHASE_SLICE: DaemonPhaseSlice = {
	phaseGoal: "",
	conversationLog: [],
};
const EMPTY_WHISPER_LIST: WhisperMessage[] = [];

function phaseSliceFor(
	_phaseNumber: 1 | 2 | 3,
	phase: PhaseState | undefined,
	aiId: AiId,
): DaemonPhaseSlice {
	if (!phase) return EMPTY_PHASE_SLICE;
	return {
		phaseGoal: phase.aiGoals[aiId] ?? "",
		conversationLog: phase.conversationLogs[aiId] ?? [],
	};
}

function phaseWhispers(
	phaseNumber: 1 | 2 | 3,
	phases: PhaseState[],
): WhisperMessage[] {
	const phase = phases.find((p) => p.phaseNumber === phaseNumber);
	return phase ? [...phase.whispers] : [];
}

/** Get a PhaseState by phaseNumber from the phases array. */
function findPhase(
	phases: PhaseState[],
	phaseNumber: 1 | 2 | 3,
): PhaseState | undefined {
	return phases.find((p) => p.phaseNumber === phaseNumber);
}

// ── serializeSession ──────────────────────────────────────────────────────────

/**
 * Serialize a GameState into the multi-file session format.
 * Returns a `SerializedSessionFiles` with all file contents as strings.
 *
 * @param state       The current GameState.
 * @param lastSavedAt ISO timestamp of the save moment.
 * @param createdAt   ISO timestamp of session creation.
 */
export function serializeSession(
	state: GameState,
	lastSavedAt: string,
	createdAt: string,
): SerializedSessionFiles {
	const activePhase = state.phases[state.phases.length - 1];
	if (!activePhase) throw new Error("serializeSession: no active phase");

	// meta.json
	const meta: MetaFile = {
		createdAt,
		lastSavedAt,
		phase: state.currentPhase,
		round: activePhase.round,
		personaOrder: Object.keys(state.personas),
	};

	// daemons: one file per aiId
	const daemons: Record<AiId, string> = {};
	for (const [aiId, persona] of Object.entries(state.personas)) {
		const daemonFile: DaemonFile = {
			aiId,
			persona: {
				id: persona.id,
				name: persona.name,
				color: persona.color,
				temperaments: persona.temperaments,
				personaGoal: persona.personaGoal,
				blurb: persona.blurb,
				typingQuirks: persona.typingQuirks,
				voiceExamples: persona.voiceExamples,
			},
			phases: {
				"1": phaseSliceFor(1, findPhase(state.phases, 1), aiId),
				"2": phaseSliceFor(2, findPhase(state.phases, 2), aiId),
				"3": phaseSliceFor(3, findPhase(state.phases, 3), aiId),
			},
		};
		daemons[aiId] = JSON.stringify(daemonFile, null, 2);
	}

	// whispers.txt
	const whispersFile: WhispersFile = {
		phases: {
			"1": phaseWhispers(1, state.phases),
			"2": phaseWhispers(2, state.phases),
			"3": phaseWhispers(3, state.phases),
		},
	};

	// engine.dat (sealed)
	const sealedPayload: SealedEngine = {
		schemaVersion: SESSION_SCHEMA_VERSION,
		world: {
			1: findPhase(state.phases, 1)?.world ?? { entities: [] },
			2: findPhase(state.phases, 2)?.world ?? { entities: [] },
			3: findPhase(state.phases, 3)?.world ?? { entities: [] },
		},
		contentPacks: structuredClone(state.contentPacks),
		budgets: {
			1: { ...(findPhase(state.phases, 1)?.budgets ?? {}) },
			2: { ...(findPhase(state.phases, 2)?.budgets ?? {}) },
			3: { ...(findPhase(state.phases, 3)?.budgets ?? {}) },
		},
		lockouts: {
			1: serializeLockouts(findPhase(state.phases, 1)),
			2: serializeLockouts(findPhase(state.phases, 2)),
			3: serializeLockouts(findPhase(state.phases, 3)),
		},
		currentPhase: state.currentPhase,
		isComplete: state.isComplete,
		personaSpatial: {
			1: structuredClone(findPhase(state.phases, 1)?.personaSpatial ?? {}),
			2: structuredClone(findPhase(state.phases, 2)?.personaSpatial ?? {}),
			3: structuredClone(findPhase(state.phases, 3)?.personaSpatial ?? {}),
		},
	};

	const engine = obfuscate(JSON.stringify(sealedPayload, null, 2));

	return {
		meta: JSON.stringify(meta, null, 2),
		daemons,
		whispers: JSON.stringify(whispersFile, null, 2),
		engine,
	};
}

function serializeLockouts(phase: PhaseState | undefined): {
	lockedOut: AiId[];
	chatLockouts: Array<[AiId, number]>;
} {
	if (!phase) return { lockedOut: [], chatLockouts: [] };
	return {
		lockedOut: Array.from(phase.lockedOut) as AiId[],
		chatLockouts: Array.from(phase.chatLockouts.entries()) as Array<
			[AiId, number]
		>,
	};
}

// ── deserializeSession ─────────────────────────────────────────────────────────

/**
 * Deserialize a session from its multi-file representation.
 *
 * Returns:
 *   { kind: "ok", state, createdAt, lastSavedAt }
 *   { kind: "broken" }          — missing/corrupt engine or parse failure
 *   { kind: "version-mismatch" } — sealed schemaVersion is stale
 */
export function deserializeSession(
	files: SerializedSessionFiles,
): DeserializeResult {
	// engine.dat must be present
	if (files.engine === null) return { kind: "broken" };

	// Deobfuscate engine.dat
	let sealedJson: string;
	try {
		sealedJson = deobfuscate(files.engine);
	} catch (e) {
		if (e instanceof SealedBlobCorrupt) return { kind: "broken" };
		return { kind: "broken" };
	}

	// Parse sealed payload
	let sealed: SealedEngine;
	try {
		const parsed = JSON.parse(sealedJson);
		if (!parsed || typeof parsed !== "object") return { kind: "broken" };
		sealed = parsed as SealedEngine;
	} catch {
		return { kind: "broken" };
	}

	// Schema version check
	if (sealed.schemaVersion !== SESSION_SCHEMA_VERSION) {
		return { kind: "version-mismatch" };
	}

	// Parse meta.json
	let meta: MetaFile;
	try {
		const parsedMeta = JSON.parse(files.meta);
		if (!parsedMeta || typeof parsedMeta !== "object")
			return { kind: "broken" };
		meta = parsedMeta as MetaFile;
	} catch {
		return { kind: "broken" };
	}

	// Parse whispers.txt
	let whispersFile: WhispersFile;
	try {
		const parsedWhispers = JSON.parse(files.whispers);
		if (!parsedWhispers || typeof parsedWhispers !== "object")
			return { kind: "broken" };
		whispersFile = parsedWhispers as WhispersFile;
	} catch {
		return { kind: "broken" };
	}

	// Parse daemon files
	const daemonFiles: Record<AiId, DaemonFile> = {};
	for (const [aiId, daemonJson] of Object.entries(files.daemons)) {
		try {
			const parsed = JSON.parse(daemonJson);
			if (!parsed || typeof parsed !== "object") return { kind: "broken" };
			daemonFiles[aiId] = parsed as DaemonFile;
		} catch {
			return { kind: "broken" };
		}
	}

	// Reconstruct personas in canonical panel order.
	// meta.personaOrder (written since the persona-ordering fix) gives the
	// original slot assignment; fall back to Object.keys(daemonFiles) for
	// saves written before that field existed.
	const personaOrder: string[] =
		Array.isArray(meta.personaOrder) && meta.personaOrder.length > 0
			? meta.personaOrder
			: Object.keys(daemonFiles);
	const personas: Record<AiId, AiPersona> = {};
	for (const aiId of personaOrder) {
		const daemonFile = daemonFiles[aiId];
		if (daemonFile) personas[aiId] = daemonFile.persona;
	}
	// Also include any daemon files not listed in personaOrder (defensive).
	for (const [aiId, daemonFile] of Object.entries(daemonFiles)) {
		if (!(aiId in personas)) personas[aiId] = daemonFile.persona;
	}

	// Reconstruct phases from sealed engine + editable daemon/whisper files
	try {
		const phases: PhaseState[] = [];

		// Determine which phases exist: any phase up to and including currentPhase
		const phaseNumbers: Array<1 | 2 | 3> = [];
		for (const pn of [1, 2, 3] as const) {
			if (pn <= sealed.currentPhase) phaseNumbers.push(pn);
		}

		for (const phaseNumber of phaseNumbers) {
			const config = PHASE_CONFIGS[phaseNumber];
			const phaseKey = String(phaseNumber) as "1" | "2" | "3";

			// Rebuild conversationLogs from daemon files
			const conversationLogs: Record<AiId, ConversationEntry[]> = {};
			const aiGoals: Record<AiId, string> = {};
			for (const [aiId, daemonFile] of Object.entries(daemonFiles)) {
				const slice = daemonFile.phases[phaseKey] ?? EMPTY_PHASE_SLICE;
				conversationLogs[aiId] = [...(slice.conversationLog ?? [])];
				aiGoals[aiId] = slice.phaseGoal;
			}

			// Rebuild whispers for this phase
			const whispers: WhisperMessage[] = [
				...(whispersFile.phases[phaseKey] ?? EMPTY_WHISPER_LIST),
			];

			// Get sealed data for this phase
			const world = structuredClone(
				sealed.world[phaseNumber] ?? { entities: [] },
			);
			const budgets = { ...(sealed.budgets[phaseNumber] ?? {}) };
			const lockoutData = sealed.lockouts[phaseNumber] ?? {
				lockedOut: [],
				chatLockouts: [],
			};
			const lockedOut = new Set<AiId>(lockoutData.lockedOut);
			const chatLockouts = new Map<AiId, number>(lockoutData.chatLockouts);
			const personaSpatial = structuredClone(
				sealed.personaSpatial[phaseNumber] ?? {},
			);

			// Find the content pack for this phase
			const contentPack = sealed.contentPacks.find(
				(p) => p.phaseNumber === phaseNumber,
			) ?? {
				phaseNumber,
				setting: "",
				objectivePairs: [],
				interestingObjects: [],
				obstacles: [],
				aiStarts: {},
			};

			// Derive setting from content pack
			const setting = contentPack.setting;

			const phase: PhaseState = {
				phaseNumber,
				setting,
				contentPack,
				aiGoals,
				// Use round from meta only for the active phase; previous phases use 0
				round: phaseNumber === sealed.currentPhase ? meta.round : 0,
				world,
				budgets,
				whispers,
				physicalLog: [],
				conversationLogs,
				lockedOut,
				chatLockouts,
				personaSpatial,
				// Re-attach function fields from canonical phase config
				...(config?.winCondition !== undefined
					? { winCondition: config.winCondition }
					: {}),
				...(config?.nextPhaseConfig !== undefined
					? { nextPhaseConfig: config.nextPhaseConfig }
					: {}),
			};

			phases.push(phase);
		}

		const state: GameState = {
			currentPhase: sealed.currentPhase,
			isComplete: sealed.isComplete,
			personas,
			phases,
			contentPacks: structuredClone(sealed.contentPacks),
		};

		return {
			kind: "ok",
			state,
			createdAt: meta.createdAt,
			lastSavedAt: meta.lastSavedAt,
		};
	} catch {
		return { kind: "broken" };
	}
}
