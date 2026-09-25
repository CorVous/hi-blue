import { CapHitError, chatCompletionJson } from "../llm-client.js";
import type { RawBoundPack } from "./binding-aware-validator.js";
import {
	validateBoundContentPack,
	validateBoundDualContentPack,
} from "./binding-aware-validator.js";
import type { BindingSkeleton } from "./binding-prompt-builder.js";
import {
	buildBindingPrompt,
	buildDualBindingPrompt,
} from "./binding-prompt-builder.js";
import { recordContentPackAttempt } from "./content-pack-attempts.js";

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

export interface BindingContentPackProviderResult {
	phases: Array<{ rawPack: RawBoundPack }>;
}

export interface DualBindingContentPackProviderResult {
	phases: Array<{ rawPackA: RawBoundPack; rawPackB: RawBoundPack }>;
}

class ContentPackError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ContentPackError";
	}
}

export interface ContentPackProvider {
	generateContentPacks(
		input: BindingContentPackInput,
	): Promise<BindingContentPackProviderResult>;
	generateDualContentPacks(
		input: DualBindingContentPackInput,
	): Promise<DualBindingContentPackProviderResult>;
}

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
      "packA": { "setting": "<settingA>", "wallName": "...", "bindings": [...], "decoys": [...], "obstacles": [...] },
      "packB": { "setting": "<settingB>", "wallName": "...", "bindings": [SAME STRUCTURE/IDs as packA, DIFFERENT flavors], "decoys": [SAME IDs, DIFFERENT names/flavors], "obstacles": [SAME IDs, DIFFERENT names/flavors] }
    }
  ]
}`;

const MIN_SPACE_NAME_TOKEN_LENGTH = 4;

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
		.filter(
			(t) => t.length >= MIN_SPACE_NAME_TOKEN_LENGTH && !STOPWORDS.has(t),
		);
	return tokens.some((t) => examineLc.includes(t));
}

const USE_SPACE_TELL_KEYWORDS: readonly string[] = [
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
];

const USE_ITEM_EXTRA_TELL_KEYWORDS: readonly string[] = [
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

const USE_TELL_KEYWORDS: readonly string[] = [
	...USE_SPACE_TELL_KEYWORDS,
	...USE_ITEM_EXTRA_TELL_KEYWORDS,
];

export function examineMentionsUseTell(examineDescription: string): boolean {
	const tokens = examineDescription.toLowerCase().match(/[a-z]+/g) ?? [];
	if (tokens.length === 0) return false;
	const tokenSet = new Set(tokens);
	for (const kw of USE_TELL_KEYWORDS) {
		if (tokenSet.has(kw)) return true;
	}
	return false;
}

export function findMatchedUseTellKeywords(
	examineDescription: string,
): string[] {
	const tokens = examineDescription.toLowerCase().match(/[a-z]+/g) ?? [];
	if (tokens.length === 0) return [];
	const tokenSet = new Set(tokens);
	const matched: string[] = [];
	for (const kw of USE_TELL_KEYWORDS) {
		if (tokenSet.has(kw)) matched.push(kw);
	}
	return matched;
}

export const USE_CUE_KEYWORD_HINTS: readonly string[] = [
	"use",
	"activate",
	"press",
	"pull",
	"turn",
	"trigger",
	"engage",
	"operate",
	"lever",
	"button",
	"switch",
	"control",
	"panel",
	"console",
	"dial",
	"knob",
	"interact",
	"mechanism",
];

type RetryUnit =
	| { kind: "objective-pair"; phaseIndex: number; pairId: string }
	| { kind: "interesting-object"; phaseIndex: number; entityId: string }
	| { kind: "obstacle"; phaseIndex: number; entityId: string }
	| { kind: "carry-binding"; phaseIndex: number; bindingId: string }
	| { kind: "use-space-binding"; phaseIndex: number; bindingId: string }
	| { kind: "use-item-binding"; phaseIndex: number; bindingId: string }
	| { kind: "convergence-binding"; phaseIndex: number; bindingId: string }
	| { kind: "decoy"; phaseIndex: number; decoyId: string };

type ValidationRule =
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

const OUTER_ATTEMPT_BUDGET = 3;
const BACKOFF_MS_BEFORE_RETRY = [1_000, 2_000, 4_000];

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

export type OuterChatMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| { role: "assistant"; content: string };

export function buildOuterMessages(
	systemPrompt: string,
	userPrompt: string,
	prevAssistant: string | null,
	corrective: string | null,
): OuterChatMessage[] {
	const messages: OuterChatMessage[] = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userPrompt },
	];

	if (prevAssistant !== null) {
		messages.push({ role: "assistant", content: prevAssistant });
	}

	if (corrective !== null) {
		messages.push({
			role: "user",
			content: `Your previous attempt failed validation. Specific issues:\n${corrective}\n\nProduce a fully valid response that addresses every issue above. Repair the previous JSON in-place where possible — keep entity IDs, structure, and any fields that already passed.`,
		});
	}

	return messages;
}

function retryUnitLabel(unit: ValidationError["retryUnit"]): string {
	switch (unit.kind) {
		case "objective-pair":
			return `objective pair ${unit.pairId}`;
		case "interesting-object":
			return `interesting object ${unit.entityId}`;
		case "obstacle":
			return `obstacle ${unit.entityId}`;
		case "carry-binding":
			return `carry binding ${unit.bindingId}`;
		case "use-space-binding":
			return `use-space binding ${unit.bindingId}`;
		case "use-item-binding":
			return `use-item binding ${unit.bindingId}`;
		case "convergence-binding":
			return `convergence binding ${unit.bindingId}`;
		case "decoy":
			return `decoy ${unit.decoyId}`;
	}
}

export function buildCorrectiveFeedback(errors: ValidationError[]): string {
	const groups = new Map<string, { label: string; messages: string[] }>();
	const order: string[] = [];

	for (const err of errors) {
		const key = JSON.stringify(err.retryUnit);
		let group = groups.get(key);
		if (!group) {
			group = { label: retryUnitLabel(err.retryUnit), messages: [] };
			groups.set(key, group);
			order.push(key);
		}
		if (!group.messages.includes(err.message)) {
			group.messages.push(err.message);
		}
	}

	const sections: string[] = [];
	for (const key of order) {
		const group = groups.get(key);
		if (!group) continue;
		const bullets = group.messages.map((m) => `  - ${m}`).join("\n");
		sections.push(`For ${group.label}:\n${bullets}`);
	}

	return sections.join("\n");
}

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
		messages: OuterChatMessage[],
		label: string,
	): Promise<{ parsed: unknown; raw: string }> {
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

		return { parsed, raw };
	}

	async generateContentPacks(
		input: BindingContentPackInput,
	): Promise<BindingContentPackProviderResult> {
		const phase = input.phases[0];
		if (!phase) {
			throw new ContentPackError("generateContentPacks: input.phases is empty");
		}
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
		let prevAssistantRaw: string | null = null;

		for (let attempt = 0; attempt < OUTER_ATTEMPT_BUDGET; attempt++) {
			try {
				const messages = buildOuterMessages(
					systemPrompt,
					baseUserPrompt,
					prevAssistantRaw,
					correctiveFeedback,
				);
				const { parsed: rawJson, raw } = await this.callAndParse(
					messages,
					"content-pack",
				);
				const validationResult = validateBoundContentPack(rawJson, schedule);
				if (validationResult.ok) {
					recordContentPackAttempt({
						op: "single",
						attempt,
						outcome: "ok",
						rawLength: raw.length,
					});
					return {
						phases: [
							{
								rawPack: (rawJson as Record<string, unknown>)
									.pack as RawBoundPack,
							},
						],
					};
				}
				recordContentPackAttempt({
					op: "single",
					attempt,
					outcome: "validation-failed",
					validationErrors: validationResult.errors,
					rawLength: raw.length,
				});
				correctiveFeedback = buildCorrectiveFeedback(validationResult.errors);
				prevAssistantRaw = raw;
			} catch (err) {
				if (err instanceof CapHitError) throw err;
				recordContentPackAttempt({
					op: "single",
					attempt,
					outcome: "hard-error",
					errorMessage: err instanceof Error ? err.message : String(err),
				});
				if (attempt === OUTER_ATTEMPT_BUDGET - 1) throw err;
				const backoffMs = BACKOFF_MS_BEFORE_RETRY[attempt];
				if (backoffMs !== undefined) {
					await sleep(backoffMs);
				}
				correctiveFeedback = null;
				prevAssistantRaw = null;
			}
		}

		throw new ContentPackError(
			"content-pack generation exhausted retry budget",
		);
	}

	async generateDualContentPacks(
		input: DualBindingContentPackInput,
	): Promise<DualBindingContentPackProviderResult> {
		const phase = input.phases[0];
		if (!phase) {
			throw new ContentPackError(
				"generateDualContentPacks: input.phases is empty",
			);
		}
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
		let prevAssistantRaw: string | null = null;

		for (let attempt = 0; attempt < OUTER_ATTEMPT_BUDGET; attempt++) {
			try {
				const messages = buildOuterMessages(
					systemPrompt,
					baseUserPrompt,
					prevAssistantRaw,
					correctiveFeedback,
				);
				const { parsed: rawJson, raw } = await this.callAndParse(
					messages,
					"dual content-pack",
				);
				const validationResult = validateBoundDualContentPack(
					rawJson,
					schedule,
				);
				if (validationResult.ok) {
					const phases = (rawJson as Record<string, unknown>).phases as Array<
						Record<string, unknown>
					>;
					const phase0 = phases[0];
					if (!phase0) {
						throw new ContentPackError(
							"dual content-pack: validated response has no phases",
						);
					}
					recordContentPackAttempt({
						op: "dual",
						attempt,
						outcome: "ok",
						rawLength: raw.length,
					});
					return {
						phases: [
							{
								rawPackA: phase0.packA as RawBoundPack,
								rawPackB: phase0.packB as RawBoundPack,
							},
						],
					};
				}
				recordContentPackAttempt({
					op: "dual",
					attempt,
					outcome: "validation-failed",
					validationErrors: validationResult.errors,
					rawLength: raw.length,
				});
				correctiveFeedback = buildCorrectiveFeedback(validationResult.errors);
				prevAssistantRaw = raw;
			} catch (err) {
				if (err instanceof CapHitError) throw err;
				recordContentPackAttempt({
					op: "dual",
					attempt,
					outcome: "hard-error",
					errorMessage: err instanceof Error ? err.message : String(err),
				});
				if (attempt === OUTER_ATTEMPT_BUDGET - 1) throw err;
				const backoffMs = BACKOFF_MS_BEFORE_RETRY[attempt];
				if (backoffMs !== undefined) {
					await sleep(backoffMs);
				}
				correctiveFeedback = null;
				prevAssistantRaw = null;
			}
		}

		throw new ContentPackError(
			"dual content-pack generation exhausted retry budget",
		);
	}
}

export class MockContentPackProvider implements ContentPackProvider {
	readonly calls: BindingContentPackInput[] = [];
	readonly dualCalls: DualBindingContentPackInput[] = [];
	private readonly fn: (
		input: BindingContentPackInput,
	) => BindingContentPackProviderResult;
	private readonly dualFn: (
		input: DualBindingContentPackInput,
	) => DualBindingContentPackProviderResult;

	constructor(
		fn: (input: BindingContentPackInput) => BindingContentPackProviderResult,
		dualFn?: (
			input: DualBindingContentPackInput,
		) => DualBindingContentPackProviderResult,
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
