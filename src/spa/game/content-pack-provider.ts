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
import type { BindingSkeleton, BindingPromptResult } from "./binding-prompt-builder.js";
import { buildBindingPrompt, buildDualBindingPrompt } from "./binding-prompt-builder.js";
import { validateBoundContentPack, validateBoundDualContentPack } from "./binding-aware-validator.js";
import type { RawBoundPack } from "./binding-aware-validator.js";

// ── Content-pack prompt ───────────────────────────────────────────────────────

export const CONTENT_PACK_SYSTEM_PROMPT = `You generate content packs for a text-based grid game.

You are given pre-minted entity skeletons grouped by binding type. Author ONLY the flavor fields listed for each binding. Do NOT invent new entity IDs — use EXACTLY the IDs provided.

Per-binding field requirements:

CARRY binding:
  object fields: name (2-4 words, thematic to setting+theme), examineDescription (1-2 sentences; MUST reference the paired space by name), useOutcome (1 stateless sentence), placementFlavor (1 sentence; MUST contain literal "{actor}"), proximityFlavor (1 sentence, daemon's POV; no "{actor}"; no placing language). Must be a portable physical item.
  space fields: name (2-4 words), examineDescription (1-2 sentences; MUST NOT contain use-cue or activation-cue keywords; MUST NOT have activationFlavor/satisfactionFlavor/convergence tier fields), proximityFlavor (1 sentence, daemon's POV; no "{actor}"). Fixed location.

USE_SPACE binding:
  space fields: name (2-4 words), examineDescription (1-2 sentences; MUST contain at least one activation/use cue word: "use", "activate", "press", "trigger", "engage", "operate", "lever", "button", "switch", "control", "panel", "console", "dial", "knob", "channel", "invoke", "summon", "ignite", "pull", "turn", "interact", or "mechanism"), proximityFlavor (1 sentence, daemon's POV; no "{actor}"), activationFlavor (1 sentence, world third-person; no "{actor}"; no meta-narrative), satisfactionFlavor (1 sentence, witness POV; no "{actor}"), postExamineDescription (1-2 sentences), postLookFlavor (1 sentence). FORBIDDEN: convergenceTier* fields. Fixed location.

CONVERGENCE binding:
  space fields: name (2-4 words), examineDescription (1-2 sentences; MUST hint that shared occupancy or another presence matters — e.g. "a meeting place", "where two are needed", "becomes significant when shared", "gathering point", "the space awaits company"; MUST NOT contain activation/use-cue keywords), proximityFlavor (1 sentence, daemon's POV; no "{actor}"), convergenceTier1Flavor (1 sentence, witness POV, fires when exactly one daemon is on space; no "{actor}"), convergenceTier2Flavor (1 sentence, witness POV, fires when two+ daemons share space; no "{actor}"), convergenceTier1ActorFlavor (1 sentence, first-person "you", daemon alone on space; no "{actor}"), convergenceTier2ActorFlavor (1 sentence, first-person "you", moment of convergence; no "{actor}"; sensory only). FORBIDDEN: activationFlavor, satisfactionFlavor, postExamineDescription, postLookFlavor. Fixed location.

USE_ITEM binding:
  item fields: name (2-4 words, thematic to setting+theme), examineDescription (1-2 sentences; MUST contain a verb-of-activation cue: "use", "activate", "press", "pull", "turn", "twist", "flip", "wind", "engage", "trigger", or a control noun: "control", "switch", "lever", "trigger", "button", "dial", "handle", "crank"), proximityFlavor (1 sentence, daemon's POV; no "{actor}"; no activating language), useOutcome (1 stateless sentence), activationFlavor (1 sentence, world third-person; no "{actor}"; no objective-complete language), postExamineDescription (1-2 sentences; no "{actor}"), postLookFlavor (1 sentence; no "{actor}"). Must be a portable physical item.

DECOY (always exactly 2 per pack):
  fields: name (2-4 words), examineDescription (1-2 sentences; MUST NOT contain any activation/use-cue keyword or control noun — decoys are identifiable by lack of tell), proximityFlavor (1 sentence, daemon's POV; no "{actor}"), useOutcome (1 sentence). FORBIDDEN: activationFlavor, postExamineDescription, postLookFlavor. Must be a portable physical item.

OBSTACLE:
  fields: name (2-4 words, thematic to setting), examineDescription (1 sentence), shiftFlavor (1 sentence, witness POV; no cardinal direction words; no "{actor}"). Fixed and impassable.

HORIZON LANDMARKS (always exactly 4 — north/south/east/west):
  shortName (2-5 words), horizonPhrase (evocative clause; MUST NOT contain: north, south, east, west, ahead, behind, "in front", "to your left", "to your right", "on the horizon", "beneath you", "above you").

WALL NAME: a setting-flavored 2-4 word noun phrase for the impassable boundary (e.g. "subway tunnel wall", "laboratory bulkhead").

Global rules:
- Use EXACTLY the entity IDs provided — do NOT invent your own.
- placementFlavor MUST contain the literal string "{actor}".
- activationFlavor, postExamineDescription, postLookFlavor MUST NOT contain "{actor}".
- Theme ("mundane"/"technological"/"magical") governs objects and spaces only.
- All names and descriptions must be thematically consistent with the setting.

Return ONLY valid JSON (no markdown, no preamble):
{
  "pack": {
    "setting": "<setting>",
    "wallName": "...",
    "landmarks": {
      "north": { "shortName": "...", "horizonPhrase": "..." },
      "south": { "shortName": "...", "horizonPhrase": "..." },
      "east":  { "shortName": "...", "horizonPhrase": "..." },
      "west":  { "shortName": "...", "horizonPhrase": "..." }
    },
    "bindings": [
      { "id": "carry-0", "type": "carry", "object": { "id": "carry-0-obj", "name": "...", "examineDescription": "...", "useOutcome": "...", "placementFlavor": "...{actor}...", "proximityFlavor": "..." }, "space": { "id": "carry-0-space", "name": "...", "examineDescription": "...", "proximityFlavor": "..." } },
      { "id": "useSpace-1", "type": "use_space", "space": { "id": "useSpace-1-space", "name": "...", "examineDescription": "...", "proximityFlavor": "...", "activationFlavor": "...", "satisfactionFlavor": "...", "postExamineDescription": "...", "postLookFlavor": "..." } },
      { "id": "useItem-2", "type": "use_item", "item": { "id": "useItem-2-item", "name": "...", "examineDescription": "...", "proximityFlavor": "...", "useOutcome": "...", "activationFlavor": "...", "postExamineDescription": "...", "postLookFlavor": "..." } }
    ],
    "decoys": [
      { "id": "decoy-0", "name": "...", "examineDescription": "...", "proximityFlavor": "...", "useOutcome": "..." },
      { "id": "decoy-1", "name": "...", "examineDescription": "...", "proximityFlavor": "...", "useOutcome": "..." }
    ],
    "obstacles": [
      { "id": "obstacle-0", "name": "...", "examineDescription": "...", "shiftFlavor": "..." }
    ]
  }
}`;

// ── Binding-aware input/output types (type-first authoring) ──────────────────

/** Input for binding-aware single-pack generation. */
export interface BindingContentPackInput {
	phases: Array<{
		setting: string;
		theme: string;
		weather: string;
		timeOfDay: string;
		bindings: BindingSkeleton[];
		decoyIds: [string, string];
		obstacleCount: number;
	}>;
}

/** Input for binding-aware dual-pack (A/B) generation. */
export interface DualBindingContentPackInput {
	phases: Array<{
		settingA: string;
		settingB: string;
		theme: string;
		weatherA: string;
		weatherB: string;
		timeOfDayA: string;
		timeOfDayB: string;
		bindings: BindingSkeleton[];
		decoyIds: [string, string];
		obstacleCount: number;
	}>;
}

/** Result of binding-aware single-pack generation (validated raw pack). */
export interface BindingContentPackProviderResult {
	phases: Array<{ rawPack: RawBoundPack }>;
}

/** Result of binding-aware dual-pack generation (validated raw packs). */
export interface DualBindingContentPackProviderResult {
	phases: Array<{ rawPackA: RawBoundPack; rawPackB: RawBoundPack }>;
}

// ── Legacy input types (kept for existing validator functions) ────────────────

export interface ContentPackProviderInput {
	phases: Array<{
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
		(p, i) =>
			`Phase ${i + 1}: setting="${p.setting}", theme="${p.theme}", k=${p.k} objective pairs, n=${p.n} interesting objects, m=${p.m} obstacles`,
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
	generateContentPacks(input: BindingContentPackInput): Promise<BindingContentPackProviderResult>;
	generateDualContentPacks(input: DualBindingContentPackInput): Promise<DualBindingContentPackProviderResult>;
}

// ── Dual-pack types (issue #302) ──────────────────────────────────────────────

export const DUAL_CONTENT_PACK_SYSTEM_PROMPT = `You generate paired content packs for a text-based grid game.

You are given pre-minted entity skeletons grouped by binding type. Author ONLY the flavor fields listed for each binding. Do NOT invent new entity IDs — use EXACTLY the IDs provided. Entity IDs MUST be identical across packA and packB — same binding types, same structural relationships, only re-flavor for the alternate setting.

Per-binding field requirements:

CARRY binding:
  object fields: name (2-4 words, thematic to setting+theme), examineDescription (1-2 sentences; MUST reference the paired space by name), useOutcome (1 stateless sentence), placementFlavor (1 sentence; MUST contain literal "{actor}"), proximityFlavor (1 sentence, daemon's POV; no "{actor}"; no placing language). Must be a portable physical item.
  space fields: name (2-4 words), examineDescription (1-2 sentences; MUST NOT contain use-cue or activation-cue keywords; MUST NOT have activationFlavor/satisfactionFlavor/convergence tier fields), proximityFlavor (1 sentence, daemon's POV; no "{actor}"). Fixed location.

USE_SPACE binding:
  space fields: name (2-4 words), examineDescription (1-2 sentences; MUST contain at least one activation/use cue word: "use", "activate", "press", "trigger", "engage", "operate", "lever", "button", "switch", "control", "panel", "console", "dial", "knob", "channel", "invoke", "summon", "ignite", "pull", "turn", "interact", or "mechanism"), proximityFlavor (1 sentence, daemon's POV; no "{actor}"), activationFlavor (1 sentence, world third-person; no "{actor}"; no meta-narrative), satisfactionFlavor (1 sentence, witness POV; no "{actor}"), postExamineDescription (1-2 sentences), postLookFlavor (1 sentence). FORBIDDEN: convergenceTier* fields. Fixed location.

CONVERGENCE binding:
  space fields: name (2-4 words), examineDescription (1-2 sentences; MUST hint that shared occupancy or another presence matters — e.g. "a meeting place", "where two are needed", "becomes significant when shared", "gathering point", "the space awaits company"; MUST NOT contain activation/use-cue keywords), proximityFlavor (1 sentence, daemon's POV; no "{actor}"), convergenceTier1Flavor (1 sentence, witness POV, fires when exactly one daemon is on space; no "{actor}"), convergenceTier2Flavor (1 sentence, witness POV, fires when two+ daemons share space; no "{actor}"), convergenceTier1ActorFlavor (1 sentence, first-person "you", daemon alone on space; no "{actor}"), convergenceTier2ActorFlavor (1 sentence, first-person "you", moment of convergence; no "{actor}"; sensory only). FORBIDDEN: activationFlavor, satisfactionFlavor, postExamineDescription, postLookFlavor. Fixed location.

USE_ITEM binding:
  item fields: name (2-4 words, thematic to setting+theme), examineDescription (1-2 sentences; MUST contain a verb-of-activation cue: "use", "activate", "press", "pull", "turn", "twist", "flip", "wind", "engage", "trigger", or a control noun: "control", "switch", "lever", "trigger", "button", "dial", "handle", "crank"), proximityFlavor (1 sentence, daemon's POV; no "{actor}"; no activating language), useOutcome (1 stateless sentence), activationFlavor (1 sentence, world third-person; no "{actor}"; no objective-complete language), postExamineDescription (1-2 sentences; no "{actor}"), postLookFlavor (1 sentence; no "{actor}"). Must be a portable physical item.

DECOY (always exactly 2 per pack):
  fields: name (2-4 words), examineDescription (1-2 sentences; MUST NOT contain any activation/use-cue keyword or control noun), proximityFlavor (1 sentence, daemon's POV; no "{actor}"), useOutcome (1 sentence). FORBIDDEN: activationFlavor, postExamineDescription, postLookFlavor. Must be a portable physical item.

OBSTACLE:
  fields: name (2-4 words, thematic to setting), examineDescription (1 sentence), shiftFlavor (1 sentence, witness POV; no cardinal direction words; no "{actor}"). Fixed and impassable.

HORIZON LANDMARKS (always exactly 4 — north/south/east/west):
  shortName (2-5 words), horizonPhrase (evocative clause; MUST NOT contain: north, south, east, west, ahead, behind, "in front", "to your left", "to your right", "on the horizon", "beneath you", "above you").

WALL NAME: a setting-flavored 2-4 word noun phrase for the impassable boundary.

Global rules:
- Entity IDs in packB MUST equal entity IDs in packA. Same binding types, same structural relationships. Only re-flavor for settingB.
- Use EXACTLY the entity IDs provided — do NOT invent your own.
- placementFlavor MUST contain the literal string "{actor}".
- activationFlavor, postExamineDescription, postLookFlavor MUST NOT contain "{actor}".
- Theme ("mundane"/"technological"/"magical") governs objects and spaces only.
- All names and descriptions must be thematically consistent with the setting.

Return ONLY valid JSON (no markdown, no preamble):
{
  "phases": [
    {
      "packA": { "setting": "<settingA>", "wallName": "...", "landmarks": { "north": { "shortName": "...", "horizonPhrase": "..." }, "south": { "shortName": "...", "horizonPhrase": "..." }, "east": { "shortName": "...", "horizonPhrase": "..." }, "west": { "shortName": "...", "horizonPhrase": "..." } }, "bindings": [...], "decoys": [...], "obstacles": [...] },
      "packB": { "setting": "<settingB>", "wallName": "...", "landmarks": { "north": { "shortName": "...", "horizonPhrase": "..." }, "south": { "shortName": "...", "horizonPhrase": "..." }, "east": { "shortName": "...", "horizonPhrase": "..." }, "west": { "shortName": "...", "horizonPhrase": "..." } }, "bindings": [SAME STRUCTURE/IDs as packA, DIFFERENT flavors], "decoys": [SAME IDs, DIFFERENT names/flavors], "obstacles": [SAME IDs, DIFFERENT names/flavors] }
    }
  ]
}`;

/** Input for dual-pack (A/B) generation. */
export interface DualContentPackProviderInput {
	phases: Array<{
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
		packA: UnplacedPack;
		packB: UnplacedPack;
	}>;
}

export function buildDualContentPackUserMessage(
	input: DualContentPackProviderInput,
): string {
	const lines = input.phases.map(
		(p, i) =>
			`Phase ${i + 1}: settingA="${p.settingA}", settingB="${p.settingB}", theme="${p.theme}", k=${p.k} objective pairs, n=${p.n} interesting objects, m=${p.m} obstacles`,
	);
	return `Generate dual A/B content packs for these phases:\n${lines.join("\n")}`;
}

// ── Partial-retry system prompt and builders ──────────────────────────────

export const PARTIAL_RETRY_SYSTEM_PROMPT = `You repair specific content-pack entities that failed validation. You are given a JSON fragment of failed entities from a prior content-pack generation attempt and the specific validation errors they violated.

Your task: produce corrected JSON fragments that fix the violations while preserving entity IDs and structural relationships.

Repair output shape:
{
  "repairs": [
    {
      "unitKind": "objective-pair",
      "phaseIndex": <n>,
      "object": { "id": "...", "kind": "objective_object", "name": "...", "examineDescription": "...", "useOutcome": "...", "pairsWithSpaceId": "...", "placementFlavor": "...{actor}...", "proximityFlavor": "..." },
      "space": { "id": "...", "kind": "objective_space", "name": "...", "examineDescription": "...", "activationFlavor": "...", "satisfactionFlavor": "...", "postExamineDescription": "...", "postLookFlavor": "...", "convergenceTier1Flavor": "...", "convergenceTier2Flavor": "...", "convergenceTier1ActorFlavor": "...", "convergenceTier2ActorFlavor": "..." }
    },
    {
      "unitKind": "interesting-object",
      "phaseIndex": <n>,
      "entity": { "id": "...", "kind": "interesting_object", "name": "...", "examineDescription": "...", "useOutcome": "...", "activationFlavor": "...", "postExamineDescription": "...", "postLookFlavor": "..." }
    },
    {
      "unitKind": "obstacle",
      "phaseIndex": <n>,
      "entity": { "id": "...", "kind": "obstacle", "name": "...", "examineDescription": "...", "shiftFlavor": "..." }
    }
  ]
}

Rules for repairs:

OBJECTIVE-PAIR repairs (object + space):
- placementFlavor MUST contain the literal string "{actor}".
- activationFlavor (on space) MUST NOT contain "{actor}".
- postExamineDescription (on space) MUST NOT contain "{actor}".
- postLookFlavor (on space) MUST NOT contain "{actor}".

INTERESTING-OBJECT repairs:
- examineDescription MUST contain a verb-of-activation cue (e.g. "use", "activate", "press", "pull", "turn", "twist", "flip", "wind", "engage", "trigger") or a clear control noun ("control", "switch", "lever", "trigger", "button", "dial", "handle", "crank"). This is the only AI-discoverable signal that the item is a Use-Item target.
- activationFlavor MUST NOT contain "{actor}".
- postExamineDescription MUST NOT contain "{actor}".
- postLookFlavor MUST NOT contain "{actor}".

OBSTACLE repairs:
- shiftFlavor MUST NOT contain "{actor}".

Do NOT wrap output in markdown or preamble. Return ONLY valid JSON.`;

export function buildPartialRetryUserMessage(
	input: ContentPackProviderInput,
	failingUnits: RetryUnit[],
	previousPackRaw: unknown,
): string {
	const lines: string[] = [];
	let firstPhaseIndex: number | undefined;

	for (const unit of failingUnits) {
		if (firstPhaseIndex === undefined) {
			firstPhaseIndex = unit.phaseIndex;
		}
		const phaseLabel = `Phase ${unit.phaseIndex + 1}`;

		if (unit.kind === "objective-pair") {
			const packEntry = (
				(previousPackRaw as Record<string, unknown>)?.packs as
					| unknown[]
					| undefined
			)?.[unit.phaseIndex];
			const pairs = (packEntry as Record<string, unknown>)?.objectivePairs as
				| unknown[]
				| undefined;
			const pair = pairs?.find((p: unknown) => {
				if (p == null || typeof p !== "object") return false;
				const pp = p as Record<string, unknown>;
				const pobj = pp.object as Record<string, unknown> | undefined;
				const pspace = pp.space as Record<string, unknown> | undefined;
				return pobj?.id === unit.pairId || pspace?.id === unit.pairId;
			}) as Record<string, unknown> | undefined;

			if (pair) {
				const obj = pair.object as Record<string, unknown> | undefined;
				const space = pair.space as Record<string, unknown> | undefined;
				lines.push(`${phaseLabel} objective pair (ID ${unit.pairId}):`);
				lines.push(`  object: ${JSON.stringify(obj)}`);
				lines.push(`  space (name="${space?.name}"): ${JSON.stringify(space)}`);
				lines.push(`  Note: The paired space is named "${space?.name}".`);
				lines.push(
					`  Ensure the object's examineDescription mentions this space's name or a clear synonym.`,
				);
				lines.push("");
			}
		} else if (unit.kind === "interesting-object") {
			const packEntry = (
				(previousPackRaw as Record<string, unknown>)?.packs as
					| unknown[]
					| undefined
			)?.[unit.phaseIndex];
			const items = (packEntry as Record<string, unknown>)
				?.interestingObjects as unknown[] | undefined;
			const item = items?.find((it: unknown) => {
				if (it == null || typeof it !== "object") return false;
				return (it as Record<string, unknown>).id === unit.entityId;
			}) as Record<string, unknown> | undefined;

			if (item) {
				lines.push(`${phaseLabel} interesting-object (ID ${unit.entityId}):`);
				lines.push(`  ${JSON.stringify(item)}`);
				lines.push("");
			}
		} else if (unit.kind === "obstacle") {
			const packEntry = (
				(previousPackRaw as Record<string, unknown>)?.packs as
					| unknown[]
					| undefined
			)?.[unit.phaseIndex];
			const obstacles = (packEntry as Record<string, unknown>)?.obstacles as
				| unknown[]
				| undefined;
			const obs = obstacles?.find((o: unknown) => {
				if (o == null || typeof o !== "object") return false;
				return (o as Record<string, unknown>).id === unit.entityId;
			}) as Record<string, unknown> | undefined;

			if (obs) {
				lines.push(`${phaseLabel} obstacle (ID ${unit.entityId}):`);
				lines.push(`  ${JSON.stringify(obs)}`);
				lines.push("");
			}
		}
	}

	if (firstPhaseIndex !== undefined) {
		const phaseInput = input.phases[firstPhaseIndex];
		if (phaseInput) {
			lines.push(
				`Phase context: setting="${phaseInput.setting}", theme="${phaseInput.theme}"`,
			);
		}
	}

	lines.push("");
	lines.push(
		"Produce corrected JSON repairs for the above entities that satisfies all rules.",
	);

	return lines.join("\n");
}

const STOPWORDS = new Set([
	"the",
	"and",
	"or",
	"of",
	"with",
	"for",
	"at",
	"in",
	"on",
	"a",
	"an",
]);

// ── Prose-tell check ──────────────────────────────────────────────────────────

/**
 * Returns true when an objective_object's examineDescription mentions its paired
 * objective_space's name — either the literal name (case-insensitive substring)
 * or any non-stopword token of length >= 4 from the space name.
 *
 * The token-overlap fallback admits valid tells like "stage pulley" for a
 * space named "Stage Pulley System" where neither token appears in the literal
 * name but both are substantial content words. This widens the matcher beyond
 * the head-noun fallback (see issue #382) to capture more valid adjacencies
 * while still rejecting the playtest-0007 misses. The system prompt MUSTs
 * this property; this helper exists so tests and any future validator-side
 * enforcement (see #346) share one definition.
 */
export function examineMentionsPairedSpace(
	examineDescription: string,
	spaceName: string,
): boolean {
	const examineLc = examineDescription.toLowerCase();
	const spaceLc = spaceName.toLowerCase().trim();
	if (spaceLc.length === 0) return false;
	if (examineLc.includes(spaceLc)) return true;
	const tokens = spaceLc
		.split(/\s+/)
		.filter((t) => t.length >= 4 && !STOPWORDS.has(t));
	return tokens.some((t) => examineLc.includes(t));
}

/**
 * Words that signal a space is `use`-able as an objective (issue #335), or
 * an interesting_object is a Use-Item target (issue #334). Matched as whole
 * words against the description's tokenised lowercase form so substrings
 * like "use" inside "fuse" don't pass.
 *
 * Kept in sync with the cue-word lists enumerated in
 * CONTENT_PACK_SYSTEM_PROMPT and DUAL_CONTENT_PACK_SYSTEM_PROMPT — both the
 * objective_space rule (issue #335) and the interesting_object rule (#334)
 * draw from this shared set.
 */
export const USE_TELL_KEYWORDS: readonly string[] = [
	"use",
	"used",
	"uses",
	"using",
	"useable",
	"usable",
	"activate",
	"activates",
	"activated",
	"activating",
	"activation",
	"press",
	"pressed",
	"presses",
	"pressing",
	"trigger",
	"triggered",
	"triggers",
	"triggering",
	"engage",
	"engaged",
	"engages",
	"engaging",
	"operate",
	"operated",
	"operates",
	"operating",
	"lever",
	"levers",
	"button",
	"buttons",
	"switch",
	"switches",
	"switched",
	"switching",
	"control",
	"controls",
	"controlled",
	"controlling",
	"interact",
	"interacted",
	"interacts",
	"interacting",
	"channel",
	"channels",
	"channeled",
	"channeling",
	"channelled",
	"channelling",
	"invoke",
	"invoked",
	"invokes",
	"invoking",
	"summon",
	"summoned",
	"summons",
	"summoning",
	"ignite",
	"ignited",
	"ignites",
	"igniting",
	"panel",
	"panels",
	"console",
	"consoles",
	"dial",
	"dials",
	"dialed",
	"dialing",
	"knob",
	"knobs",
	"mechanism",
	"mechanisms",
	"pull",
	"pulled",
	"pulls",
	"pulling",
	"turn",
	"turned",
	"turns",
	"turning",
	// Issue #334 — additional Use-Item cues that fit interesting_objects.
	"crank",
	"cranked",
	"cranks",
	"cranking",
	"handle",
	"handles",
	"flip",
	"flips",
	"flipped",
	"flipping",
	"twist",
	"twists",
	"twisted",
	"twisting",
	"wind",
	"winding",
];

/**
 * Returns true when an examineDescription contains at least one of the
 * activation/use cue keywords as a whole word — the AI-discoverable prose
 * tell that this entity is `use`-able as an objective. Used by both the
 * objective_space rule (issue #335) and the interesting_object Use-Item
 * tell (issue #334), parallel to `examineMentionsPairedSpace`.
 */
export function examineMentionsUseTell(examineDescription: string): boolean {
	const tokens = examineDescription.toLowerCase().match(/[a-z]+/g) ?? [];
	if (tokens.length === 0) return false;
	const tokenSet = new Set(tokens);
	for (const kw of USE_TELL_KEYWORDS) {
		if (tokenSet.has(kw)) return true;
	}
	return false;
}

/**
 * Convergence prose-tell strategy (issue #336):
 *
 * Convergence objectives also need an AI-discoverable signal that the
 * objective_space's meaning depends on shared occupancy — parallel to the
 * `examineMentionsUseTell` rule for Use-Space and `examineMentionsPairedSpace`
 * for Carry. Enforcement here is **prompt-only**: the system prompts MUST the
 * property ("examineDescription MUST hint that the space's meaning depends on
 * shared occupancy or another presence"), but no programmatic validator is
 * applied.
 *
 * A curated keyword list (e.g. meet/converge/gather/presence/together/share)
 * was considered but rejected: the same `examineDescription` is shared across
 * Carry, Use-Space, and Convergence draws (the pool composition is decided
 * after pack generation), so adding a hard convergence-keyword validator on
 * top of the existing Use-cue and paired-space rules would over-constrain
 * spaces that never end up drawn for convergence.
 *
 * The type-first system enforces structural preconditions (all four flavor
 * fields present) at binding-validation time so a Convergence candidate
 * cannot be built against a space that lacks the LLM-authored tier flavors.
 */

// ── Validation ────────────────────────────────────────────────────────────────

export type RetryUnit =
	| { kind: "objective-pair"; phaseIndex: number; pairId: string }
	| { kind: "interesting-object"; phaseIndex: number; entityId: string }
	| { kind: "obstacle"; phaseIndex: number; entityId: string }
	| { kind: "carry-binding"; phaseIndex: number; bindingId: string }
	| { kind: "use-space-binding"; phaseIndex: number; bindingId: string }
	| { kind: "use-item-binding"; phaseIndex: number; bindingId: string }
	| { kind: "convergence-binding"; phaseIndex: number; bindingId: string }
	| { kind: "decoy"; phaseIndex: number; decoyId: string };

export type ValidationRule =
	| "paired-space-tell"
	| "verb-of-activation"
	| "actor-presence"
	| "actor-exclusion"
	| "structural"
	| "missing-field"
	| "duplicate-id"
	| "wrong-count"
	| "wrong-kind"
	| "binding-forbidden-field"
	| "wrong-id";

export type ValidationError = {
	entityId: string;
	field: string;
	rule: ValidationRule;
	message: string;
	retryUnit: RetryUnit;
};

export type ValidationResult<T> =
	| { ok: true; value: T }
	| { ok: false; errors: ValidationError[] };

export type ContentPackRepair =
	| {
			unitKind: "objective-pair";
			phaseIndex: number;
			object: Record<string, unknown>;
			space: Record<string, unknown>;
	  }
	| {
			unitKind: "interesting-object";
			phaseIndex: number;
			entity: Record<string, unknown>;
	  }
	| {
			unitKind: "obstacle";
			phaseIndex: number;
			entity: Record<string, unknown>;
	  };

export interface PartialRetryResponse {
	repairs: ContentPackRepair[];
}

/**
 * Group validation errors by their retry unit, deduplicating errors that target
 * the same entity. Skip units whose pairId/entityId is empty string — those are
 * structural root-level failures that partial-retry can't repair.
 */
export function groupErrorsByRetryUnit(errors: ValidationError[]): RetryUnit[] {
	const seen = new Set<string>();
	const result: RetryUnit[] = [];

	for (const err of errors) {
		const unit = err.retryUnit;
		// Skip structural errors without an entity ID
		if (unit.kind === "objective-pair" && unit.pairId === "") continue;
		if (unit.kind === "interesting-object" && unit.entityId === "") continue;
		if (unit.kind === "obstacle" && unit.entityId === "") continue;
		if (unit.kind === "carry-binding" && unit.bindingId === "") continue;
		if (unit.kind === "use-space-binding" && unit.bindingId === "") continue;
		if (unit.kind === "use-item-binding" && unit.bindingId === "") continue;
		if (unit.kind === "convergence-binding" && unit.bindingId === "") continue;
		if (unit.kind === "decoy" && unit.decoyId === "") continue;

		let key: string;
		if (unit.kind === "objective-pair") {
			key = `${unit.kind}:${unit.phaseIndex}:${unit.pairId}`;
		} else if (unit.kind === "interesting-object") {
			key = `${unit.kind}:${unit.phaseIndex}:${unit.entityId}`;
		} else if (unit.kind === "obstacle") {
			key = `${unit.kind}:${unit.phaseIndex}:${unit.entityId}`;
		} else if (unit.kind === "carry-binding" || unit.kind === "use-space-binding" || unit.kind === "use-item-binding" || unit.kind === "convergence-binding") {
			key = `${unit.kind}:${unit.phaseIndex}:${unit.bindingId}`;
		} else {
			// decoy
			key = `${unit.kind}:${unit.phaseIndex}:${unit.decoyId}`;
		}

		if (!seen.has(key)) {
			seen.add(key);
			result.push(unit);
		}
	}

	return result;
}

/**
 * Defensively parse the partial-retry response shape `{ repairs: [...] }`.
 */
export function parsePartialRetryResponse(raw: unknown): ContentPackRepair[] {
	if (raw == null || typeof raw !== "object") {
		throw new ContentPackError(
			`partial-retry response is not an object: ${JSON.stringify(raw)}`,
		);
	}

	const obj = raw as Record<string, unknown>;
	if (!Array.isArray(obj.repairs)) {
		throw new ContentPackError(
			`partial-retry response.repairs is not an array: ${JSON.stringify(raw)}`,
		);
	}

	const repairs: ContentPackRepair[] = [];

	for (const entry of obj.repairs as unknown[]) {
		if (entry == null || typeof entry !== "object") {
			throw new ContentPackError(
				`partial-retry repair entry is not an object: ${JSON.stringify(entry)}`,
			);
		}

		const e = entry as Record<string, unknown>;
		const unitKind = e.unitKind as string | undefined;

		if (unitKind === "objective-pair") {
			if (
				typeof e.phaseIndex !== "number" ||
				e.object == null ||
				typeof e.object !== "object" ||
				e.space == null ||
				typeof e.space !== "object"
			) {
				throw new ContentPackError(
					`partial-retry objective-pair entry missing phaseIndex, object, or space: ${JSON.stringify(entry)}`,
				);
			}
			repairs.push({
				unitKind: "objective-pair",
				phaseIndex: e.phaseIndex as number,
				object: e.object as Record<string, unknown>,
				space: e.space as Record<string, unknown>,
			});
		} else if (unitKind === "interesting-object") {
			if (
				typeof e.phaseIndex !== "number" ||
				e.entity == null ||
				typeof e.entity !== "object"
			) {
				throw new ContentPackError(
					`partial-retry interesting-object entry missing phaseIndex or entity: ${JSON.stringify(entry)}`,
				);
			}
			repairs.push({
				unitKind: "interesting-object",
				phaseIndex: e.phaseIndex as number,
				entity: e.entity as Record<string, unknown>,
			});
		} else if (unitKind === "obstacle") {
			if (
				typeof e.phaseIndex !== "number" ||
				e.entity == null ||
				typeof e.entity !== "object"
			) {
				throw new ContentPackError(
					`partial-retry obstacle entry missing phaseIndex or entity: ${JSON.stringify(entry)}`,
				);
			}
			repairs.push({
				unitKind: "obstacle",
				phaseIndex: e.phaseIndex as number,
				entity: e.entity as Record<string, unknown>,
			});
		} else {
			throw new ContentPackError(
				`partial-retry entry has invalid unitKind: "${unitKind}"`,
			);
		}
	}

	return repairs;
}

/**
 * Deep-clone rawPack and splice in partial-retry repairs by entity ID.
 */
export function splicePartialRepairsIntoRawPack(
	rawPack: unknown,
	repairs: ContentPackRepair[],
): unknown {
	const cloned = structuredClone(rawPack);

	if (cloned == null || typeof cloned !== "object") {
		return cloned;
	}

	const packed = cloned as Record<string, unknown>;
	if (!Array.isArray(packed.packs)) {
		return cloned;
	}

	for (const repair of repairs) {
		const phasePack = (packed.packs as unknown[])[repair.phaseIndex];
		if (phasePack == null || typeof phasePack !== "object") {
			continue;
		}

		const pack = phasePack as Record<string, unknown>;

		if (repair.unitKind === "objective-pair") {
			if (!Array.isArray(pack.objectivePairs)) continue;
			const pairs = pack.objectivePairs as unknown[];

			// Find the pair that has an object or space with matching ID
			const objectId = (repair.object as Record<string, unknown>)?.id as
				| string
				| undefined;
			const spaceId = (repair.space as Record<string, unknown>)?.id as
				| string
				| undefined;

			for (let i = 0; i < pairs.length; i++) {
				const pair = pairs[i];
				if (pair == null || typeof pair !== "object") continue;

				const p = pair as Record<string, unknown>;
				const pObj = p.object as Record<string, unknown> | undefined;
				const pSpace = p.space as Record<string, unknown> | undefined;

				if (
					(objectId && (pObj?.id === objectId || pSpace?.id === objectId)) ||
					(spaceId && (pObj?.id === spaceId || pSpace?.id === spaceId))
				) {
					pairs[i] = { object: repair.object, space: repair.space };
					break;
				}
			}
		} else if (repair.unitKind === "interesting-object") {
			if (!Array.isArray(pack.interestingObjects)) continue;
			const items = pack.interestingObjects as unknown[];
			const entityId = (repair.entity as Record<string, unknown>)?.id as
				| string
				| undefined;

			if (entityId) {
				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					if (item == null || typeof item !== "object") continue;
					const it = item as Record<string, unknown>;
					if (it.id === entityId) {
						items[i] = repair.entity;
						break;
					}
				}
			}
		} else if (repair.unitKind === "obstacle") {
			if (!Array.isArray(pack.obstacles)) continue;
			const obstacles = pack.obstacles as unknown[];
			const entityId = (repair.entity as Record<string, unknown>)?.id as
				| string
				| undefined;

			if (entityId) {
				for (let i = 0; i < obstacles.length; i++) {
					const obs = obstacles[i];
					if (obs == null || typeof obs !== "object") continue;
					const o = obs as Record<string, unknown>;
					if (o.id === entityId) {
						obstacles[i] = repair.entity;
						break;
					}
				}
			}
		}
	}

	return cloned;
}

function validateEntity(
	raw: unknown,
	expectedKind: string,
	allIds: Set<string>,
	requireUseOutcome: boolean,
	retryUnit: RetryUnit,
	errors: ValidationError[],
	requirePairing?: { pairsWithSpaceId?: string },
	requireShiftFlavor?: boolean,
	requireConvergenceFlavors?: boolean,
	requireUseItemFlavors?: boolean,
): WorldEntity | null {
	if (raw == null || typeof raw !== "object") {
		errors.push({
			entityId: "",
			field: "<entity>",
			rule: "structural",
			message: `Entity is not an object: ${JSON.stringify(raw)}`,
			retryUnit,
		});
		return null;
	}
	const e = raw as Record<string, unknown>;
	if (typeof e.id !== "string" || e.id.length === 0) {
		errors.push({
			entityId: "",
			field: "id",
			rule: "missing-field",
			message: "Entity missing string id",
			retryUnit,
		});
		return null;
	}
	if (allIds.has(e.id)) {
		errors.push({
			entityId: e.id,
			field: "id",
			rule: "duplicate-id",
			message: `Duplicate entity id: ${e.id}`,
			retryUnit,
		});
		return null;
	}
	allIds.add(e.id);
	if (e.kind !== expectedKind) {
		errors.push({
			entityId: e.id,
			field: "kind",
			rule: "wrong-kind",
			message: `Entity ${e.id}: expected kind "${expectedKind}", got "${String(e.kind)}"`,
			retryUnit,
		});
		return null;
	}
	if (typeof e.name !== "string" || e.name.length === 0) {
		errors.push({
			entityId: e.id,
			field: "name",
			rule: "missing-field",
			message: `Entity ${e.id} missing name`,
			retryUnit,
		});
	}
	if (
		typeof e.examineDescription !== "string" ||
		e.examineDescription.length === 0
	) {
		errors.push({
			entityId: e.id,
			field: "examineDescription",
			rule: "missing-field",
			message: `Entity ${e.id} missing examineDescription`,
			retryUnit,
		});
	}
	if (requireUseOutcome) {
		if (typeof e.useOutcome !== "string" || e.useOutcome.length === 0) {
			errors.push({
				entityId: e.id,
				field: "useOutcome",
				rule: "missing-field",
				message: `Entity ${e.id} missing useOutcome`,
				retryUnit,
			});
		}
	}
	if (requirePairing !== undefined) {
		// objective_object must have pairsWithSpaceId
		if (
			typeof e.pairsWithSpaceId !== "string" ||
			e.pairsWithSpaceId.length === 0
		) {
			errors.push({
				entityId: e.id,
				field: "pairsWithSpaceId",
				rule: "missing-field",
				message: `Objective object ${e.id} missing pairsWithSpaceId`,
				retryUnit,
			});
		}
		if (typeof e.placementFlavor !== "string") {
			errors.push({
				entityId: e.id,
				field: "placementFlavor",
				rule: "structural",
				message: `Objective object ${e.id}: placementFlavor must be a string`,
				retryUnit,
			});
		}
		if (
			typeof e.placementFlavor === "string" &&
			e.placementFlavor.length > 0 &&
			!e.placementFlavor.includes("{actor}")
		) {
			errors.push({
				entityId: e.id,
				field: "placementFlavor",
				rule: "actor-presence",
				message: `Objective object ${e.id}: placementFlavor must contain the literal string "{actor}" so the actor's name is interpolated. Remove any "{actor}" tokens that are absent.`,
				retryUnit,
			});
		}
		if (
			typeof e.proximityFlavor !== "string" ||
			e.proximityFlavor.length === 0
		) {
			errors.push({
				entityId: e.id,
				field: "proximityFlavor",
				rule: "missing-field",
				message: `Objective object ${e.id} missing proximityFlavor`,
				retryUnit,
			});
		}
	}

	if (requireShiftFlavor) {
		if (typeof e.shiftFlavor !== "string" || e.shiftFlavor.length === 0) {
			errors.push({
				entityId: e.id,
				field: "shiftFlavor",
				rule: "missing-field",
				message: `Obstacle ${e.id}: shiftFlavor must be a non-empty string`,
				retryUnit,
			});
		}
		if (
			typeof e.shiftFlavor === "string" &&
			e.shiftFlavor.includes("{actor}")
		) {
			errors.push({
				entityId: e.id,
				field: "shiftFlavor",
				rule: "actor-exclusion",
				message: `Obstacle ${e.id}: shiftFlavor contains "{actor}"; the token will render literally. Remove the "{actor}" substring.`,
				retryUnit,
			});
		}
	}

	if (requireUseItemFlavors) {
		if (!examineMentionsUseTell(e.examineDescription as string)) {
			errors.push({
				entityId: e.id,
				field: "examineDescription",
				rule: "verb-of-activation",
				message: `Interesting object ${e.id}: examineDescription has no verb-of-activation cue or control noun (e.g. "use", "activate", "press", "pull", "turn", "twist", "switch", "lever", "trigger", "button"). The AI-discoverable Use-Item tell is missing; daemons may not realise the item is usable.`,
				retryUnit,
			});
		}
		if (
			typeof e.proximityFlavor !== "string" ||
			e.proximityFlavor.length === 0
		) {
			errors.push({
				entityId: e.id,
				field: "proximityFlavor",
				rule: "missing-field",
				message: `Interesting object ${e.id} missing proximityFlavor`,
				retryUnit,
			});
		}
		if (
			typeof e.activationFlavor !== "string" ||
			e.activationFlavor.length === 0
		) {
			errors.push({
				entityId: e.id,
				field: "activationFlavor",
				rule: "missing-field",
				message: `Interesting object ${e.id}: activationFlavor must be a non-empty string`,
				retryUnit,
			});
		}
		if (
			typeof e.activationFlavor === "string" &&
			e.activationFlavor.includes("{actor}")
		) {
			errors.push({
				entityId: e.id,
				field: "activationFlavor",
				rule: "actor-exclusion",
				message: `Interesting object ${e.id}: activationFlavor contains "{actor}"; the token will render literally. Remove the "{actor}" substring.`,
				retryUnit,
			});
		}
		if (
			typeof e.postExamineDescription !== "string" ||
			e.postExamineDescription.length === 0
		) {
			errors.push({
				entityId: e.id,
				field: "postExamineDescription",
				rule: "missing-field",
				message: `Interesting object ${e.id} missing postExamineDescription`,
				retryUnit,
			});
		}
		if (
			typeof e.postExamineDescription === "string" &&
			e.postExamineDescription.includes("{actor}")
		) {
			errors.push({
				entityId: e.id,
				field: "postExamineDescription",
				rule: "actor-exclusion",
				message: `Interesting object ${e.id}: postExamineDescription contains "{actor}"; the token will render literally. Remove the "{actor}" substring.`,
				retryUnit,
			});
		}
		if (e.postLookFlavor !== undefined) {
			if (
				typeof e.postLookFlavor !== "string" ||
				e.postLookFlavor.length === 0
			) {
				errors.push({
					entityId: e.id,
					field: "postLookFlavor",
					rule: "missing-field",
					message: `Interesting object ${e.id}: postLookFlavor must be a non-empty string when present`,
					retryUnit,
				});
			}
			if (
				typeof e.postLookFlavor === "string" &&
				e.postLookFlavor.includes("{actor}")
			) {
				errors.push({
					entityId: e.id,
					field: "postLookFlavor",
					rule: "actor-exclusion",
					message: `Interesting object ${e.id}: postLookFlavor contains "{actor}"; the token will render literally. Remove the "{actor}" substring.`,
					retryUnit,
				});
			}
		}
	}

	if (requireConvergenceFlavors) {
		if (
			typeof e.convergenceTier1Flavor !== "string" ||
			e.convergenceTier1Flavor.length === 0
		) {
			errors.push({
				entityId: e.id,
				field: "convergenceTier1Flavor",
				rule: "missing-field",
				message: `Objective space ${e.id}: convergenceTier1Flavor must be a non-empty string`,
				retryUnit,
			});
		}
		if (
			typeof e.convergenceTier1Flavor === "string" &&
			e.convergenceTier1Flavor.includes("{actor}")
		) {
			errors.push({
				entityId: e.id,
				field: "convergenceTier1Flavor",
				rule: "actor-exclusion",
				message: `Objective space ${e.id}: convergenceTier1Flavor contains "{actor}"; the token will render literally. Remove the "{actor}" substring.`,
				retryUnit,
			});
		}
		if (
			typeof e.convergenceTier2Flavor !== "string" ||
			e.convergenceTier2Flavor.length === 0
		) {
			errors.push({
				entityId: e.id,
				field: "convergenceTier2Flavor",
				rule: "missing-field",
				message: `Objective space ${e.id}: convergenceTier2Flavor must be a non-empty string`,
				retryUnit,
			});
		}
		if (
			typeof e.convergenceTier2Flavor === "string" &&
			e.convergenceTier2Flavor.includes("{actor}")
		) {
			errors.push({
				entityId: e.id,
				field: "convergenceTier2Flavor",
				rule: "actor-exclusion",
				message: `Objective space ${e.id}: convergenceTier2Flavor contains "{actor}"; the token will render literally. Remove the "{actor}" substring.`,
				retryUnit,
			});
		}
		// First-person actor variants (#336): delivered to Daemons standing on
		// the space; existing tier1/2 flavors fan out to non-occupant cone-witnesses.
		if (
			typeof e.convergenceTier1ActorFlavor !== "string" ||
			e.convergenceTier1ActorFlavor.length === 0
		) {
			errors.push({
				entityId: e.id,
				field: "convergenceTier1ActorFlavor",
				rule: "missing-field",
				message: `Objective space ${e.id}: convergenceTier1ActorFlavor must be a non-empty string`,
				retryUnit,
			});
		}
		if (
			typeof e.convergenceTier1ActorFlavor === "string" &&
			e.convergenceTier1ActorFlavor.includes("{actor}")
		) {
			errors.push({
				entityId: e.id,
				field: "convergenceTier1ActorFlavor",
				rule: "actor-exclusion",
				message: `Objective space ${e.id}: convergenceTier1ActorFlavor contains "{actor}"; the token will render literally. Remove the "{actor}" substring.`,
				retryUnit,
			});
		}
		if (
			typeof e.convergenceTier2ActorFlavor !== "string" ||
			e.convergenceTier2ActorFlavor.length === 0
		) {
			errors.push({
				entityId: e.id,
				field: "convergenceTier2ActorFlavor",
				rule: "missing-field",
				message: `Objective space ${e.id}: convergenceTier2ActorFlavor must be a non-empty string`,
				retryUnit,
			});
		}
		if (
			typeof e.convergenceTier2ActorFlavor === "string" &&
			e.convergenceTier2ActorFlavor.includes("{actor}")
		) {
			errors.push({
				entityId: e.id,
				field: "convergenceTier2ActorFlavor",
				rule: "actor-exclusion",
				message: `Objective space ${e.id}: convergenceTier2ActorFlavor contains "{actor}"; the token will render literally. Remove the "{actor}" substring.`,
				retryUnit,
			});
		}
	}

	// Validate proximityFlavor for objective_space (runs for all objective_space entities)
	if (e.kind === "objective_space") {
		if (
			typeof e.proximityFlavor !== "string" ||
			e.proximityFlavor.length === 0
		) {
			errors.push({
				entityId: e.id,
				field: "proximityFlavor",
				rule: "missing-field",
				message: `Objective space ${e.id} missing proximityFlavor`,
				retryUnit,
			});
		}
	}

	// Build entity — holder is not set here (placement done later)
	const entity: WorldEntity = {
		id: e.id,
		kind: e.kind as WorldEntity["kind"],
		name: (typeof e.name === "string" ? e.name : "") as string,
		examineDescription: (typeof e.examineDescription === "string"
			? e.examineDescription
			: "") as string,
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
		if (
			typeof e.activationFlavor !== "string" ||
			e.activationFlavor.length === 0
		) {
			errors.push({
				entityId: e.id,
				field: "activationFlavor",
				rule: "missing-field",
				message: `Objective space ${e.id}: activationFlavor must be a non-empty string`,
				retryUnit,
			});
		} else {
			if (
				typeof e.activationFlavor === "string" &&
				e.activationFlavor.includes("{actor}")
			) {
				errors.push({
					entityId: e.id,
					field: "activationFlavor",
					rule: "actor-exclusion",
					message: `Objective space ${e.id}: activationFlavor contains "{actor}"; the token will render literally. Remove the "{actor}" substring.`,
					retryUnit,
				});
			}
			entity.activationFlavor = e.activationFlavor;
		}
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
	if (typeof e.convergenceTier1Flavor === "string") {
		entity.convergenceTier1Flavor = e.convergenceTier1Flavor;
	}
	if (typeof e.convergenceTier2Flavor === "string") {
		entity.convergenceTier2Flavor = e.convergenceTier2Flavor;
	}
	if (typeof e.convergenceTier1ActorFlavor === "string") {
		entity.convergenceTier1ActorFlavor = e.convergenceTier1ActorFlavor;
	}
	if (typeof e.convergenceTier2ActorFlavor === "string") {
		entity.convergenceTier2ActorFlavor = e.convergenceTier2ActorFlavor;
	}
	// interesting_object Use-Item flavor fields (issue #334)
	if (e.kind === "interesting_object") {
		if (typeof e.activationFlavor === "string") {
			entity.activationFlavor = e.activationFlavor;
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
): ValidationResult<ContentPackProviderResult> {
	const errors: ValidationError[] = [];

	if (raw == null || typeof raw !== "object") {
		errors.push({
			entityId: "",
			field: "<root>",
			rule: "structural",
			message: "Content pack response is not an object",
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
		return { ok: false, errors };
	}
	const obj = raw as Record<string, unknown>;
	if (!Array.isArray(obj.packs)) {
		errors.push({
			entityId: "",
			field: "packs",
			rule: "missing-field",
			message: "Content pack response missing packs array",
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
		return { ok: false, errors };
	}
	if (obj.packs.length !== input.phases.length) {
		errors.push({
			entityId: "",
			field: "packs",
			rule: "wrong-count",
			message: `Expected ${input.phases.length} packs, got ${obj.packs.length}`,
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
		return { ok: false, errors };
	}

	const allIds = new Set<string>();
	const packs: ContentPackProviderResult["packs"] = [];

	for (let i = 0; i < obj.packs.length; i++) {
		const packRaw = obj.packs[i];
		if (packRaw == null || typeof packRaw !== "object") {
			errors.push({
				entityId: "",
				field: "pack",
				rule: "structural",
				message: `Phase ${i + 1}: pack entry is not an object`,
				retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: "" },
			});
			continue;
		}
		const pack = packRaw as Record<string, unknown>;
		const inputPhase = input.phases[i];
		if (!inputPhase) {
			errors.push({
				entityId: "",
				field: "phase",
				rule: "structural",
				message: `No input phase for pack index ${i}`,
				retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: "" },
			});
			continue;
		}
		const phaseLabel = `Phase ${i + 1}`;
		if (
			typeof pack.setting !== "string" ||
			pack.setting !== inputPhase.setting
		) {
			errors.push({
				entityId: "",
				field: "setting",
				rule: "structural",
				message: `${phaseLabel}: setting mismatch. Expected "${inputPhase.setting}", got "${String(pack.setting)}"`,
				retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: "" },
			});
			continue;
		}
		if (
			!Array.isArray(pack.objectivePairs) ||
			pack.objectivePairs.length !== inputPhase.k
		) {
			errors.push({
				entityId: "",
				field: "objectivePairs",
				rule: "wrong-count",
				message: `${phaseLabel}: expected ${inputPhase.k} objectivePairs, got ${Array.isArray(pack.objectivePairs) ? pack.objectivePairs.length : "non-array"}`,
				retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: "" },
			});
		}
		if (
			!Array.isArray(pack.interestingObjects) ||
			pack.interestingObjects.length !== inputPhase.n
		) {
			errors.push({
				entityId: "",
				field: "interestingObjects",
				rule: "wrong-count",
				message: `${phaseLabel}: expected ${inputPhase.n} interestingObjects, got ${Array.isArray(pack.interestingObjects) ? pack.interestingObjects.length : "non-array"}`,
				retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: "" },
			});
		}
		if (
			!Array.isArray(pack.obstacles) ||
			pack.obstacles.length !== inputPhase.m
		) {
			errors.push({
				entityId: "",
				field: "obstacles",
				rule: "wrong-count",
				message: `${phaseLabel}: expected ${inputPhase.m} obstacles, got ${Array.isArray(pack.obstacles) ? pack.obstacles.length : "non-array"}`,
				retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: "" },
			});
		}

		const objectivePairs: ObjectivePair[] = [];
		if (Array.isArray(pack.objectivePairs)) {
			for (const pairRaw of pack.objectivePairs as unknown[]) {
				if (pairRaw == null || typeof pairRaw !== "object") {
					errors.push({
						entityId: "",
						field: "pair",
						rule: "structural",
						message: `${phaseLabel}: objectivePair entry is not an object`,
						retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: "" },
					});
					continue;
				}
				const pair = pairRaw as Record<string, unknown>;
				const pairId =
					((pair.object as Record<string, unknown>)?.id as
						| string
						| undefined) ??
					((pair.space as Record<string, unknown>)?.id as string | undefined) ??
					"";
				const retryUnit = {
					kind: "objective-pair" as const,
					phaseIndex: i,
					pairId,
				};
				const space = validateEntity(
					pair.space,
					"objective_space",
					allIds,
					false,
					retryUnit,
					errors,
					undefined,
					false,
					true,
				);
				const object = validateEntity(
					pair.object,
					"objective_object",
					allIds,
					true,
					retryUnit,
					errors,
					{},
				);
				if (space === null || object === null) {
					continue;
				}
				// Verify pairsWithSpaceId resolves
				if (object.pairsWithSpaceId !== space.id) {
					errors.push({
						entityId: object.id,
						field: "pairsWithSpaceId",
						rule: "structural",
						message: `${phaseLabel}: object ${object.id} pairsWithSpaceId "${object.pairsWithSpaceId}" does not match space id "${space.id}"`,
						retryUnit,
					});
					continue;
				}
				if (
					!examineMentionsPairedSpace(object.examineDescription, space.name)
				) {
					errors.push({
						entityId: object.id,
						field: "examineDescription",
						rule: "paired-space-tell",
						message: `${phaseLabel}: object ${object.id} examineDescription does not mention paired space "${space.name}" (the AI-discoverable pairing tell). Reference the space's name or a clear noun-phrase synonym.`,
						retryUnit,
					});
				}
				if (!examineMentionsUseTell(space.examineDescription)) {
					console.warn(
						`${phaseLabel}: space ${space.id} examineDescription has no use/activation cue word (the AI-discoverable prose tell that the space is \`use\`-able as an objective).`,
					);
				}
				objectivePairs.push({ object, space });
			}
		}

		const interestingObjects: WorldEntity[] = [];
		if (Array.isArray(pack.interestingObjects)) {
			for (const itemRaw of pack.interestingObjects as unknown[]) {
				const retryUnit = {
					kind: "interesting-object" as const,
					phaseIndex: i,
					entityId:
						((itemRaw as Record<string, unknown>)?.id as string | undefined) ??
						"",
				};
				const entity = validateEntity(
					itemRaw,
					"interesting_object",
					allIds,
					true,
					retryUnit,
					errors,
					undefined,
					false,
					false,
					true,
				);
				if (entity !== null) {
					interestingObjects.push(entity);
				}
			}
		}

		const obstacles: WorldEntity[] = [];
		if (Array.isArray(pack.obstacles)) {
			for (const obsRaw of pack.obstacles as unknown[]) {
				const retryUnit = {
					kind: "obstacle" as const,
					phaseIndex: i,
					entityId:
						((obsRaw as Record<string, unknown>)?.id as string | undefined) ??
						"",
				};
				const entity = validateEntity(
					obsRaw,
					"obstacle",
					allIds,
					false,
					retryUnit,
					errors,
					undefined,
					true,
				);
				if (entity !== null) {
					obstacles.push(entity);
				}
			}
		}

		// Validate landmarks
		const landmarksRaw = pack.landmarks;
		if (landmarksRaw == null || typeof landmarksRaw !== "object") {
			errors.push({
				entityId: "",
				field: "landmarks",
				rule: "missing-field",
				message: `${phaseLabel}: missing or invalid landmarks object`,
				retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: "" },
			});
			continue;
		}
		const lm = landmarksRaw as Record<string, unknown>;
		const landmarks: ContentPack["landmarks"] = {
			north: validateLandmark(
				lm.north,
				i + 1,
				"north",
				{ kind: "objective-pair", phaseIndex: i, pairId: "" },
				errors,
			) ?? { shortName: "", horizonPhrase: "" },
			south: validateLandmark(
				lm.south,
				i + 1,
				"south",
				{ kind: "objective-pair", phaseIndex: i, pairId: "" },
				errors,
			) ?? { shortName: "", horizonPhrase: "" },
			east: validateLandmark(
				lm.east,
				i + 1,
				"east",
				{ kind: "objective-pair", phaseIndex: i, pairId: "" },
				errors,
			) ?? { shortName: "", horizonPhrase: "" },
			west: validateLandmark(
				lm.west,
				i + 1,
				"west",
				{ kind: "objective-pair", phaseIndex: i, pairId: "" },
				errors,
			) ?? { shortName: "", horizonPhrase: "" },
		};

		const wallName =
			typeof pack.wallName === "string" && pack.wallName.length > 0
				? pack.wallName
				: "";

		packs.push({
			setting: pack.setting as string,
			objectivePairs,
			interestingObjects,
			obstacles,
			landmarks,
			wallName,
			aiStarts: {} as Record<AiId, never>,
		});
	}

	return errors.length === 0
		? { ok: true, value: { packs } }
		: { ok: false, errors };
}

/**
 * Validate a dual-pack LLM response. Ensures each phase has packA and packB
 * with identical entity IDs and matching structural relationships.
 */
export function validateDualContentPacks(
	raw: unknown,
	input: DualContentPackProviderInput,
): ValidationResult<DualContentPackProviderResult> {
	const errors: ValidationError[] = [];

	if (raw == null || typeof raw !== "object") {
		errors.push({
			entityId: "",
			field: "<root>",
			rule: "structural",
			message: "Dual content pack response is not an object",
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
		return { ok: false, errors };
	}
	const obj = raw as Record<string, unknown>;
	if (!Array.isArray(obj.phases)) {
		errors.push({
			entityId: "",
			field: "phases",
			rule: "missing-field",
			message: "Dual content pack response missing phases array",
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
		return { ok: false, errors };
	}
	if (obj.phases.length !== input.phases.length) {
		errors.push({
			entityId: "",
			field: "phases",
			rule: "wrong-count",
			message: `Expected ${input.phases.length} phases, got ${obj.phases.length}`,
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
		return { ok: false, errors };
	}

	const resultPhases: DualContentPackProviderResult["phases"] = [];

	for (let i = 0; i < obj.phases.length; i++) {
		const phaseRaw = obj.phases[i];
		if (phaseRaw == null || typeof phaseRaw !== "object") {
			errors.push({
				entityId: "",
				field: "phase",
				rule: "structural",
				message: `Phase ${i + 1}: phase entry is not an object`,
				retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: "" },
			});
			continue;
		}
		const phaseObj = phaseRaw as Record<string, unknown>;
		const inputPhase = input.phases[i];
		if (!inputPhase) {
			errors.push({
				entityId: "",
				field: "phase",
				rule: "structural",
				message: `No input phase for phase index ${i}`,
				retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: "" },
			});
			continue;
		}
		const phaseLabel = `Phase ${i + 1}`;

		// Validate each pack independently, collecting IDs to verify parity
		const allIdsA = new Set<string>();
		const allIdsB = new Set<string>();
		const packA = validateSinglePack(
			phaseObj.packA,
			inputPhase,
			allIdsA,
			"packA",
			i,
			errors,
		);
		const packB = validateSinglePack(
			phaseObj.packB,
			inputPhase,
			allIdsB,
			"packB",
			i,
			errors,
		);

		if (packA === null || packB === null) {
			continue;
		}

		// Enforce entity ID parity between packA and packB
		const idsA = [...allIdsA].sort();
		const idsB = [...allIdsB].sort();
		if (JSON.stringify(idsA) !== JSON.stringify(idsB)) {
			const onlyA = idsA.filter((id) => !allIdsB.has(id));
			const onlyB = idsB.filter((id) => !allIdsA.has(id));
			errors.push({
				entityId: "",
				field: "id-parity",
				rule: "structural",
				message:
					`${phaseLabel}: entity IDs mismatch between packA and packB. ` +
					`Only in A: [${onlyA.join(", ")}]. Only in B: [${onlyB.join(", ")}].`,
				retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: "" },
			});
			continue;
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
				errors.push({
					entityId: objId,
					field: "pairsWithSpaceId-parity",
					rule: "structural",
					message: `${phaseLabel}: pairsWithSpaceId mismatch for object "${objId}" between packA and packB`,
					retryUnit: { kind: "objective-pair", phaseIndex: i, pairId: objId },
				});
			}
		}

		resultPhases.push({ packA, packB });
	}

	return errors.length === 0
		? { ok: true, value: { phases: resultPhases } }
		: { ok: false, errors };
}

/** Validate a single pack within a dual-pack response. */
function validateSinglePack(
	raw: unknown,
	inputPhase: DualContentPackProviderInput["phases"][number],
	allIds: Set<string>,
	label: string,
	phaseIndex: number,
	errors: ValidationError[],
): UnplacedPack | null {
	if (raw == null || typeof raw !== "object") {
		errors.push({
			entityId: "",
			field: "pack",
			rule: "structural",
			message: `${label} is not an object`,
			retryUnit: { kind: "objective-pair", phaseIndex, pairId: "" },
		});
		return null;
	}
	const pack = raw as Record<string, unknown>;
	if (typeof pack.setting !== "string" || pack.setting.length === 0) {
		errors.push({
			entityId: "",
			field: "setting",
			rule: "missing-field",
			message: `${label}: missing setting`,
			retryUnit: { kind: "objective-pair", phaseIndex, pairId: "" },
		});
		return null;
	}
	if (
		!Array.isArray(pack.objectivePairs) ||
		pack.objectivePairs.length !== inputPhase.k
	) {
		errors.push({
			entityId: "",
			field: "objectivePairs",
			rule: "wrong-count",
			message: `${label}: expected ${inputPhase.k} objectivePairs, got ${Array.isArray(pack.objectivePairs) ? pack.objectivePairs.length : "non-array"}`,
			retryUnit: { kind: "objective-pair", phaseIndex, pairId: "" },
		});
	}
	if (
		!Array.isArray(pack.interestingObjects) ||
		pack.interestingObjects.length !== inputPhase.n
	) {
		errors.push({
			entityId: "",
			field: "interestingObjects",
			rule: "wrong-count",
			message: `${label}: expected ${inputPhase.n} interestingObjects, got ${Array.isArray(pack.interestingObjects) ? pack.interestingObjects.length : "non-array"}`,
			retryUnit: { kind: "objective-pair", phaseIndex, pairId: "" },
		});
	}
	if (
		!Array.isArray(pack.obstacles) ||
		pack.obstacles.length !== inputPhase.m
	) {
		errors.push({
			entityId: "",
			field: "obstacles",
			rule: "wrong-count",
			message: `${label}: expected ${inputPhase.m} obstacles, got ${Array.isArray(pack.obstacles) ? pack.obstacles.length : "non-array"}`,
			retryUnit: { kind: "objective-pair", phaseIndex, pairId: "" },
		});
	}

	const objectivePairs: ObjectivePair[] = [];
	if (Array.isArray(pack.objectivePairs)) {
		for (const pairRaw of pack.objectivePairs as unknown[]) {
			if (pairRaw == null || typeof pairRaw !== "object") {
				errors.push({
					entityId: "",
					field: "pair",
					rule: "structural",
					message: `${label}: objectivePair entry is not an object`,
					retryUnit: { kind: "objective-pair", phaseIndex, pairId: "" },
				});
				continue;
			}
			const pair = pairRaw as Record<string, unknown>;
			const pairId =
				((pair.object as Record<string, unknown>)?.id as string | undefined) ??
				((pair.space as Record<string, unknown>)?.id as string | undefined) ??
				"";
			const retryUnit = { kind: "objective-pair" as const, phaseIndex, pairId };
			const space = validateEntity(
				pair.space,
				"objective_space",
				allIds,
				false,
				retryUnit,
				errors,
				undefined,
				false,
				true,
			);
			const object = validateEntity(
				pair.object,
				"objective_object",
				allIds,
				true,
				retryUnit,
				errors,
				{},
			);
			if (space === null || object === null) {
				continue;
			}
			if (object.pairsWithSpaceId !== space.id) {
				errors.push({
					entityId: object.id,
					field: "pairsWithSpaceId",
					rule: "structural",
					message: `${label}: object ${object.id} pairsWithSpaceId "${object.pairsWithSpaceId}" does not match space id "${space.id}"`,
					retryUnit,
				});
				continue;
			}
			if (!examineMentionsPairedSpace(object.examineDescription, space.name)) {
				errors.push({
					entityId: object.id,
					field: "examineDescription",
					rule: "paired-space-tell",
					message: `${label}: object ${object.id} examineDescription does not mention paired space "${space.name}" (the AI-discoverable pairing tell). Reference the space's name or a clear noun-phrase synonym.`,
					retryUnit,
				});
			}
			if (!examineMentionsUseTell(space.examineDescription)) {
				console.warn(
					`${label}: space ${space.id} examineDescription has no use/activation cue word (the AI-discoverable prose tell that the space is \`use\`-able as an objective).`,
				);
			}
			objectivePairs.push({ object, space });
		}
	}

	const interestingObjects: WorldEntity[] = [];
	if (Array.isArray(pack.interestingObjects)) {
		for (const itemRaw of pack.interestingObjects as unknown[]) {
			const retryUnit = {
				kind: "interesting-object" as const,
				phaseIndex,
				entityId:
					((itemRaw as Record<string, unknown>)?.id as string | undefined) ??
					"",
			};
			const entity = validateEntity(
				itemRaw,
				"interesting_object",
				allIds,
				true,
				retryUnit,
				errors,
				undefined,
				false,
				false,
				true,
			);
			if (entity !== null) {
				interestingObjects.push(entity);
			}
		}
	}

	const obstacles: WorldEntity[] = [];
	if (Array.isArray(pack.obstacles)) {
		for (const obsRaw of pack.obstacles as unknown[]) {
			const retryUnit = {
				kind: "obstacle" as const,
				phaseIndex,
				entityId:
					((obsRaw as Record<string, unknown>)?.id as string | undefined) ?? "",
			};
			const entity = validateEntity(
				obsRaw,
				"obstacle",
				allIds,
				false,
				retryUnit,
				errors,
				undefined,
				true,
			);
			if (entity !== null) {
				obstacles.push(entity);
			}
		}
	}

	const landmarksRaw = pack.landmarks;
	if (landmarksRaw == null || typeof landmarksRaw !== "object") {
		errors.push({
			entityId: "",
			field: "landmarks",
			rule: "missing-field",
			message: `${label}: missing or invalid landmarks`,
			retryUnit: { kind: "objective-pair", phaseIndex, pairId: "" },
		});
		return null;
	}
	const lm = landmarksRaw as Record<string, unknown>;
	const landmarks: ContentPack["landmarks"] = {
		north: validateLandmark(
			lm.north,
			phaseIndex + 1,
			"north",
			{ kind: "objective-pair", phaseIndex, pairId: "" },
			errors,
		) ?? { shortName: "", horizonPhrase: "" },
		south: validateLandmark(
			lm.south,
			phaseIndex + 1,
			"south",
			{ kind: "objective-pair", phaseIndex, pairId: "" },
			errors,
		) ?? { shortName: "", horizonPhrase: "" },
		east: validateLandmark(
			lm.east,
			phaseIndex + 1,
			"east",
			{ kind: "objective-pair", phaseIndex, pairId: "" },
			errors,
		) ?? { shortName: "", horizonPhrase: "" },
		west: validateLandmark(
			lm.west,
			phaseIndex + 1,
			"west",
			{ kind: "objective-pair", phaseIndex, pairId: "" },
			errors,
		) ?? { shortName: "", horizonPhrase: "" },
	};

	const wallName =
		typeof pack.wallName === "string" && pack.wallName.length > 0
			? pack.wallName
			: "";

	return {
		setting: pack.setting,
		objectivePairs,
		interestingObjects,
		obstacles,
		landmarks,
		wallName,
		aiStarts: {} as Record<AiId, never>,
	};
}

/** Validate a single landmark entry from the LLM response. */
function validateLandmark(
	raw: unknown,
	phaseLabel: number,
	direction: string,
	retryUnit: RetryUnit,
	errors: ValidationError[],
): LandmarkDescription | null {
	if (raw == null || typeof raw !== "object") {
		errors.push({
			entityId: "",
			field: `landmark-${direction}`,
			rule: "structural",
			message: `Phase ${phaseLabel}: landmark "${direction}" is not an object`,
			retryUnit,
		});
		return null;
	}
	const lm = raw as Record<string, unknown>;
	if (typeof lm.shortName !== "string" || lm.shortName.length === 0) {
		errors.push({
			entityId: "",
			field: `landmark-${direction}-shortName`,
			rule: "missing-field",
			message: `Phase ${phaseLabel}: landmark "${direction}" missing shortName`,
			retryUnit,
		});
	}
	if (typeof lm.horizonPhrase !== "string" || lm.horizonPhrase.length === 0) {
		errors.push({
			entityId: "",
			field: `landmark-${direction}-horizonPhrase`,
			rule: "missing-field",
			message: `Phase ${phaseLabel}: landmark "${direction}" missing horizonPhrase`,
			retryUnit,
		});
	}
	if (
		typeof lm.shortName === "string" &&
		typeof lm.horizonPhrase === "string"
	) {
		return { shortName: lm.shortName, horizonPhrase: lm.horizonPhrase };
	}
	return null;
}

export function validateContentPacksOrThrow(
	raw: unknown,
	input: ContentPackProviderInput,
): ContentPackProviderResult {
	const r = validateContentPacks(raw, input);
	if (!r.ok)
		throw new ContentPackError(r.errors[0]?.message ?? "validation failed");
	return r.value;
}

export function validateDualContentPacksOrThrow(
	raw: unknown,
	input: DualContentPackProviderInput,
): DualContentPackProviderResult {
	const r = validateDualContentPacks(raw, input);
	if (!r.ok)
		throw new ContentPackError(r.errors[0]?.message ?? "validation failed");
	return r.value;
}

// ── Helpers for layered retry ────────────────────────────────────────────────

const OUTER_BUDGET = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000];

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function buildOuterMessages(
	systemPrompt: string,
	userPrompt: string,
	corrective: string | null,
): Array<{ role: "system" | "user"; content: string }> {
	const messages: Array<{ role: "system" | "user"; content: string }> = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userPrompt },
	];

	if (corrective !== null) {
		messages.push({
			role: "user",
			content: `Your previous attempt failed validation. Specific issues:\n${corrective}\n\nProduce a fully valid response.`,
		});
	}

	return messages;
}

function buildCorrectiveFeedback(errors: ValidationError[]): string {
	const seen = new Set<string>();
	const lines: string[] = [];

	for (const err of errors) {
		if (!seen.has(err.message)) {
			seen.add(err.message);
			lines.push(err.message);
		}
	}

	return lines.join("\n");
}

// ── BrowserContentPackProvider ────────────────────────────────────────────────

export class BrowserContentPackProvider implements ContentPackProvider {
	private readonly disableReasoning: boolean;
	private readonly chatFn: typeof chatCompletionJson;

	constructor(
		opts: {
			disableReasoning?: boolean;
			chatFn?: typeof chatCompletionJson;
		} = {},
	) {
		this.disableReasoning = opts.disableReasoning ?? false;
		this.chatFn = opts.chatFn ?? chatCompletionJson;
	}

	private async callAndParse(
		messages: Array<{ role: "system" | "user"; content: string }>,
		label: string,
	): Promise<unknown> {
		const { content, reasoning } = await this.chatFn({
			messages,
			disableReasoning: this.disableReasoning,
		});

		const raw = content !== null && content !== "" ? content : reasoning;
		if (raw === null || raw === "") {
			throw new ContentPackError(
				`${label} response has neither content nor reasoning`,
			);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new ContentPackError(`${label} JSON parse failed: ${raw}`);
		}

		return parsed;
	}

	async generateContentPacks(
		input: BindingContentPackInput,
	): Promise<BindingContentPackProviderResult> {
		const phase = input.phases[0]!;
		const schedule = {
			skeletons: phase.bindings,
			decoys: [{ id: "decoy-0" }, { id: "decoy-1" }],
			obstacleCount: phase.obstacleCount,
		};
		const baseUserPrompt = buildBindingPrompt(
			phase.bindings.map((b) => b.type),
			phase.setting,
			phase.theme,
			phase.weather,
			phase.timeOfDay,
			phase.obstacleCount,
		).userMessage;

		const systemPrompt = CONTENT_PACK_SYSTEM_PROMPT;
		let correctiveFeedback: string | null = null;

		for (let outer = 0; outer < OUTER_BUDGET; outer++) {
			let rawJson: unknown;

			try {
				const messages = buildOuterMessages(
					systemPrompt,
					baseUserPrompt,
					correctiveFeedback,
				);
				rawJson = await this.callAndParse(messages, "content-pack");
				const validationResult = validateBoundContentPack(rawJson, schedule);
				if (validationResult.ok) {
					return { phases: [{ rawPack: (rawJson as Record<string, unknown>).pack as RawBoundPack }] };
				}
				correctiveFeedback = buildCorrectiveFeedback(validationResult.errors);
			} catch (err) {
				if (err instanceof CapHitError) throw err;
				if (outer === OUTER_BUDGET - 1) throw err;
				const backoffMs = BACKOFF_MS[outer];
				if (backoffMs !== undefined) {
					await sleep(backoffMs);
				}
				correctiveFeedback = null;
			}
		}

		throw new ContentPackError(
			"content-pack generation exhausted retry budget",
		);
	}

	async generateDualContentPacks(
		input: DualBindingContentPackInput,
	): Promise<DualBindingContentPackProviderResult> {
		const phase = input.phases[0]!;
		const schedule = {
			skeletons: phase.bindings,
			decoys: [{ id: "decoy-0" }, { id: "decoy-1" }],
			obstacleCount: phase.obstacleCount,
		};
		const baseUserPrompt = buildDualBindingPrompt(
			phase.bindings.map((b) => b.type),
			phase.settingA,
			phase.settingB,
			phase.theme,
			phase.weatherA,
			phase.weatherB,
			phase.timeOfDayA,
			phase.timeOfDayB,
			phase.obstacleCount,
		).userMessage;

		const systemPrompt = DUAL_CONTENT_PACK_SYSTEM_PROMPT;
		let correctiveFeedback: string | null = null;

		for (let outer = 0; outer < OUTER_BUDGET; outer++) {
			let rawJson: unknown;

			try {
				const messages = buildOuterMessages(
					systemPrompt,
					baseUserPrompt,
					correctiveFeedback,
				);
				rawJson = await this.callAndParse(messages, "dual content-pack");
				const validationResult = validateBoundDualContentPack(rawJson, schedule);
				if (validationResult.ok) {
					const phases = (rawJson as Record<string, unknown>).phases as Array<Record<string, unknown>>;
					const phase0 = phases[0]!;
					return {
						phases: [{
							rawPackA: phase0.packA as RawBoundPack,
							rawPackB: phase0.packB as RawBoundPack,
						}],
					};
				}
				correctiveFeedback = buildCorrectiveFeedback(validationResult.errors);
			} catch (err) {
				if (err instanceof CapHitError) throw err;
				if (outer === OUTER_BUDGET - 1) throw err;
				const backoffMs = BACKOFF_MS[outer];
				if (backoffMs !== undefined) {
					await sleep(backoffMs);
				}
				correctiveFeedback = null;
			}
		}

		throw new ContentPackError(
			"dual content-pack generation exhausted retry budget",
		);
	}
}

// ── MockContentPackProvider ───────────────────────────────────────────────────

export class MockContentPackProvider implements ContentPackProvider {
	readonly calls: BindingContentPackInput[] = [];
	readonly dualCalls: DualBindingContentPackInput[] = [];
	private readonly fn: (input: BindingContentPackInput) => BindingContentPackProviderResult;
	private readonly dualFn: (input: DualBindingContentPackInput) => DualBindingContentPackProviderResult;

	constructor(
		fn: (input: BindingContentPackInput) => BindingContentPackProviderResult,
		dualFn?: (input: DualBindingContentPackInput) => DualBindingContentPackProviderResult,
	) {
		this.fn = fn;
		this.dualFn = dualFn ?? (() => ({ phases: [] }));
	}

	async generateContentPacks(
		input: BindingContentPackInput,
	): Promise<BindingContentPackProviderResult> {
		this.calls.push(input);
		return this.fn(input);
	}

	async generateDualContentPacks(
		input: DualBindingContentPackInput,
	): Promise<DualBindingContentPackProviderResult> {
		this.dualCalls.push(input);
		return this.dualFn(input);
	}
}
