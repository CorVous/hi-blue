import { chatCompletionJson, isRetryPointless } from "../llm-client.js";
import type { RawBoundPack } from "./binding-aware-validator.js";
import { validateBoundDualContentPack } from "./binding-aware-validator.js";
import type { BindingSkeleton } from "./binding-prompt-builder.js";
import { buildDualBindingPrompt } from "./binding-prompt-builder.js";
import { recordContentPackAttempt } from "./content-pack-attempts.js";
import type { ValidationError } from "./content-pack-validation.js";
import {
	parseJsonCompletion,
	retryDelayMs,
	sleepUnlessAborted,
} from "./json-completion.js";

export type { ValidationError } from "./content-pack-validation.js";

const DECOY_FORBIDDEN_WORDS =
	'"use", "activate", "press", "trigger", "engage", "operate", "interact", "channel", "invoke", "summon", "ignite", "pull", "turn", "twist", "flip", "wind", "crank", "lever", "button", "switch", "control", "panel", "console", "dial", "knob", "handle", "mechanism"';

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
  fields: name (2-4 words), examineDescription (1-2 sentences; MUST NOT contain any of these words in any form (plural, -ed, -ing), even in an innocent sense such as a cup handle or the wind: ${DECOY_FORBIDDEN_WORDS}), proximityFlavor (1 sentence, daemon's POV; no "{actor}"), useOutcome (1 sentence). FORBIDDEN: activationFlavor, postExamineDescription, postLookFlavor. Must be a portable physical item.

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

const OUTER_ATTEMPT_BUDGET = 3;
const BACKOFF_MS_BEFORE_RETRY = [1_000, 2_000, 4_000];

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
	const unitLabel = retryUnitKindLabel(unit);
	return unit.pack === undefined ? unitLabel : `pack${unit.pack} ${unitLabel}`;
}

function retryUnitKindLabel(unit: ValidationError["retryUnit"]): string {
	switch (unit.kind) {
		case "objective-pair":
			return `objective pair ${unit.pairId}`;
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

interface RawDualPhase {
	packA: RawBoundPack;
	packB: RawBoundPack;
}

export function buildCorrectiveFeedback(errors: ValidationError[]): string {
	const groups = new Map<string, { label: string; messages: Set<string> }>();
	for (const err of errors) {
		const key = JSON.stringify(err.retryUnit);
		const group = groups.get(key) ?? {
			label: retryUnitLabel(err.retryUnit),
			messages: new Set<string>(),
		};
		group.messages.add(err.message);
		groups.set(key, group);
	}
	return [...groups.values()]
		.map(({ label, messages }) => {
			const bullets = [...messages].map((m) => `  - ${m}`).join("\n");
			return `For ${label}:\n${bullets}`;
		})
		.join("\n");
}

export class BrowserContentPackProvider implements ContentPackProvider {
	private readonly disableReasoning: boolean;
	private readonly chatFn: typeof chatCompletionJson;
	private readonly signal: AbortSignal | undefined;

	constructor(
		opts: {
			disableReasoning?: boolean;
			chatFn?: typeof chatCompletionJson;
			signal?: AbortSignal;
		} = {},
	) {
		this.disableReasoning = opts.disableReasoning ?? false;
		this.chatFn = opts.chatFn ?? chatCompletionJson;
		this.signal = opts.signal;
	}

	private async callAndParse(
		messages: OuterChatMessage[],
		label: string,
	): Promise<{ parsed: unknown; raw: string }> {
		const result = await this.chatFn({
			messages,
			disableReasoning: this.disableReasoning,
			...(this.signal !== undefined ? { signal: this.signal } : {}),
		});
		return parseJsonCompletion(
			result,
			label,
			(message) => new ContentPackError(message),
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
					const [phase0] = (rawJson as { phases: [RawDualPhase] }).phases;
					recordContentPackAttempt({
						op: "dual",
						attempt,
						outcome: "ok",
						rawLength: raw.length,
					});
					return {
						phases: [
							{
								rawPackA: phase0.packA,
								rawPackB: phase0.packB,
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
				if (isRetryPointless(err) || this.signal?.aborted) throw err;
				recordContentPackAttempt({
					op: "dual",
					attempt,
					outcome: "hard-error",
					errorMessage: err instanceof Error ? err.message : String(err),
				});
				if (attempt === OUTER_ATTEMPT_BUDGET - 1) throw err;
				const backoffMs = BACKOFF_MS_BEFORE_RETRY[attempt];
				if (backoffMs !== undefined) {
					await sleepUnlessAborted(retryDelayMs(err, backoffMs), this.signal);
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
	readonly calls: DualBindingContentPackInput[] = [];
	private readonly fn: (
		input: DualBindingContentPackInput,
	) => DualBindingContentPackProviderResult;

	constructor(
		fn: (
			input: DualBindingContentPackInput,
		) => DualBindingContentPackProviderResult,
	) {
		this.fn = fn;
	}

	async generateDualContentPacks(
		input: DualBindingContentPackInput,
	): Promise<DualBindingContentPackProviderResult> {
		this.calls.push(input);
		return this.fn(input);
	}
}
