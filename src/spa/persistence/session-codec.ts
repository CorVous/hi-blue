import type {
	ActiveComplication,
	AiBudget,
	AiId,
	AiPersona,
	ContentPack,
	ConversationEntry,
	GameState,
	Objective,
	PersonaSpatialState,
	WorldState,
} from "../game/types.js";
import {
	deobfuscate,
	obfuscate,
	SealedBlobCorrupt,
} from "./sealed-blob-codec.js";
import {
	checkVersionCompatibility,
	liveVersionBoundary,
	type VersionBoundary,
} from "./version-boundary.js";
import { SESSION_SCHEMA_VERSION } from "./version-constants.js";

export { SESSION_SCHEMA_VERSION };

export interface DaemonFile {
	aiId: AiId;
	persona: AiPersona;
	conversationLog: ConversationEntry[];
}

export interface MetaFile {
	createdAt: string;
	lastSavedAt: string;
	epoch: number;
	round: number;
	personaOrder?: string[];
	readonly?: boolean;
	lastPlayedAt?: string;
}

interface SealedEngine {
	schemaVersion: typeof SESSION_SCHEMA_VERSION;
	world: WorldState;
	budgets: Record<AiId, AiBudget>;
	lockedOut: AiId[];
	personaSpatial: Record<AiId, PersonaSpatialState>;
	contentPacksA: ContentPack[];
	contentPacksB: ContentPack[];
	activePackId: "A" | "B";
	weather: string;
	objectives: Objective[];
	complicationSchedule: { countdown: number; settingShiftFired: boolean };
	activeComplications: ActiveComplication[];
	isComplete: boolean;
}

interface StoredSealedEngine extends Omit<SealedEngine, "schemaVersion"> {
	schemaVersion: number;
}

export interface SerializedSessionFiles {
	meta: string;
	daemons: Record<AiId, string>;
	engine: string | null;
}

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

const SCHEMAS_THE_ARCHIVED_BUILD_MIGRATES_TO_11 = [8, 9, 10];
const LAST_SCHEMA_BEFORE_ARCHIVE_ONLY_BUMPS = 11;

function schemaAsArchivedBuildReadsIt(storedSchema: number): number {
	return SCHEMAS_THE_ARCHIVED_BUILD_MIGRATES_TO_11.includes(storedSchema)
		? LAST_SCHEMA_BEFORE_ARCHIVE_ONLY_BUMPS
		: storedSchema;
}

export function deserializeSession(
	files: SerializedSessionFiles,
	boundary: VersionBoundary = liveVersionBoundary(),
): DeserializeResult {
	if (files.engine === null) return { kind: "broken" };

	let sealedJson: string;
	try {
		sealedJson = deobfuscate(files.engine);
	} catch (e) {
		if (e instanceof SealedBlobCorrupt) return { kind: "broken" };
		return { kind: "broken" };
	}

	let sealed: StoredSealedEngine;
	try {
		const parsed = JSON.parse(sealedJson);
		if (!parsed || typeof parsed !== "object") return { kind: "broken" };
		sealed = parsed as StoredSealedEngine;
	} catch {
		return { kind: "broken" };
	}

	const rawVersion: unknown = sealed.schemaVersion;
	if (typeof rawVersion !== "number" || !Number.isFinite(rawVersion)) {
		return { kind: "broken" };
	}
	const version = schemaAsArchivedBuildReadsIt(rawVersion);
	const verdict = checkVersionCompatibility("session", version, boundary);
	if (verdict.kind === "mismatch") {
		return { kind: "version-mismatch", schemaVersion: version };
	}

	let meta: MetaFile;
	try {
		const parsedMeta = JSON.parse(files.meta);
		if (!parsedMeta || typeof parsedMeta !== "object")
			return { kind: "broken" };
		meta = parsedMeta as MetaFile;
	} catch {
		return { kind: "broken" };
	}

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

	const personaOrder: string[] =
		Array.isArray(meta.personaOrder) && meta.personaOrder.length > 0
			? meta.personaOrder
			: Object.keys(daemonFiles);
	const personas: Record<AiId, AiPersona> = {};
	for (const aiId of personaOrder) {
		const daemonFile = daemonFiles[aiId];
		if (daemonFile) personas[aiId] = daemonFile.persona;
	}
	for (const [aiId, daemonFile] of Object.entries(daemonFiles)) {
		if (!(aiId in personas)) personas[aiId] = daemonFile.persona;
	}

	try {
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
