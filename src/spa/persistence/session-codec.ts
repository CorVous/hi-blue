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

import { DEFAULT_LANDMARKS } from "../game/direction.js";
import type {
	ActiveComplication,
	AiBudget,
	AiId,
	AiPersona,
	ContentPack,
	ConversationEntry,
	GameState,
	Objective,
	ObjectivePair,
	PersonaSpatialState,
	WorldEntity,
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
 *
 * v6 (issues #293, #294): two simultaneous changes.
 *   - #293: collapsed all `Record<1|2|3, …>` phase-keyed fields into a flat
 *     single-game structure. Old v5 saves surface the existing
 *     `version-mismatch` result — no migration provided.
 *   - #294: added `broadcast` `ConversationEntry` variant — sender-less system
 *     announcements appended to all three Daemon logs simultaneously (e.g.
 *     weather change complications). Broadcast entries ride along in the
 *     existing per-Daemon `conversationLog` array and round-trip automatically;
 *     no additional structural deserialization changes required.
 *
 * v7 (issue #302): A/B dual content-pack generation.
 *   - `contentPackA`/`contentPackB` (single-pack scalars) replaced by
 *     `contentPacksA`/`contentPacksB` (full pack arrays, one entry per phase).
 *   - `activePackId: "A" | "B"` now persisted correctly (was hardcoded "A").
 *   - Old v6 saves surface `version-mismatch` — no migration provided.
 *
 * v8 (issue #358): retire ContentPack.phaseNumber.
 *   - `phaseNumber` removed from the `ContentPack` type; packs are identified
 *     by array index rather than an embedded slot number.
 *   - Old v7 saves surface `version-mismatch` — no migration provided.
 *
 * v9 (issue #361): collapse generateDualContentPacks to single A/B pair.
 *   - `contentPacksA` and `contentPacksB` now contain exactly 1 entry each
 *     (previously held 3 entries, one per phase). Migration truncates v8 saves
 *     by keeping only the first entry of each array.
 *
 * v10 (issue #374): add `wallName` to `ContentPack`.
 *   - Old v9 saves have no `wallName`; migration defaults it to an empty
 *     string on every `ContentPack` in `contentPacksA`/`contentPacksB`.
 *     The empty default round-trips through the existing OOB cone
 *     renderer (which already treats blank `wallName` as "no flavored
 *     wall noun").
 *
 * v11 (issue #462): collapse ContentPack buckets into a flat `entities` array.
 *   - `objectivePairs`, `interestingObjects`, `boundSpaces`, `obstacles`
 *     are removed from `ContentPack`; replaced with one
 *     `entities: WorldEntity[]`.
 *   - Bucketing is derived on demand via `pack-selectors.ts`.
 *   - Migration flattens every v10 ContentPack on `contentPacksA` and
 *     `contentPacksB`, preserving canonical order: per pair, object then
 *     space; then bound spaces; then interesting objects; then obstacles.
 *
 * Bumping this constant requires either a `migrateV<old>To...` function below
 * or a new entry in `SCHEMA_ARCHIVE_MAP` (see AGENTS.md → "Bumping
 * SESSION_SCHEMA_VERSION"). `scripts/check-schema-map.mjs` enforces this on PRs.
 */
export const SESSION_SCHEMA_VERSION = 11 as const;

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
	/** Present and true on archived sessions; absent on active sessions. */
	readonly?: boolean;
	/** ISO timestamp of when the session was archived. */
	lastPlayedAt?: string;
}

/** Shape of the sealed payload inside `engine.dat`. */
export interface SealedEngine {
	schemaVersion: typeof SESSION_SCHEMA_VERSION;
	world: WorldState;
	budgets: Record<AiId, AiBudget>;
	lockedOut: AiId[];
	personaSpatial: Record<AiId, PersonaSpatialState>;
	/** All Setting A content packs (one per phase). */
	contentPacksA: ContentPack[];
	/** All Setting B content packs (one per phase, same entity IDs as A). */
	contentPacksB: ContentPack[];
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
	| {
			kind: "ok";
			state: GameState;
			createdAt: string;
			lastSavedAt: string;
			epoch: number;
	  }
	| { kind: "broken" }
	| { kind: "version-mismatch"; schemaVersion: number };

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
	epoch = 1,
): SerializedSessionFiles {
	const meta: MetaFile = {
		createdAt,
		lastSavedAt,
		epoch,
		round: state.round,
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
				// Optional — only present when the action-profile feature is on.
				// Spread so saves stay byte-identical when the field is unset.
				...(persona.actionProfile !== undefined
					? { actionProfile: persona.actionProfile }
					: {}),
			},
			conversationLog: state.conversationLogs[aiId] ?? [],
		};
		daemons[aiId] = JSON.stringify(daemonFile, null, 2);
	}

	const sealedPayload: SealedEngine = {
		schemaVersion: SESSION_SCHEMA_VERSION,
		world: structuredClone(state.world),
		budgets: { ...state.budgets },
		lockedOut: Array.from(state.lockedOut) as AiId[],
		personaSpatial: structuredClone(state.personaSpatial),
		contentPacksA: structuredClone(state.contentPacksA),
		contentPacksB: structuredClone(state.contentPacksB),
		activePackId: state.activePackId,
		weather: state.weather,
		objectives: structuredClone(state.objectives),
		complicationSchedule: state.complicationSchedule,
		activeComplications: structuredClone(state.activeComplications),
		isComplete: state.isComplete,
	};

	const engine = obfuscate(JSON.stringify(sealedPayload, null, 2));

	return {
		meta: JSON.stringify(meta, null, 2),
		daemons,
		engine,
	};
}

// ── Migration helpers ─────────────────────────────────────────────────────────

/**
 * Migrate a v8 sealed payload to v9 by truncating contentPacksA and
 * contentPacksB to their first entry. v8 stored one pack per phase (3
 * entries); v9 keeps a single pack per side.
 *
 * Sets schemaVersion to 9 so callers can chain into `migrateV9ToV10`.
 */
function migrateV8ToV9(sealed: SealedEngine): SealedEngine {
	return {
		...sealed,
		schemaVersion: 9 as unknown as typeof SESSION_SCHEMA_VERSION,
		contentPacksA: (sealed.contentPacksA ?? []).slice(0, 1),
		contentPacksB: (sealed.contentPacksB ?? []).slice(0, 1),
	};
}

/**
 * Migrate a v9 sealed payload to v10 by defaulting `wallName` to `""` on
 * every ContentPack in `contentPacksA`/`contentPacksB`. v9 packs had no
 * `wallName` field.
 *
 * Sets schemaVersion to 10 so callers can chain into `migrateV10ToV11`.
 */
function migrateV9ToV10(sealed: SealedEngine): SealedEngine {
	const addWallName = (pack: ContentPack): ContentPack =>
		typeof pack?.wallName === "string" ? pack : { ...pack, wallName: "" };
	return {
		...sealed,
		schemaVersion: 10 as unknown as typeof SESSION_SCHEMA_VERSION,
		contentPacksA: (sealed.contentPacksA ?? []).map(addWallName),
		contentPacksB: (sealed.contentPacksB ?? []).map(addWallName),
	};
}

/**
 * Migrate a v10 sealed payload to v11 by flattening each ContentPack's four
 * bucket fields (`objectivePairs`, `interestingObjects`, `boundSpaces`,
 * `obstacles`) into a single `entities: WorldEntity[]` array.
 *
 * Order preserved (matches the canonical order used by the v11 generator and
 * by the `pack-selectors` discriminators):
 *   1. For each `objectivePairs[i]`: object then space.
 *   2. All `boundSpaces` (in input order).
 *   3. All `interestingObjects` (in input order).
 *   4. All `obstacles` (in input order).
 *
 * Defensive: if a pack already carries an `entities` array (e.g. an in-flight
 * partial migration), it is used as-is rather than rebuilt from absent
 * buckets.
 */
function migrateV10ToV11(sealed: SealedEngine): SealedEngine {
	const flatten = (pack: ContentPack): ContentPack => {
		const raw = pack as unknown as {
			setting: string;
			weather: string;
			timeOfDay: string;
			objectivePairs?: ObjectivePair[];
			interestingObjects?: WorldEntity[];
			boundSpaces?: WorldEntity[];
			obstacles?: WorldEntity[];
			entities?: WorldEntity[];
			landmarks: ContentPack["landmarks"];
			wallName: string;
			aiStarts: ContentPack["aiStarts"];
		};

		if (Array.isArray(raw.entities)) {
			// Already v11-shaped; preserve as-is and strip any leftover bucket
			// fields so downstream code sees a clean ContentPack.
			return {
				setting: raw.setting,
				weather: raw.weather,
				timeOfDay: raw.timeOfDay,
				entities: raw.entities,
				landmarks: raw.landmarks,
				wallName: raw.wallName,
				aiStarts: raw.aiStarts,
			};
		}

		const entities: WorldEntity[] = [];
		for (const pair of raw.objectivePairs ?? []) {
			entities.push(pair.object);
			entities.push(pair.space);
		}
		for (const space of raw.boundSpaces ?? []) entities.push(space);
		for (const io of raw.interestingObjects ?? []) entities.push(io);
		for (const ob of raw.obstacles ?? []) entities.push(ob);

		return {
			setting: raw.setting,
			weather: raw.weather,
			timeOfDay: raw.timeOfDay,
			entities,
			landmarks: raw.landmarks,
			wallName: raw.wallName,
			aiStarts: raw.aiStarts,
		};
	};

	return {
		...sealed,
		schemaVersion: SESSION_SCHEMA_VERSION,
		contentPacksA: (sealed.contentPacksA ?? []).map(flatten),
		contentPacksB: (sealed.contentPacksB ?? []).map(flatten),
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
		sealed = parsed as unknown as SealedEngine;
	} catch {
		return { kind: "broken" };
	}

	// Schema version check and migration chain.
	// Migrations are stepwise (v8→v9→v10) so each entry stays focused on
	// one schema diff and new bumps only need a single new step.
	const rawVersion = (sealed as { schemaVersion: unknown }).schemaVersion;
	if (typeof rawVersion !== "number" || !Number.isFinite(rawVersion)) {
		return { kind: "broken" };
	}
	let version = rawVersion;
	if (version === 8) {
		sealed = migrateV8ToV9(sealed);
		version = 9;
	}
	if (version === 9) {
		sealed = migrateV9ToV10(sealed);
		version = 10;
	}
	if (version === 10) {
		sealed = migrateV10ToV11(sealed);
		version = 11;
	}
	if (version !== SESSION_SCHEMA_VERSION) {
		return { kind: "version-mismatch", schemaVersion: version };
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

	// Reconstruct a flat GameState from the v6 engine
	try {
		// Rebuild conversationLogs from daemon files
		const conversationLogs: Record<AiId, ConversationEntry[]> = {};
		for (const [aiId, daemonFile] of Object.entries(daemonFiles)) {
			conversationLogs[aiId] = [...(daemonFile.conversationLog ?? [])];
		}

		const contentPacksA = sealed.contentPacksA ?? [];
		const contentPacksB = sealed.contentPacksB ?? [];
		const contentPack = (sealed.activePackId === "B"
			? contentPacksB[0]
			: contentPacksA[0]) ?? {
			setting: "",
			weather: "",
			timeOfDay: "",
			entities: [],
			landmarks: DEFAULT_LANDMARKS,
			wallName: "",
			aiStarts: {},
		};
		const setting = contentPack.setting;
		const weather = sealed.weather;
		const timeOfDay = contentPack.timeOfDay ?? "";
		const world = structuredClone(sealed.world);
		const budgets = { ...sealed.budgets };
		const lockedOut = new Set<AiId>(sealed.lockedOut);
		const personaSpatial = structuredClone(sealed.personaSpatial);

		// Defensive defaults for legacy blobs that omit complication fields
		const complicationSchedule = sealed.complicationSchedule ?? {
			countdown: 0,
			settingShiftFired: false,
		};
		const activeComplications = sealed.activeComplications ?? [];

		const objectives: Objective[] = Array.isArray(sealed.objectives)
			? (sealed.objectives as Objective[])
			: [];

		const state: GameState = {
			isComplete: sealed.isComplete,
			personas,
			contentPack,
			setting,
			weather,
			timeOfDay,
			round: meta.round,
			world,
			budgets,
			conversationLogs,
			lockedOut,
			personaSpatial,
			complicationSchedule,
			activeComplications,
			contentPacksA,
			contentPacksB,
			activePackId: sealed.activePackId ?? "A",
			objectives: structuredClone(objectives),
		};

		return {
			kind: "ok",
			state,
			createdAt: meta.createdAt,
			lastSavedAt: meta.lastSavedAt,
			epoch: typeof meta.epoch === "number" ? meta.epoch : 1,
		};
	} catch {
		return { kind: "broken" };
	}
}
