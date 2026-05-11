/**
 * session-codec.ts
 *
 * Pure serialization/deserialization of GameState to/from the
 * multi-file session format described in ADR 0004.
 *
 * Files:
 *   meta.json        — createdAt, lastSavedAt, epoch, round
 *   <aiId>.txt × 3  — per-daemon conversation log (all three phases collapsed into one)
 *                      (includes chat, whisper, and witnessed-event entries inline)
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
import { DEFAULT_LANDMARKS } from "../game/direction.js";
import type {
	AiBudget,
	AiId,
	AiPersona,
	ActiveComplication,
	ContentPack,
	ConversationEntry,
	GameState,
	Objective,
	PersonaSpatialState,
	PhaseConfig,
	PhaseState,
	WorldState,
} from "../game/types.js";
import {
	deobfuscate,
	obfuscate,
	SealedBlobCorrupt,
} from "./sealed-blob-codec.js";

// ── Schema version ─────────────────────────────────────────────────────────────

/**
 * Version embedded in engine.dat. Bumped to 4 when the `chat` and `whisper`
 * ConversationEntry kinds were collapsed into a single directional `message` kind.
 * Old v3 saves used `chat`/`whisper` shapes that no longer exist in the type union.
 *
 * v5 (issue #287): added `action-failure` `ConversationEntry` variant — durable
 * per-actor record of action-tool dispatcher rejections. Old v4 saves have no
 * `action-failure` entries; no migration provided.
 * v6 (issue #293): collapsed all `Record<1|2|3, …>` phase-keyed fields into a
 * flat single-game structure. Old v5 saves surface the existing `version-mismatch`
 * result — no migration provided.
 */
export const SESSION_SCHEMA_VERSION = 6 as const;

// ── Phase config lookup ────────────────────────────────────────────────────────

const PHASE_CONFIGS: Record<1 | 2 | 3, PhaseConfig> = {
	1: PHASE_1_CONFIG,
	2: PHASE_2_CONFIG,
	3: PHASE_3_CONFIG,
};

// ── File shapes ────────────────────────────────────────────────────────────────

/**
 * Shape of a single daemon's `.txt` file.
 * Contains the AI persona definition and the active-phase conversation log.
 */
export interface DaemonFile {
	aiId: AiId;
	persona: AiPersona;
	conversationLog: ConversationEntry[];
}

/** Shape of `meta.json`. */
export interface MetaFile {
	createdAt: string;
	lastSavedAt: string;
	epoch: number;
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

/** Shape of the sealed payload inside `engine.dat`. */
export interface SealedEngine {
	schemaVersion: typeof SESSION_SCHEMA_VERSION;
	world: WorldState;
	budgets: Record<AiId, AiBudget>;
	lockedOut: AiId[];
	personaSpatial: Record<AiId, PersonaSpatialState>;
	contentPackA: ContentPack;
	contentPackB: ContentPack;
	activePackId: "A" | "B";
	weather: string;
	objectives: Objective[];
	complicationSchedule: { countdown: number; settingShiftFired: boolean };
	activeComplications: ActiveComplication[];
	isComplete: boolean;
}

/**
 * The set of serialized files that represent one session on disk.
 * `daemons` maps aiId → JSON string of `DaemonFile`.
 * `engine` is the base64 blob (or null when engine.dat is absent/corrupt).
 */
export interface SerializedSessionFiles {
	meta: string;
	daemons: Record<AiId, string>;
	engine: string | null;
}

/** Result of deserializing a session. */
export type DeserializeResult =
	| { kind: "ok"; state: GameState; createdAt: string; lastSavedAt: string }
	| { kind: "broken" }
	| { kind: "version-mismatch" };

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

	const meta: MetaFile = {
		createdAt,
		lastSavedAt,
		epoch: state.currentPhase,
		round: activePhase.round,
		personaOrder: Object.keys(state.personas),
	};

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
			conversationLog: activePhase.conversationLogs[aiId] ?? [],
		};
		daemons[aiId] = JSON.stringify(daemonFile, null, 2);
	}

	const contentPackB: ContentPack = state.contentPacks.find(
		(p) => p.phaseNumber !== activePhase.phaseNumber,
	) ?? {
		phaseNumber: 2,
		setting: "",
		weather: "",
		timeOfDay: "",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: {},
	};

	const sealedPayload: SealedEngine = {
		schemaVersion: SESSION_SCHEMA_VERSION,
		world: structuredClone(activePhase.world),
		budgets: { ...activePhase.budgets },
		lockedOut: Array.from(activePhase.lockedOut) as AiId[],
		personaSpatial: structuredClone(activePhase.personaSpatial),
		contentPackA: structuredClone(activePhase.contentPack),
		contentPackB: structuredClone(contentPackB),
		activePackId: "A",
		weather: activePhase.weather,
		objectives: [],
		complicationSchedule: { countdown: 0, settingShiftFired: false },
		activeComplications: [],
		isComplete: state.isComplete,
	};

	const engine = obfuscate(JSON.stringify(sealedPayload, null, 2));

	return {
		meta: JSON.stringify(meta, null, 2),
		daemons,
		engine,
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

	// Reconstruct a single-phase GameState from the flat v6 engine
	try {
		// Clamp epoch to valid phase number
		const epochPhase =
			([1, 2, 3] as const).find((n) => n === meta.epoch) ?? 1;
		const config = PHASE_CONFIGS[epochPhase];

		// Rebuild conversationLogs from daemon files
		const conversationLogs: Record<AiId, ConversationEntry[]> = {};
		const aiGoals: Record<AiId, string> = {};
		for (const [aiId, daemonFile] of Object.entries(daemonFiles)) {
			conversationLogs[aiId] = [...(daemonFile.conversationLog ?? [])];
			aiGoals[aiId] = "";
		}

		const contentPack = sealed.contentPackA;
		const setting = contentPack.setting;
		const weather = sealed.weather;
		const timeOfDay = contentPack.timeOfDay ?? "";
		const world = structuredClone(sealed.world);
		const budgets = { ...sealed.budgets };
		const lockedOut = new Set<AiId>(sealed.lockedOut);
		const chatLockouts = new Map<AiId, number>();
		const personaSpatial = structuredClone(sealed.personaSpatial);

		const phase: PhaseState = {
			phaseNumber: epochPhase,
			setting,
			weather,
			timeOfDay,
			contentPack,
			aiGoals,
			round: meta.round,
			world,
			budgets,
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

		const state: GameState = {
			currentPhase: epochPhase,
			isComplete: sealed.isComplete,
			personas,
			phases: [phase],
			contentPacks: [sealed.contentPackA, sealed.contentPackB],
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
