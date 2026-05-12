/**
 * content-pack-provider.ts
 *
 * ContentPackProvider interface + BrowserContentPackProvider (real) +
 * MockContentPackProvider (tests).
 *
 * The browser provider makes one non-streaming JSON-mode chat-completions call
 * to generate content packs (setting-flavored entities without placements). On
 * transient failure it retries once. CapHitError surfaces immediately.
 *
 * Issue #302: added `generateDualContentPacks` for A/B pack generation — one
 * call that produces two setting-variants of the same entity structure. Entity
 * IDs are identical across packs A and B; only names, descriptions, and flavor
 * strings differ.
 */

import { CapHitError, chatCompletionJson } from "../llm-client.js";
import type {
	AiId,
	ContentPack,
	LandmarkDescription,
	ObjectivePair,
	WorldEntity,
} from "./types";

// ── Content-pack prompt ───────────────────────────────────────────────────────

export const CONTENT_PACK_SYSTEM_PROMPT = `You generate content packs for a text-based grid game. Each content pack is for one phase of the game. Given three phases (each with a setting noun, an item theme, k objective pairs, n interesting objects, and m obstacles), produce one content pack per phase.

For each phase:
- Generate exactly k OBJECTIVE PAIRS. Each pair has:
  - An objective_object with: id (unique string), name (2-4 words, thematic to setting and theme), examineDescription (1-2 sentences naming the paired space), useOutcome (1 sentence: the actor performs a stateless action with the item — nothing about the item, the actor, or the world changes; MUST NOT reference or imply contact with the paired space, since the actor can be anywhere on the grid when using the item), pairsWithSpaceId (must match the paired space's id), placementFlavor (1 sentence containing the literal string "{actor}", fires when the object is placed on its space), proximityFlavor (1 sentence; in-fiction sensory description of what the daemon perceives when they are holding this item AND its paired space is in their own cell or directly in front of them. Written from the daemon's POV. Does NOT contain "{actor}" and MUST NOT reference placing or coupling the item.). objective_objects MUST be portable physical items a single person can pick up and carry (e.g. a tool, instrument, artifact, container) — never furniture, architecture, or fixed structures.
  - An objective_space with: id (unique string), name (2-4 words, thematic to setting and theme), examineDescription (1-2 sentences describing the space), useOutcome (1 sentence: what the daemon perceives when they activate/use this space — a stateless sensory result, first person. Does NOT say the objective is complete), satisfactionFlavor (1 sentence, third-person from a witness POV, fires as a witnessed event when the space is successfully used to satisfy the objective — does NOT contain "{actor}"), postExamineDescription (1-2 sentences: alternate examine description shown after the space has been used), postLookFlavor (1 sentence: alternate look flavor shown after the space has been used). objective_spaces are fixed locations or surfaces, not items.
- Generate exactly n INTERESTING OBJECTS with: id (unique string), name (2-4 words, thematic to setting and theme), examineDescription (1-2 sentences), useOutcome (1 sentence: the actor performs a stateless action with the item — nothing about the item, the actor, or the world changes). interesting_objects MUST be portable physical items a single person can pick up and carry — never furniture, architecture, or fixed structures.
- Generate exactly m OBSTACLES with: id (unique string), name (2-4 words, thematic to setting), examineDescription (1 sentence describing the impassable object), shiftFlavor (1 sentence, in-fiction sensory line a witness Daemon perceives when the obstacle moves one cell. Third person from witness POV. Does NOT specify a direction word (north/south/east/west). Does NOT contain {actor}.). Obstacles are fixed and impassable — never portable items. Obstacles follow the setting only and are NOT constrained by the item theme.
- Generate exactly 4 HORIZON LANDMARKS — one anchoring each cardinal direction (north, south, east, west). Each landmark is distant, unreachable, distinctive, mutually visually distinguishable, and consistent with the setting, atmosphere, and weather. Each landmark has: shortName (2-5 words, e.g. "the rusted radio tower"), horizonPhrase (a short evocative clause describing what the landmark itself looks like — its form, condition, materials — NOT where it sits relative to any viewer. The phrase is slotted into "On the horizon ahead: <shortName> — <horizonPhrase>." so it must read coherently as a continuation. Good: "rises above the platform, antenna bent toward the dark". Bad: "looms behind you in the dark" (implies position) or "stands to your left" (implies relative direction).

The theme governs the style of objective_objects, objective_spaces, and interesting_objects only:
- "mundane" — ordinary, everyday physical items and surfaces.
- "technological" — modern electronic, digital, or mechanical items and surfaces.
- "magical" — arcane, enchanted, or mystical items and surfaces.

All ids must be unique across all phases.
Names and descriptions must be thematically consistent with the setting noun, and (for objective_objects, objective_spaces, and interesting_objects) with the item theme.
placementFlavor MUST contain the literal string "{actor}".
pairsWithSpaceId on each objective_object MUST equal the id of its paired objective_space.
Each objective_object's examineDescription MUST contain the literal name of its paired objective_space (or an unambiguous noun-phrase synonym a player could match). Example: if the objective_space is named "Brass Pedestal", the object's examineDescription must contain "brass pedestal" or a clear synonym ("the pedestal", "the brass mount", etc.). The prose tell is the only AI-discoverable channel for the pairing, so it cannot be omitted.
Horizon landmark horizonPhrase MUST NOT contain any cardinal direction words (north, south, east, west) or positional phrases that imply where the landmark sits relative to the viewer (ahead, behind, in front, to your/the left, to your/the right, on the horizon, beneath you, above you).

Return ONLY valid JSON with this exact shape (no markdown, no preamble):
{
  "packs": [
    {
      "phaseNumber": <1|2|3>,
      "setting": "<setting noun>",
      "objectivePairs": [
        {
          "object": { "id": "...", "kind": "objective_object", "name": "...", "examineDescription": "...", "useOutcome": "...", "pairsWithSpaceId": "...", "placementFlavor": "...{actor}...", "proximityFlavor": "..." },
          "space": { "id": "...", "kind": "objective_space", "name": "...", "examineDescription": "...", "useOutcome": "...", "satisfactionFlavor": "...", "postExamineDescription": "...", "postLookFlavor": "..." }
        }
      ],
      "interestingObjects": [
        { "id": "...", "kind": "interesting_object", "name": "...", "examineDescription": "...", "useOutcome": "..." }
      ],
      "obstacles": [
        { "id": "...", "kind": "obstacle", "name": "...", "examineDescription": "...", "shiftFlavor": "..." }
      ],
      "landmarks": {
        "north": { "shortName": "...", "horizonPhrase": "..." },
        "south": { "shortName": "...", "horizonPhrase": "..." },
        "east":  { "shortName": "...", "horizonPhrase": "..." },
        "west":  { "shortName": "...", "horizonPhrase": "..." }
      }
    }
  ]
}`;

export interface ContentPackProviderInput {
	phases: Array<{
		phaseNumber: 1 | 2 | 3;
		setting: string;
		theme: string;
		k: number;
		n: number;
		m: number;
	}>;
}

export function buildContentPackUserMessage(
	input: ContentPackProviderInput,
): string {
	const lines = input.phases.map(
		(p) =>
			`Phase ${p.phaseNumber}: setting="${p.setting}", theme="${p.theme}", k=${p.k} objective pairs, n=${p.n} interesting objects, m=${p.m} obstacles`,
	);
	return `Generate content packs for these phases:\n${lines.join("\n")}`;
}

// ── Error type ────────────────────────────────────────────────────────────────

export class ContentPackError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ContentPackError";
	}
}

// ── Interface ─────────────────────────────────────────────────────────────────

export interface ContentPackProviderResult {
	/** Content packs WITHOUT placements or ambient draws (weather/timeOfDay are injected post-LLM). */
	packs: Array<
		Omit<ContentPack, "aiStarts" | "weather" | "timeOfDay"> & {
			aiStarts: Record<AiId, never>;
		}
	>;
}

export interface ContentPackProvider {
	generateContentPacks(
		input: ContentPackProviderInput,
	): Promise<ContentPackProviderResult>;
	generateDualContentPacks(
		input: DualContentPackProviderInput,
	): Promise<DualContentPackProviderResult>;
}

// ── Dual-pack types (issue #302) ──────────────────────────────────────────────

export const DUAL_CONTENT_PACK_SYSTEM_PROMPT = `You generate paired content packs for a text-based grid game. You are given phases, each with two settings (settingA and settingB), a shared item theme, and entity counts (k objective pairs, n interesting objects, m obstacles). For each phase produce TWO packs — Pack A (settingA) and Pack B (settingB) — where entity IDs are IDENTICAL across both packs but names and descriptions are re-flavored for the alternate setting.

For each phase produce packA and packB with the following rules:
- Entity IDs (id fields) MUST be identical between packA and packB. Choose the ids once and reuse them.
- Entity structural relationships (pairsWithSpaceId, kind) MUST be identical between packA and packB.
- These fields MUST differ (re-flavored for each setting): name, examineDescription, useOutcome (for objects), placementFlavor, proximityFlavor, landmark shortName, landmark horizonPhrase.
- The setting field at pack level MUST match settingA for packA and settingB for packB.

Entity rules (same as always):
- Generate exactly k OBJECTIVE PAIRS per pack. Each pair:
  - objective_object: id, kind="objective_object", name (2-4 words thematic to setting+theme), examineDescription (1-2 sentences naming the paired space), useOutcome (1 stateless sentence; MUST NOT imply contact with paired space), pairsWithSpaceId (matches space id), placementFlavor (1 sentence with literal "{actor}"), proximityFlavor (1 sentence; daemon's POV sensory experience; no "{actor}"; no placing/coupling language). Must be a portable physical item.
  - objective_space: id, kind="objective_space", name (2-4 words), examineDescription (1-2 sentences), useOutcome (1 sentence: stateless sensory result when daemon uses the space), satisfactionFlavor (1 sentence, third-person witness POV, fires when objective satisfied — no "{actor}"), postExamineDescription (1-2 sentences: shown after use), postLookFlavor (1 sentence: shown in look after use). Fixed location or surface.
- Generate exactly n INTERESTING OBJECTS per pack: id, kind="interesting_object", name (2-4 words), examineDescription (1-2 sentences), useOutcome (1 stateless sentence). Must be portable.
- Generate exactly m OBSTACLES per pack: id, kind="obstacle", name (2-4 words), examineDescription (1 sentence). Fixed and impassable.
- Generate exactly 4 HORIZON LANDMARKS per pack (north/south/east/west): shortName (2-5 words), horizonPhrase (evocative clause; no cardinal direction words; no positional phrases implying viewer relationship).

Global constraints:
- All ids must be unique within a pack (across phases within the same call).
- Theme ("mundane"/"technological"/"magical") governs objective_objects, objective_spaces, and interesting_objects only.
- placementFlavor MUST contain literal string "{actor}".
- pairsWithSpaceId MUST match the paired space's id.
- Each objective_object's examineDescription MUST contain the paired space's name or an unambiguous noun-phrase synonym.
- horizonPhrase MUST NOT contain: north, south, east, west, ahead, behind, in front, to your left, to your right, on the horizon, beneath you, above you.

Return ONLY valid JSON (no markdown, no preamble):
{
  "phases": [
    {
      "phaseNumber": <1|2|3>,
      "packA": {
        "setting": "<settingA>",
        "objectivePairs": [{ "object": { "id": "...", "kind": "objective_object", "name": "...", "examineDescription": "...", "useOutcome": "...", "pairsWithSpaceId": "...", "placementFlavor": "...{actor}...", "proximityFlavor": "..." }, "space": { "id": "...", "kind": "objective_space", "name": "...", "examineDescription": "...", "useOutcome": "...", "satisfactionFlavor": "...", "postExamineDescription": "...", "postLookFlavor": "..." } }],
        "interestingObjects": [{ "id": "...", "kind": "interesting_object", "name": "...", "examineDescription": "...", "useOutcome": "..." }],
        "obstacles": [{ "id": "...", "kind": "obstacle", "name": "...", "examineDescription": "..." }],
        "landmarks": { "north": { "shortName": "...", "horizonPhrase": "..." }, "south": { "shortName": "...", "horizonPhrase": "..." }, "east": { "shortName": "...", "horizonPhrase": "..." }, "west": { "shortName": "...", "horizonPhrase": "..." } }
      },
      "packB": {
        "setting": "<settingB>",
        "objectivePairs": [{ "object": { "id": "SAME_ID_AS_PACK_A", "kind": "objective_object", "name": "DIFFERENT_NAME", "examineDescription": "...", "useOutcome": "...", "pairsWithSpaceId": "SAME_AS_PACK_A", "placementFlavor": "...{actor}...", "proximityFlavor": "..." }, "space": { "id": "SAME_ID_AS_PACK_A", "kind": "objective_space", "name": "DIFFERENT_NAME", "examineDescription": "...", "useOutcome": "...", "satisfactionFlavor": "...", "postExamineDescription": "...", "postLookFlavor": "..." } }],
        "interestingObjects": [{ "id": "SAME_ID_AS_PACK_A", "kind": "interesting_object", "name": "DIFFERENT_NAME", "examineDescription": "...", "useOutcome": "..." }],
        "obstacles": [{ "id": "SAME_ID_AS_PACK_A", "kind": "obstacle", "name": "DIFFERENT_NAME", "examineDescription": "..." }],
        "landmarks": { "north": { "shortName": "...", "horizonPhrase": "..." }, "south": { "shortName": "...", "horizonPhrase": "..." }, "east": { "shortName": "...", "horizonPhrase": "..." }, "west": { "shortName": "...", "horizonPhrase": "..." } }
      }
    }
  ]
}`;

/** Input for dual-pack (A/B) generation. */
export interface DualContentPackProviderInput {
	phases: Array<{
		phaseNumber: 1 | 2 | 3;
		settingA: string;
		settingB: string;
		theme: string;
		k: number;
		n: number;
		m: number;
	}>;
}

/** One phase's A+B pack pair (no placements, no weather/timeOfDay). */
type UnplacedPack = Omit<ContentPack, "aiStarts" | "weather" | "timeOfDay"> & {
	aiStarts: Record<AiId, never>;
};

export interface DualContentPackProviderResult {
	phases: Array<{
		phaseNumber: 1 | 2 | 3;
		packA: UnplacedPack;
		packB: UnplacedPack;
	}>;
}

export function buildDualContentPackUserMessage(
	input: DualContentPackProviderInput,
): string {
	const lines = input.phases.map(
		(p) =>
			`Phase ${p.phaseNumber}: settingA="${p.settingA}", settingB="${p.settingB}", theme="${p.theme}", k=${p.k} objective pairs, n=${p.n} interesting objects, m=${p.m} obstacles`,
	);
	return `Generate dual A/B content packs for these phases:\n${lines.join("\n")}`;
}

// ── Prose-tell check ──────────────────────────────────────────────────────────

/**
 * Returns true when an objective_object's examineDescription mentions its paired
 * objective_space's name — either the literal name (case-insensitive substring)
 * or the head noun of the name (last whitespace-separated token, length >= 3).
 *
 * The head-noun fallback admits noun-phrase synonyms like "the pedestal" for a
 * space named "Brass Pedestal". The system prompt MUSTs this property; this
 * helper exists so tests and any future validator-side enforcement (see #248)
 * share one definition.
 */
export function examineMentionsPairedSpace(
	examineDescription: string,
	spaceName: string,
): boolean {
	const examineLc = examineDescription.toLowerCase();
	const spaceLc = spaceName.toLowerCase().trim();
	if (spaceLc.length === 0) return false;
	if (examineLc.includes(spaceLc)) return true;
	const tokens = spaceLc.split(/\s+/).filter((t) => t.length >= 3);
	const headNoun = tokens[tokens.length - 1];
	return headNoun !== undefined && examineLc.includes(headNoun);
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateEntity(
	raw: unknown,
	expectedKind: string,
	allIds: Set<string>,
	requireUseOutcome: boolean,
	requirePairing?: { pairsWithSpaceId?: string },
	requireShiftFlavor?: boolean,
): WorldEntity {
	if (raw == null || typeof raw !== "object") {
		throw new ContentPackError(
			`Entity is not an object: ${JSON.stringify(raw)}`,
		);
	}
	const e = raw as Record<string, unknown>;
	if (typeof e.id !== "string" || e.id.length === 0) {
		throw new ContentPackError("Entity missing string id");
	}
	if (allIds.has(e.id)) {
		throw new ContentPackError(`Duplicate entity id: ${e.id}`);
	}
	allIds.add(e.id);
	if (e.kind !== expectedKind) {
		throw new ContentPackError(
			`Entity ${e.id}: expected kind "${expectedKind}", got "${String(e.kind)}"`,
		);
	}
	if (typeof e.name !== "string" || e.name.length === 0) {
		throw new ContentPackError(`Entity ${e.id} missing name`);
	}
	if (
		typeof e.examineDescription !== "string" ||
		e.examineDescription.length === 0
	) {
		throw new ContentPackError(`Entity ${e.id} missing examineDescription`);
	}
	if (requireUseOutcome) {
		if (typeof e.useOutcome !== "string" || e.useOutcome.length === 0) {
			throw new ContentPackError(`Entity ${e.id} missing useOutcome`);
		}
	}
	if (requirePairing !== undefined) {
		// objective_object must have pairsWithSpaceId
		if (
			typeof e.pairsWithSpaceId !== "string" ||
			e.pairsWithSpaceId.length === 0
		) {
			throw new ContentPackError(
				`Objective object ${e.id} missing pairsWithSpaceId`,
			);
		}
		if (
			typeof e.placementFlavor !== "string" ||
			!e.placementFlavor.includes("{actor}")
		) {
			throw new ContentPackError(
				`Objective object ${e.id}: placementFlavor must contain "{actor}"`,
			);
		}
		if (
			typeof e.proximityFlavor !== "string" ||
			e.proximityFlavor.length === 0
		) {
			throw new ContentPackError(
				`Objective object ${e.id} missing proximityFlavor`,
			);
		}
	}

	if (requireShiftFlavor) {
		if (
			typeof e.shiftFlavor !== "string" ||
			e.shiftFlavor.length === 0 ||
			e.shiftFlavor.includes("{actor}")
		) {
			throw new ContentPackError(
				`Obstacle ${e.id}: shiftFlavor must be a non-empty string that does not contain "{actor}"`,
			);
		}
	}

	// Build entity — holder is not set here (placement done later)
	const entity: WorldEntity = {
		id: e.id,
		kind: e.kind as WorldEntity["kind"],
		name: e.name as string,
		examineDescription: e.examineDescription as string,
		holder: { row: 0, col: 0 }, // placeholder; placement will overwrite
	};
	if (typeof e.useOutcome === "string") {
		entity.useOutcome = e.useOutcome;
	}
	if (typeof e.pairsWithSpaceId === "string") {
		entity.pairsWithSpaceId = e.pairsWithSpaceId;
	}
	if (typeof e.placementFlavor === "string") {
		entity.placementFlavor = e.placementFlavor;
	}
	if (typeof e.proximityFlavor === "string") {
		entity.proximityFlavor = e.proximityFlavor;
	}
	if (typeof e.shiftFlavor === "string") {
		entity.shiftFlavor = e.shiftFlavor;
	}
	// objective_space new fields for UseSpaceObjective
	if (e.kind === "objective_space") {
		entity.useAvailable = true;
		if (typeof e.satisfactionFlavor === "string") {
			entity.satisfactionFlavor = e.satisfactionFlavor;
		}
		if (typeof e.postExamineDescription === "string") {
			entity.postExamineDescription = e.postExamineDescription;
		}
		if (typeof e.postLookFlavor === "string") {
			entity.postLookFlavor = e.postLookFlavor;
		}
	}
	return entity;
}

export function validateContentPacks(
	raw: unknown,
	input: ContentPackProviderInput,
): ContentPackProviderResult {
	if (raw == null || typeof raw !== "object") {
		throw new ContentPackError("Content pack response is not an object");
	}
	const obj = raw as Record<string, unknown>;
	if (!Array.isArray(obj.packs)) {
		throw new ContentPackError("Content pack response missing packs array");
	}
	if (obj.packs.length !== input.phases.length) {
		throw new ContentPackError(
			`Expected ${input.phases.length} packs, got ${obj.packs.length}`,
		);
	}

	const allIds = new Set<string>();
	const packs: ContentPackProviderResult["packs"] = [];

	for (const packRaw of obj.packs) {
		if (packRaw == null || typeof packRaw !== "object") {
			throw new ContentPackError("Pack entry is not an object");
		}
		const pack = packRaw as Record<string, unknown>;
		const phaseNumber = pack.phaseNumber as 1 | 2 | 3;
		if (phaseNumber !== 1 && phaseNumber !== 2 && phaseNumber !== 3) {
			throw new ContentPackError(
				`Invalid phaseNumber: ${String(pack.phaseNumber)}`,
			);
		}
		const inputPhase = input.phases.find((p) => p.phaseNumber === phaseNumber);
		if (!inputPhase) {
			throw new ContentPackError(`Unexpected phaseNumber: ${phaseNumber}`);
		}
		if (
			typeof pack.setting !== "string" ||
			pack.setting !== inputPhase.setting
		) {
			throw new ContentPackError(
				`Phase ${phaseNumber}: setting mismatch. Expected "${inputPhase.setting}", got "${String(pack.setting)}"`,
			);
		}
		if (
			!Array.isArray(pack.objectivePairs) ||
			pack.objectivePairs.length !== inputPhase.k
		) {
			throw new ContentPackError(
				`Phase ${phaseNumber}: expected ${inputPhase.k} objectivePairs, got ${Array.isArray(pack.objectivePairs) ? pack.objectivePairs.length : "non-array"}`,
			);
		}
		if (
			!Array.isArray(pack.interestingObjects) ||
			pack.interestingObjects.length !== inputPhase.n
		) {
			throw new ContentPackError(
				`Phase ${phaseNumber}: expected ${inputPhase.n} interestingObjects, got ${Array.isArray(pack.interestingObjects) ? pack.interestingObjects.length : "non-array"}`,
			);
		}
		if (
			!Array.isArray(pack.obstacles) ||
			pack.obstacles.length !== inputPhase.m
		) {
			throw new ContentPackError(
				`Phase ${phaseNumber}: expected ${inputPhase.m} obstacles, got ${Array.isArray(pack.obstacles) ? pack.obstacles.length : "non-array"}`,
			);
		}

		const objectivePairs: ObjectivePair[] = [];
		for (const pairRaw of pack.objectivePairs as unknown[]) {
			if (pairRaw == null || typeof pairRaw !== "object") {
				throw new ContentPackError("objectivePair entry is not an object");
			}
			const pair = pairRaw as Record<string, unknown>;
			const space = validateEntity(
				pair.space,
				"objective_space",
				allIds,
				false,
			);
			const object = validateEntity(
				pair.object,
				"objective_object",
				allIds,
				true,
				{},
			);
			// Verify pairsWithSpaceId resolves
			if (object.pairsWithSpaceId !== space.id) {
				throw new ContentPackError(
					`Phase ${phaseNumber}: object ${object.id} pairsWithSpaceId "${object.pairsWithSpaceId}" does not match space id "${space.id}"`,
				);
			}
			if (!examineMentionsPairedSpace(object.examineDescription, space.name)) {
				throw new ContentPackError(
					`Phase ${phaseNumber}: object ${object.id} examineDescription does not mention paired space "${space.name}"`,
				);
			}
			objectivePairs.push({ object, space });
		}

		const interestingObjects: WorldEntity[] = [];
		for (const itemRaw of pack.interestingObjects as unknown[]) {
			interestingObjects.push(
				validateEntity(itemRaw, "interesting_object", allIds, true),
			);
		}

		const obstacles: WorldEntity[] = [];
		for (const obsRaw of pack.obstacles as unknown[]) {
			obstacles.push(
				validateEntity(obsRaw, "obstacle", allIds, false, undefined, true),
			);
		}

		// Validate landmarks
		const landmarksRaw = pack.landmarks;
		if (landmarksRaw == null || typeof landmarksRaw !== "object") {
			throw new ContentPackError(
				`Phase ${phaseNumber}: missing or invalid landmarks object`,
			);
		}
		const lm = landmarksRaw as Record<string, unknown>;
		const landmarks: ContentPack["landmarks"] = {
			north: validateLandmark(lm.north, phaseNumber, "north"),
			south: validateLandmark(lm.south, phaseNumber, "south"),
			east: validateLandmark(lm.east, phaseNumber, "east"),
			west: validateLandmark(lm.west, phaseNumber, "west"),
		};

		packs.push({
			phaseNumber,
			setting: pack.setting,
			objectivePairs,
			interestingObjects,
			obstacles,
			landmarks,
			aiStarts: {} as Record<AiId, never>,
		});
	}

	return { packs };
}

/**
 * Validate a dual-pack LLM response. Ensures each phase has packA and packB
 * with identical entity IDs and matching structural relationships.
 */
export function validateDualContentPacks(
	raw: unknown,
	input: DualContentPackProviderInput,
): DualContentPackProviderResult {
	if (raw == null || typeof raw !== "object") {
		throw new ContentPackError("Dual content pack response is not an object");
	}
	const obj = raw as Record<string, unknown>;
	if (!Array.isArray(obj.phases)) {
		throw new ContentPackError(
			"Dual content pack response missing phases array",
		);
	}
	if (obj.phases.length !== input.phases.length) {
		throw new ContentPackError(
			`Expected ${input.phases.length} phases, got ${obj.phases.length}`,
		);
	}

	const resultPhases: DualContentPackProviderResult["phases"] = [];

	for (const phaseRaw of obj.phases) {
		if (phaseRaw == null || typeof phaseRaw !== "object") {
			throw new ContentPackError("Phase entry is not an object");
		}
		const phaseObj = phaseRaw as Record<string, unknown>;
		const phaseNumber = phaseObj.phaseNumber as 1 | 2 | 3;
		if (phaseNumber !== 1 && phaseNumber !== 2 && phaseNumber !== 3) {
			throw new ContentPackError(
				`Invalid phaseNumber: ${String(phaseObj.phaseNumber)}`,
			);
		}
		const inputPhase = input.phases.find((p) => p.phaseNumber === phaseNumber);
		if (!inputPhase) {
			throw new ContentPackError(`Unexpected phaseNumber: ${phaseNumber}`);
		}

		// Validate each pack independently, collecting IDs to verify parity
		const allIdsA = new Set<string>();
		const allIdsB = new Set<string>();
		const packA = validateSinglePack(
			phaseObj.packA,
			inputPhase,
			allIdsA,
			"packA",
		);
		const packB = validateSinglePack(
			phaseObj.packB,
			inputPhase,
			allIdsB,
			"packB",
		);

		// Enforce entity ID parity between packA and packB
		const idsA = [...allIdsA].sort();
		const idsB = [...allIdsB].sort();
		if (JSON.stringify(idsA) !== JSON.stringify(idsB)) {
			const onlyA = idsA.filter((id) => !allIdsB.has(id));
			const onlyB = idsB.filter((id) => !allIdsA.has(id));
			throw new ContentPackError(
				`Phase ${phaseNumber}: entity IDs mismatch between packA and packB. ` +
					`Only in A: [${onlyA.join(", ")}]. Only in B: [${onlyB.join(", ")}].`,
			);
		}

		// Enforce pairsWithSpaceId parity
		const pairingsA = new Map(
			packA.objectivePairs.map((p) => [p.object.id, p.object.pairsWithSpaceId]),
		);
		const pairingsB = new Map(
			packB.objectivePairs.map((p) => [p.object.id, p.object.pairsWithSpaceId]),
		);
		for (const [objId, spaceId] of pairingsA) {
			if (pairingsB.get(objId) !== spaceId) {
				throw new ContentPackError(
					`Phase ${phaseNumber}: pairsWithSpaceId mismatch for object "${objId}" between packA and packB`,
				);
			}
		}

		resultPhases.push({ phaseNumber, packA, packB });
	}

	return { phases: resultPhases };
}

/** Validate a single pack within a dual-pack response. */
function validateSinglePack(
	raw: unknown,
	inputPhase: DualContentPackProviderInput["phases"][number],
	allIds: Set<string>,
	label: string,
): UnplacedPack {
	if (raw == null || typeof raw !== "object") {
		throw new ContentPackError(`${label} is not an object`);
	}
	const pack = raw as Record<string, unknown>;
	if (typeof pack.setting !== "string" || pack.setting.length === 0) {
		throw new ContentPackError(`${label}: missing setting`);
	}
	if (
		!Array.isArray(pack.objectivePairs) ||
		pack.objectivePairs.length !== inputPhase.k
	) {
		throw new ContentPackError(
			`${label}: expected ${inputPhase.k} objectivePairs, got ${Array.isArray(pack.objectivePairs) ? pack.objectivePairs.length : "non-array"}`,
		);
	}
	if (
		!Array.isArray(pack.interestingObjects) ||
		pack.interestingObjects.length !== inputPhase.n
	) {
		throw new ContentPackError(
			`${label}: expected ${inputPhase.n} interestingObjects, got ${Array.isArray(pack.interestingObjects) ? pack.interestingObjects.length : "non-array"}`,
		);
	}
	if (
		!Array.isArray(pack.obstacles) ||
		pack.obstacles.length !== inputPhase.m
	) {
		throw new ContentPackError(
			`${label}: expected ${inputPhase.m} obstacles, got ${Array.isArray(pack.obstacles) ? pack.obstacles.length : "non-array"}`,
		);
	}

	const objectivePairs: ObjectivePair[] = [];
	for (const pairRaw of pack.objectivePairs as unknown[]) {
		if (pairRaw == null || typeof pairRaw !== "object") {
			throw new ContentPackError(
				`${label}: objectivePair entry is not an object`,
			);
		}
		const pair = pairRaw as Record<string, unknown>;
		const space = validateEntity(pair.space, "objective_space", allIds, false);
		const object = validateEntity(
			pair.object,
			"objective_object",
			allIds,
			true,
			{},
		);
		if (object.pairsWithSpaceId !== space.id) {
			throw new ContentPackError(
				`${label}: object ${object.id} pairsWithSpaceId "${object.pairsWithSpaceId}" does not match space id "${space.id}"`,
			);
		}
		if (!examineMentionsPairedSpace(object.examineDescription, space.name)) {
			throw new ContentPackError(
				`${label}: object ${object.id} examineDescription does not mention paired space "${space.name}"`,
			);
		}
		objectivePairs.push({ object, space });
	}

	const interestingObjects: WorldEntity[] = [];
	for (const itemRaw of pack.interestingObjects as unknown[]) {
		interestingObjects.push(
			validateEntity(itemRaw, "interesting_object", allIds, true),
		);
	}

	const obstacles: WorldEntity[] = [];
	for (const obsRaw of pack.obstacles as unknown[]) {
		obstacles.push(validateEntity(obsRaw, "obstacle", allIds, false));
	}

	const landmarksRaw = pack.landmarks;
	if (landmarksRaw == null || typeof landmarksRaw !== "object") {
		throw new ContentPackError(`${label}: missing or invalid landmarks`);
	}
	const lm = landmarksRaw as Record<string, unknown>;
	const landmarks: ContentPack["landmarks"] = {
		north: validateLandmark(lm.north, inputPhase.phaseNumber, "north"),
		south: validateLandmark(lm.south, inputPhase.phaseNumber, "south"),
		east: validateLandmark(lm.east, inputPhase.phaseNumber, "east"),
		west: validateLandmark(lm.west, inputPhase.phaseNumber, "west"),
	};

	return {
		phaseNumber: inputPhase.phaseNumber,
		setting: pack.setting,
		objectivePairs,
		interestingObjects,
		obstacles,
		landmarks,
		aiStarts: {} as Record<AiId, never>,
	};
}

/** Validate a single landmark entry from the LLM response. */
function validateLandmark(
	raw: unknown,
	phaseNumber: number,
	direction: string,
): LandmarkDescription {
	if (raw == null || typeof raw !== "object") {
		throw new ContentPackError(
			`Phase ${phaseNumber}: landmark "${direction}" is not an object`,
		);
	}
	const lm = raw as Record<string, unknown>;
	if (typeof lm.shortName !== "string" || lm.shortName.length === 0) {
		throw new ContentPackError(
			`Phase ${phaseNumber}: landmark "${direction}" missing shortName`,
		);
	}
	if (typeof lm.horizonPhrase !== "string" || lm.horizonPhrase.length === 0) {
		throw new ContentPackError(
			`Phase ${phaseNumber}: landmark "${direction}" missing horizonPhrase`,
		);
	}
	return { shortName: lm.shortName, horizonPhrase: lm.horizonPhrase };
}

// ── BrowserContentPackProvider ────────────────────────────────────────────────

export class BrowserContentPackProvider implements ContentPackProvider {
	private readonly disableReasoning: boolean;

	constructor(opts: { disableReasoning?: boolean } = {}) {
		this.disableReasoning = opts.disableReasoning ?? false;
	}

	async generateContentPacks(
		input: ContentPackProviderInput,
	): Promise<ContentPackProviderResult> {
		const messages = [
			{ role: "system" as const, content: CONTENT_PACK_SYSTEM_PROMPT },
			{ role: "user" as const, content: buildContentPackUserMessage(input) },
		];

		const attempt = async (): Promise<ContentPackProviderResult> => {
			const { content, reasoning } = await chatCompletionJson({
				messages,
				disableReasoning: this.disableReasoning,
			});

			const raw = content !== null && content !== "" ? content : reasoning;
			if (raw === null || raw === "") {
				throw new ContentPackError(
					"content-pack response has neither content nor reasoning",
				);
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				throw new ContentPackError(`content-pack JSON parse failed: ${raw}`);
			}

			return validateContentPacks(parsed, input);
		};

		try {
			return await attempt();
		} catch (err) {
			// CapHitError is not retried — surface immediately
			if (err instanceof CapHitError) throw err;
			// Retry once on any other failure
			return await attempt();
		}
	}

	async generateDualContentPacks(
		input: DualContentPackProviderInput,
	): Promise<DualContentPackProviderResult> {
		const messages = [
			{ role: "system" as const, content: DUAL_CONTENT_PACK_SYSTEM_PROMPT },
			{
				role: "user" as const,
				content: buildDualContentPackUserMessage(input),
			},
		];

		const attempt = async (): Promise<DualContentPackProviderResult> => {
			const { content, reasoning } = await chatCompletionJson({
				messages,
				disableReasoning: this.disableReasoning,
			});

			const raw = content !== null && content !== "" ? content : reasoning;
			if (raw === null || raw === "") {
				throw new ContentPackError(
					"dual content-pack response has neither content nor reasoning",
				);
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				throw new ContentPackError(
					`dual content-pack JSON parse failed: ${raw}`,
				);
			}

			return validateDualContentPacks(parsed, input);
		};

		try {
			return await attempt();
		} catch (err) {
			if (err instanceof CapHitError) throw err;
			return await attempt();
		}
	}
}

// ── MockContentPackProvider ───────────────────────────────────────────────────

export class MockContentPackProvider implements ContentPackProvider {
	readonly calls: ContentPackProviderInput[] = [];
	readonly dualCalls: DualContentPackProviderInput[] = [];
	private readonly fn: (
		input: ContentPackProviderInput,
	) => ContentPackProviderResult;
	private readonly dualFn: (
		input: DualContentPackProviderInput,
	) => DualContentPackProviderResult;

	constructor(
		fn: (input: ContentPackProviderInput) => ContentPackProviderResult,
		dualFn?: (
			input: DualContentPackProviderInput,
		) => DualContentPackProviderResult,
	) {
		this.fn = fn;
		this.dualFn = dualFn ?? (() => ({ phases: [] }));
	}

	async generateContentPacks(
		input: ContentPackProviderInput,
	): Promise<ContentPackProviderResult> {
		this.calls.push(input);
		return this.fn(input);
	}

	async generateDualContentPacks(
		input: DualContentPackProviderInput,
	): Promise<DualContentPackProviderResult> {
		this.dualCalls.push(input);
		return this.dualFn(input);
	}
}
