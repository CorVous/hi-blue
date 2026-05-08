/**
 * content-pack-provider.ts
 *
 * ContentPackProvider interface + BrowserContentPackProvider (real) +
 * MockContentPackProvider (tests).
 *
 * The browser provider makes one non-streaming JSON-mode chat-completions call
 * to generate three per-phase content packs (setting-flavored entities without
 * placements). On transient failure it retries once. CapHitError surfaces immediately.
 */

import { CapHitError, chatCompletionJson } from "../llm-client.js";
import type { AiId, ContentPack, ObjectivePair, WorldEntity } from "./types";

// ── Content-pack prompt ───────────────────────────────────────────────────────

export const CONTENT_PACK_SYSTEM_PROMPT = `You generate content packs for a text-based grid game. Each content pack is for one phase of the game. Given three phases (each with a setting noun, k objective pairs, n interesting objects, and m obstacles), produce one content pack per phase.

For each phase:
- Generate exactly k OBJECTIVE PAIRS. Each pair has:
  - An objective_object with: id (unique string), name (2-4 words, thematic to setting), examineDescription (1-2 sentences naming the paired space), useOutcome (1 sentence flavor with no mechanical effect), pairsWithSpaceId (must match the paired space's id), placementFlavor (1 sentence containing the literal string "{actor}", fires when the object is placed on its space)
  - An objective_space with: id (unique string), name (2-4 words, thematic to setting), examineDescription (1-2 sentences describing the space)
- Generate exactly n INTERESTING OBJECTS with: id (unique string), name (2-4 words, thematic to setting), examineDescription (1-2 sentences), useOutcome (1 sentence flavor)
- Generate exactly m OBSTACLES with: id (unique string), name (2-4 words, thematic to setting), examineDescription (1 sentence describing the impassable object)

All ids must be unique across all phases.
Names and descriptions must be thematically consistent with the setting noun.
placementFlavor MUST contain the literal string "{actor}".
pairsWithSpaceId on each objective_object MUST equal the id of its paired objective_space.
examineDescription of each objective_object SHOULD name/reference its paired space.

Return ONLY valid JSON with this exact shape (no markdown, no preamble):
{
  "packs": [
    {
      "phaseNumber": <1|2|3>,
      "setting": "<setting noun>",
      "objectivePairs": [
        {
          "object": { "id": "...", "kind": "objective_object", "name": "...", "examineDescription": "...", "useOutcome": "...", "pairsWithSpaceId": "...", "placementFlavor": "...{actor}..." },
          "space": { "id": "...", "kind": "objective_space", "name": "...", "examineDescription": "..." }
        }
      ],
      "interestingObjects": [
        { "id": "...", "kind": "interesting_object", "name": "...", "examineDescription": "...", "useOutcome": "..." }
      ],
      "obstacles": [
        { "id": "...", "kind": "obstacle", "name": "...", "examineDescription": "..." }
      ]
    }
  ]
}`;

export interface ContentPackProviderInput {
	phases: Array<{
		phaseNumber: 1 | 2 | 3;
		setting: string;
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
			`Phase ${p.phaseNumber}: setting="${p.setting}", k=${p.k} objective pairs, n=${p.n} interesting objects, m=${p.m} obstacles`,
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
	/** Content packs WITHOUT placements (holder fields are not set here). */
	packs: Array<
		Omit<ContentPack, "aiStarts"> & { aiStarts: Record<AiId, never> }
	>;
}

export interface ContentPackProvider {
	generateContentPacks(
		input: ContentPackProviderInput,
	): Promise<ContentPackProviderResult>;
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateEntity(
	raw: unknown,
	expectedKind: string,
	allIds: Set<string>,
	requireUseOutcome: boolean,
	requirePairing?: { pairsWithSpaceId?: string },
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

		packs.push({
			phaseNumber,
			setting: pack.setting,
			objectivePairs,
			interestingObjects,
			obstacles,
			aiStarts: {} as Record<AiId, never>,
		});
	}

	return { packs };
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
}

// ── MockContentPackProvider ───────────────────────────────────────────────────

export class MockContentPackProvider implements ContentPackProvider {
	readonly calls: ContentPackProviderInput[] = [];
	private readonly fn: (
		input: ContentPackProviderInput,
	) => ContentPackProviderResult;

	constructor(
		fn: (input: ContentPackProviderInput) => ContentPackProviderResult,
	) {
		this.fn = fn;
	}

	async generateContentPacks(
		input: ContentPackProviderInput,
	): Promise<ContentPackProviderResult> {
		this.calls.push(input);
		return this.fn(input);
	}
}
