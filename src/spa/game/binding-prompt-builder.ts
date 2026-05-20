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
			return (
				`Binding ${i} (carry):\n` +
				`  object id="${sk.objectId}": name, examineDescription (MUST reference paired space "${sk.spaceId}"), useOutcome, placementFlavor (MUST contain {actor}), proximityFlavor\n` +
				`  space  id="${sk.spaceId}": name, examineDescription (MUST NOT contain use-cue; MUST NOT have activationFlavor/satisfactionFlavor/convergence tier fields), proximityFlavor`
			);
		case "use_space":
			return (
				`Binding ${i} (use_space):\n` +
				`  space  id="${sk.spaceId}": name, examineDescription (MUST contain use-cue keyword), proximityFlavor, activationFlavor (no {actor}), satisfactionFlavor (no {actor}), postExamineDescription, postLookFlavor`
			);
		case "use_item":
			return (
				`Binding ${i} (use_item):\n` +
				`  item   id="${sk.itemId}": name, examineDescription (MUST contain use-cue keyword), proximityFlavor, useOutcome, activationFlavor (no {actor}), postExamineDescription (no {actor}), postLookFlavor (no {actor})`
			);
		case "convergence":
			return (
				`Binding ${i} (convergence):\n` +
				`  space  id="${sk.spaceId}": name, examineDescription, proximityFlavor, convergenceTier1Flavor, convergenceTier2Flavor, convergenceTier1ActorFlavor, convergenceTier2ActorFlavor (all no {actor}; NO activationFlavor/satisfactionFlavor/postExamineDescription/postLookFlavor)`
			);
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
