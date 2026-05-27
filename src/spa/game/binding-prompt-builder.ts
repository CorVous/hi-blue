/**
 * binding-prompt-builder.ts
 *
 * Builds the user-message payload for type-first (binding-aware) content-pack
 * generation. Given a list of ObjectiveTypes and setting context, it mints
 * deterministic entity-ID skeletons and builds a user message listing each
 * entity the LLM must author.
 */

import type { ObjectiveType } from "./types.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface BindingSkeleton {
	type: ObjectiveType;
	objectId?: string; // carry only
	spaceId?: string; // carry, use_space, convergence
	itemId?: string; // use_item
}

interface DecoySkeleton {
	id: string; // "decoy-0", "decoy-1"
}

export interface BindingPromptResult {
	skeletons: BindingSkeleton[];
	decoys: DecoySkeleton[];
	userMessage: string;
}

// ── ID-minting helpers ────────────────────────────────────────────────────────

function mintSkeleton(type: ObjectiveType, i: number): BindingSkeleton {
	switch (type) {
		case "carry":
			return {
				type,
				objectId: `carry-${i}-obj`,
				spaceId: `carry-${i}-space`,
			};
		case "use_space":
			return {
				type,
				spaceId: `useSpace-${i}-space`,
			};
		case "use_item":
			return {
				type,
				itemId: `useItem-${i}-item`,
			};
		case "convergence":
			return {
				type,
				spaceId: `convergence-${i}-space`,
			};
	}
}

function mintDecoys(): DecoySkeleton[] {
	return [{ id: "decoy-0" }, { id: "decoy-1" }];
}

function obstacleIds(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `obstacle-${i}`);
}

// ── Binding description helpers ───────────────────────────────────────────────

function describeSkeletonInUserMessage(sk: BindingSkeleton, i: number): string {
	switch (sk.type) {
		case "carry":
			return [
				`Binding ${i} (carry): use this exact JSON shape (as element ${i} of "bindings"):`,
				`{`,
				`  "type": "carry",`,
				`  "object": {`,
				`    "id": "${sk.objectId}",`,
				`    "name": "<2-4 words>",`,
				`    "examineDescription": "<1-2 sentences; MUST reference the paired space '${sk.spaceId}' by name>",`,
				`    "useOutcome": "<1 stateless sentence>",`,
				`    "placementFlavor": "<1 sentence; MUST contain literal {actor}>",`,
				`    "proximityFlavor": "<1 sentence; daemon POV; no {actor}>"`,
				`  },`,
				`  "space": {`,
				`    "id": "${sk.spaceId}",`,
				`    "name": "<2-4 words>",`,
				`    "examineDescription": "<1-2 sentences; MUST NOT contain any use-cue keyword>",`,
				`    "proximityFlavor": "<1 sentence; daemon POV; no {actor}>"`,
				`  }`,
				`}`,
			].join("\n");
		case "use_space":
			return [
				`Binding ${i} (use_space): use this exact JSON shape (as element ${i} of "bindings"):`,
				`{`,
				`  "type": "use_space",`,
				`  "space": {`,
				`    "id": "${sk.spaceId}",`,
				`    "name": "<2-4 words>",`,
				`    "examineDescription": "<1-2 sentences; MUST contain a use-cue keyword>",`,
				`    "proximityFlavor": "<1 sentence; daemon POV; no {actor}>",`,
				`    "activationFlavor": "<1 sentence; world third-person; no {actor}>",`,
				`    "satisfactionFlavor": "<1 sentence; witness POV; no {actor}>",`,
				`    "postExamineDescription": "<1-2 sentences>",`,
				`    "postLookFlavor": "<1 sentence>"`,
				`  }`,
				`}`,
			].join("\n");
		case "use_item":
			return [
				`Binding ${i} (use_item): use this exact JSON shape (as element ${i} of "bindings"):`,
				`{`,
				`  "type": "use_item",`,
				`  "item": {`,
				`    "id": "${sk.itemId}",`,
				`    "name": "<2-4 words>",`,
				`    "examineDescription": "<1-2 sentences; MUST contain a use-cue keyword>",`,
				`    "proximityFlavor": "<1 sentence; daemon POV; no {actor}>",`,
				`    "useOutcome": "<1 stateless sentence>",`,
				`    "activationFlavor": "<1 sentence; world third-person; no {actor}>",`,
				`    "postExamineDescription": "<1-2 sentences; no {actor}>",`,
				`    "postLookFlavor": "<1 sentence; no {actor}>"`,
				`  }`,
				`}`,
			].join("\n");
		case "convergence":
			return [
				`Binding ${i} (convergence): use this exact JSON shape (as element ${i} of "bindings"):`,
				`{`,
				`  "type": "convergence",`,
				`  "space": {`,
				`    "id": "${sk.spaceId}",`,
				`    "name": "<2-4 words>",`,
				`    "examineDescription": "<1-2 sentences; hint at shared-occupancy significance; MUST NOT contain use-cue keyword>",`,
				`    "proximityFlavor": "<1 sentence; daemon POV; no {actor}>",`,
				`    "convergenceTier1Flavor": "<1 sentence; witness POV; no {actor}>",`,
				`    "convergenceTier2Flavor": "<1 sentence; witness POV; no {actor}>",`,
				`    "convergenceTier1ActorFlavor": "<1 sentence; first-person; no {actor}>",`,
				`    "convergenceTier2ActorFlavor": "<1 sentence; first-person; no {actor}>"`,
				`  }`,
				`}`,
			].join("\n");
	}
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the user message and entity skeletons for a single-setting content pack.
 */
export function buildBindingPrompt(
	types: ObjectiveType[],
	setting: string,
	theme: string,
	weather: string,
	timeOfDay: string,
	obstacleCount: number,
): BindingPromptResult {
	const skeletons = types.map((t, i) => mintSkeleton(t, i));
	const decoys = mintDecoys();

	const lines: string[] = [
		`Generate a content pack for:`,
		`  setting="${setting}", theme="${theme}", weather="${weather}", timeOfDay="${timeOfDay}"`,
		``,
		`Entity bindings to author (use EXACTLY these IDs):`,
	];

	for (let i = 0; i < skeletons.length; i++) {
		// biome-ignore lint/style/noNonNullAssertion: bounded index
		lines.push(describeSkeletonInUserMessage(skeletons[i]!, i));
	}

	lines.push(``);
	lines.push(`Decoys (always exactly 2):`);
	for (const d of decoys) {
		lines.push(
			`  decoy id="${d.id}": name, examineDescription (MUST NOT contain use-cue), proximityFlavor, useOutcome`,
		);
	}

	if (obstacleCount > 0) {
		lines.push(``);
		lines.push(`Obstacles (${obstacleCount}):`);
		for (const id of obstacleIds(obstacleCount)) {
			lines.push(
				`  obstacle id="${id}": name, examineDescription, shiftFlavor (no {actor})`,
			);
		}
	}

	lines.push(``);
	lines.push(
		`Also generate: landmarks (north/south/east/west with shortName+horizonPhrase), wallName.`,
	);

	return {
		skeletons,
		decoys,
		userMessage: lines.join("\n"),
	};
}

/**
 * Build the user message and entity skeletons for a dual-setting (A/B) content pack.
 * Bindings are shared; only setting/weather/timeOfDay differ between A and B.
 */
export function buildDualBindingPrompt(
	types: ObjectiveType[],
	settingA: string,
	settingB: string,
	theme: string,
	weatherA: string,
	weatherB: string,
	timeOfDayA: string,
	timeOfDayB: string,
	obstacleCount: number,
): BindingPromptResult {
	const skeletons = types.map((t, i) => mintSkeleton(t, i));
	const decoys = mintDecoys();

	const lines: string[] = [
		`Generate a dual A/B content pack for:`,
		`  settingA="${settingA}", weatherA="${weatherA}", timeOfDayA="${timeOfDayA}"`,
		`  settingB="${settingB}", weatherB="${weatherB}", timeOfDayB="${timeOfDayB}"`,
		`  theme="${theme}"`,
		``,
		`Entity bindings to author (use EXACTLY these IDs, same across A and B; only flavor/names differ):`,
	];

	for (let i = 0; i < skeletons.length; i++) {
		// biome-ignore lint/style/noNonNullAssertion: bounded index
		lines.push(describeSkeletonInUserMessage(skeletons[i]!, i));
	}

	lines.push(``);
	lines.push(`Decoys (always exactly 2):`);
	for (const d of decoys) {
		lines.push(
			`  decoy id="${d.id}": name, examineDescription (MUST NOT contain use-cue), proximityFlavor, useOutcome`,
		);
	}

	if (obstacleCount > 0) {
		lines.push(``);
		lines.push(`Obstacles (${obstacleCount}):`);
		for (const id of obstacleIds(obstacleCount)) {
			lines.push(
				`  obstacle id="${id}": name, examineDescription, shiftFlavor (no {actor})`,
			);
		}
	}

	lines.push(``);
	lines.push(
		`Also generate per-setting: landmarks (north/south/east/west with shortName+horizonPhrase), wallName.`,
	);
	lines.push(
		`settingA and settingB must reference the same entity IDs but use different names/flavors.`,
	);

	return {
		skeletons,
		decoys,
		userMessage: lines.join("\n"),
	};
}
