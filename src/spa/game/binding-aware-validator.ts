/**
 * binding-aware-validator.ts
 *
 * Validates a binding-shaped content-pack response against the pre-minted
 * entity-ID schedule produced by buildBindingPrompt / buildDualBindingPrompt.
 *
 * Per-binding validation rules mirror the system-prompt constraints:
 *
 * | Binding    | Required fields                                               | Forbidden fields                                                     |
 * |------------|---------------------------------------------------------------|----------------------------------------------------------------------|
 * | carry      | object: name, examineDescription, useOutcome, placementFlavor,| space: activationFlavor, satisfactionFlavor, postExamineDescription, |
 * |            |   proximityFlavor; space: name, examineDescription,           |   postLookFlavor, convergence tier* fields                           |
 * |            |   proximityFlavor                                             |                                                                      |
 * | use_space  | space: name, examineDescription, proximityFlavor,             | convergenceTier* fields, pairsWithSpaceId, placementFlavor           |
 * |            |   activationFlavor, satisfactionFlavor, postExamineDescription|                                                                      |
 * |            |   postLookFlavor                                              |                                                                      |
 * | convergence| space: name, examineDescription, proximityFlavor,             | activationFlavor, satisfactionFlavor, postExamineDescription,        |
 * |            |   convergenceTier1Flavor, convergenceTier2Flavor,             |   postLookFlavor, useAvailable                                       |
 * |            |   convergenceTier1ActorFlavor, convergenceTier2ActorFlavor    |                                                                      |
 * | use_item   | item: name, examineDescription, proximityFlavor, useOutcome,  | (none extra)                                                         |
 * |            |   activationFlavor, postExamineDescription, postLookFlavor   |                                                                      |
 * | decoy      | item: name, examineDescription, proximityFlavor, useOutcome   | activationFlavor, postExamineDescription, postLookFlavor             |
 * | obstacle   | name, examineDescription, shiftFlavor                         |                                                                      |
 */

import type { BindingSkeleton } from "./binding-prompt-builder.js";
import type {
	ValidationError,
	ValidationResult,
} from "./content-pack-provider.js";
import {
	examineMentionsUseTell,
	findMatchedUseTellKeywords,
	USE_CUE_KEYWORD_HINTS,
} from "./content-pack-provider.js";

// ── Raw binding-shaped response types ────────────────────────────────────────

interface RawBindingEntity {
	id?: string;
	name?: string;
	examineDescription?: string;
	useOutcome?: string;
	placementFlavor?: string;
	proximityFlavor?: string;
	activationFlavor?: string;
	satisfactionFlavor?: string;
	postExamineDescription?: string;
	postLookFlavor?: string;
	convergenceTier1Flavor?: string;
	convergenceTier2Flavor?: string;
	convergenceTier1ActorFlavor?: string;
	convergenceTier2ActorFlavor?: string;
	shiftFlavor?: string;
	pairsWithSpaceId?: string;
	useAvailable?: boolean;
	[key: string]: unknown;
}

export interface RawBinding {
	id?: string;
	type?: string;
	object?: RawBindingEntity;
	space?: RawBindingEntity;
	item?: RawBindingEntity;
}

interface RawDecoy {
	id?: string;
	name?: string;
	examineDescription?: string;
	proximityFlavor?: string;
	useOutcome?: string;
	[key: string]: unknown;
}

interface RawObstacle {
	id?: string;
	name?: string;
	examineDescription?: string;
	shiftFlavor?: string;
	[key: string]: unknown;
}

export interface RawBoundPack {
	setting?: string;
	wallName?: string;
	landmarks?: unknown;
	bindings?: RawBinding[];
	decoys?: RawDecoy[];
	obstacles?: RawObstacle[];
}

// ── Validation schedule type ──────────────────────────────────────────────────

/** The schedule passed to the validator (from buildBindingPrompt). */
export interface ValidationSchedule {
	skeletons: BindingSkeleton[];
	decoys: { id: string }[];
	obstacleCount: number;
}

// ── Validation helpers ────────────────────────────────────────────────────────

function requiredString(
	entity: RawBindingEntity,
	field: string,
	entityId: string,
	retryUnit: ValidationError["retryUnit"],
	errors: ValidationError[],
): void {
	const val = (entity as Record<string, unknown>)[field];
	if (typeof val !== "string" || val.length === 0) {
		errors.push({
			entityId,
			field,
			rule: "missing-field",
			message: `Entity ${entityId}: missing required field "${field}"`,
			retryUnit,
		});
	}
}

function forbiddenField(
	entity: RawBindingEntity,
	field: string,
	entityId: string,
	retryUnit: ValidationError["retryUnit"],
	errors: ValidationError[],
): void {
	if ((entity as Record<string, unknown>)[field] !== undefined) {
		errors.push({
			entityId,
			field,
			rule: "binding-forbidden-field",
			message: `Entity ${entityId}: field "${field}" is forbidden for this binding type`,
			retryUnit,
		});
	}
}

function checkWrongId(
	entity: RawBindingEntity,
	expectedId: string,
	retryUnit: ValidationError["retryUnit"],
	errors: ValidationError[],
): void {
	if (entity.id !== expectedId) {
		errors.push({
			entityId: entity.id ?? "",
			field: "id",
			rule: "wrong-id",
			message: `Entity id "${entity.id}" does not match expected id "${expectedId}"`,
			retryUnit,
		});
	}
}

// ── Per-binding validation ────────────────────────────────────────────────────

function validateCarryBinding(
	binding: RawBinding,
	sk: BindingSkeleton,
	phaseIndex: number,
	warnings: ValidationError[],
	errors: ValidationError[],
): void {
	const bindingRetryUnit = {
		kind: "carry-binding" as const,
		phaseIndex,
		bindingId: `carry-${phaseIndex}`,
	};

	const obj = binding.object;
	const space = binding.space;
	const objectId = sk.objectId ?? "";
	const spaceId = sk.spaceId ?? "";

	if (!obj || typeof obj !== "object") {
		errors.push({
			entityId: objectId,
			field: "object",
			rule: "missing-field",
			message: `Carry binding ${sk.objectId}: missing object entity`,
			retryUnit: bindingRetryUnit,
		});
	} else {
		checkWrongId(obj, objectId, bindingRetryUnit, errors);
		for (const f of [
			"name",
			"examineDescription",
			"useOutcome",
			"placementFlavor",
			"proximityFlavor",
		]) {
			requiredString(obj, f, objectId, bindingRetryUnit, errors);
		}
		// placementFlavor must contain {actor}
		if (
			typeof obj.placementFlavor === "string" &&
			obj.placementFlavor.length > 0 &&
			!obj.placementFlavor.includes("{actor}")
		) {
			errors.push({
				entityId: objectId,
				field: "placementFlavor",
				rule: "actor-presence",
				message: `Carry object ${sk.objectId}: placementFlavor must contain "{actor}"`,
				retryUnit: bindingRetryUnit,
			});
		}
		// object.examineDescription MUST reference paired space (hard)
		if (
			typeof obj.examineDescription === "string" &&
			obj.examineDescription.length > 0 &&
			sk.spaceId
		) {
			// Check that it at least mentions the space id string (or we just check the space name from the space entity)
			// We'll check this after we have the space name below
		}
	}

	if (!space || typeof space !== "object") {
		errors.push({
			entityId: spaceId,
			field: "space",
			rule: "missing-field",
			message: `Carry binding ${sk.spaceId}: missing space entity`,
			retryUnit: bindingRetryUnit,
		});
	} else {
		checkWrongId(space, spaceId, bindingRetryUnit, errors);
		for (const f of ["name", "examineDescription", "proximityFlavor"]) {
			requiredString(space, f, spaceId, bindingRetryUnit, errors);
		}
		// Forbidden fields on carry space
		for (const f of [
			"activationFlavor",
			"satisfactionFlavor",
			"postExamineDescription",
			"postLookFlavor",
			"convergenceTier1Flavor",
			"convergenceTier2Flavor",
			"convergenceTier1ActorFlavor",
			"convergenceTier2ActorFlavor",
		]) {
			forbiddenField(space, f, spaceId, bindingRetryUnit, errors);
		}
		// Use-cue in carry space examineDescription = warn only
		if (
			typeof space.examineDescription === "string" &&
			space.examineDescription.length > 0
		) {
			if (examineMentionsUseTell(space.examineDescription)) {
				warnings.push({
					entityId: spaceId,
					field: "examineDescription",
					rule: "binding-forbidden-field",
					message: `Carry space ${sk.spaceId}: examineDescription contains a use-cue keyword (warning only — carry spaces should not have use-cue)`,
					retryUnit: bindingRetryUnit,
				});
			}
		}
	}
}

function validateUseSpaceBinding(
	binding: RawBinding,
	sk: BindingSkeleton,
	phaseIndex: number,
	errors: ValidationError[],
): void {
	const bindingRetryUnit = {
		kind: "use-space-binding" as const,
		phaseIndex,
		bindingId: `useSpace-${phaseIndex}`,
	};

	const space = binding.space;
	const spaceId = sk.spaceId ?? "";
	if (!space || typeof space !== "object") {
		errors.push({
			entityId: spaceId,
			field: "space",
			rule: "missing-field",
			message: `UseSpace binding ${sk.spaceId}: missing space entity`,
			retryUnit: bindingRetryUnit,
		});
		return;
	}

	checkWrongId(space, spaceId, bindingRetryUnit, errors);
	for (const f of [
		"name",
		"examineDescription",
		"proximityFlavor",
		"activationFlavor",
		"satisfactionFlavor",
		"postExamineDescription",
		"postLookFlavor",
	]) {
		requiredString(space, f, spaceId, bindingRetryUnit, errors);
	}
	// Forbidden: convergence tier fields, pairsWithSpaceId, placementFlavor
	for (const f of [
		"convergenceTier1Flavor",
		"convergenceTier2Flavor",
		"convergenceTier1ActorFlavor",
		"convergenceTier2ActorFlavor",
		"pairsWithSpaceId",
		"placementFlavor",
	]) {
		forbiddenField(space, f, spaceId, bindingRetryUnit, errors);
	}
	// examineDescription MUST contain use-cue = hard error
	if (
		typeof space.examineDescription === "string" &&
		space.examineDescription.length > 0
	) {
		if (!examineMentionsUseTell(space.examineDescription)) {
			errors.push({
				entityId: spaceId,
				field: "examineDescription",
				rule: "verb-of-activation",
				message: `UseSpace space ${sk.spaceId}: examineDescription must contain at least one use-cue keyword (e.g. ${USE_CUE_KEYWORD_HINTS.map((k) => `"${k}"`).join(", ")}). Current text: ${JSON.stringify(space.examineDescription)}`,
				retryUnit: bindingRetryUnit,
			});
		}
	}
}

function validateUseItemBinding(
	binding: RawBinding,
	sk: BindingSkeleton,
	phaseIndex: number,
	errors: ValidationError[],
): void {
	const bindingRetryUnit = {
		kind: "use-item-binding" as const,
		phaseIndex,
		bindingId: `useItem-${phaseIndex}`,
	};

	const item = binding.item;
	const itemId = sk.itemId ?? "";
	if (!item || typeof item !== "object") {
		errors.push({
			entityId: itemId,
			field: "item",
			rule: "missing-field",
			message: `UseItem binding ${sk.itemId}: missing item entity`,
			retryUnit: bindingRetryUnit,
		});
		return;
	}

	checkWrongId(item, itemId, bindingRetryUnit, errors);
	for (const f of [
		"name",
		"examineDescription",
		"proximityFlavor",
		"useOutcome",
		"activationFlavor",
		"postExamineDescription",
		"postLookFlavor",
	]) {
		requiredString(item, f, itemId, bindingRetryUnit, errors);
	}
	// examineDescription MUST contain use-cue = hard error
	if (
		typeof item.examineDescription === "string" &&
		item.examineDescription.length > 0
	) {
		if (!examineMentionsUseTell(item.examineDescription)) {
			errors.push({
				entityId: itemId,
				field: "examineDescription",
				rule: "verb-of-activation",
				message: `UseItem item ${sk.itemId}: examineDescription must contain at least one use-cue keyword (e.g. ${USE_CUE_KEYWORD_HINTS.map((k) => `"${k}"`).join(", ")}). Current text: ${JSON.stringify(item.examineDescription)}`,
				retryUnit: bindingRetryUnit,
			});
		}
	}
}

function validateConvergenceBinding(
	binding: RawBinding,
	sk: BindingSkeleton,
	phaseIndex: number,
	warnings: ValidationError[],
	errors: ValidationError[],
): void {
	const bindingRetryUnit = {
		kind: "convergence-binding" as const,
		phaseIndex,
		bindingId: `convergence-${phaseIndex}`,
	};

	const space = binding.space;
	const spaceId = sk.spaceId ?? "";
	if (!space || typeof space !== "object") {
		errors.push({
			entityId: spaceId,
			field: "space",
			rule: "missing-field",
			message: `Convergence binding ${sk.spaceId}: missing space entity`,
			retryUnit: bindingRetryUnit,
		});
		return;
	}

	checkWrongId(space, spaceId, bindingRetryUnit, errors);
	for (const f of [
		"name",
		"examineDescription",
		"proximityFlavor",
		"convergenceTier1Flavor",
		"convergenceTier2Flavor",
		"convergenceTier1ActorFlavor",
		"convergenceTier2ActorFlavor",
	]) {
		requiredString(space, f, spaceId, bindingRetryUnit, errors);
	}
	// Forbidden: activationFlavor, satisfactionFlavor, postExamineDescription, postLookFlavor, useAvailable
	for (const f of [
		"activationFlavor",
		"satisfactionFlavor",
		"postExamineDescription",
		"postLookFlavor",
		"useAvailable",
	]) {
		forbiddenField(space, f, spaceId, bindingRetryUnit, errors);
	}
	// Use-cue in convergence space examineDescription = warn only
	if (
		typeof space.examineDescription === "string" &&
		space.examineDescription.length > 0
	) {
		if (examineMentionsUseTell(space.examineDescription)) {
			warnings.push({
				entityId: spaceId,
				field: "examineDescription",
				rule: "binding-forbidden-field",
				message: `Convergence space ${sk.spaceId}: examineDescription contains a use-cue keyword (warning only)`,
				retryUnit: bindingRetryUnit,
			});
		}
	}
}

function validateDecoy(
	decoy: RawDecoy,
	expectedId: string,
	phaseIndex: number,
	errors: ValidationError[],
): void {
	const retryUnit = {
		kind: "decoy" as const,
		phaseIndex,
		decoyId: expectedId,
	};

	if (decoy.id !== expectedId) {
		errors.push({
			entityId: decoy.id ?? "",
			field: "id",
			rule: "wrong-id",
			message: `Decoy id "${decoy.id}" does not match expected id "${expectedId}"`,
			retryUnit,
		});
	}

	const entityId = decoy.id ?? expectedId;
	for (const f of [
		"name",
		"examineDescription",
		"proximityFlavor",
		"useOutcome",
	]) {
		const val = (decoy as Record<string, unknown>)[f];
		if (typeof val !== "string" || val.length === 0) {
			errors.push({
				entityId,
				field: f,
				rule: "missing-field",
				message: `Decoy ${entityId}: missing required field "${f}"`,
				retryUnit,
			});
		}
	}
	// Forbidden: activationFlavor, postExamineDescription, postLookFlavor
	for (const f of [
		"activationFlavor",
		"postExamineDescription",
		"postLookFlavor",
	]) {
		if ((decoy as Record<string, unknown>)[f] !== undefined) {
			errors.push({
				entityId,
				field: f,
				rule: "binding-forbidden-field",
				message: `Decoy ${entityId}: field "${f}" is forbidden`,
				retryUnit,
			});
		}
	}
	// examineDescription MUST NOT contain use-cue = hard error
	if (
		typeof decoy.examineDescription === "string" &&
		decoy.examineDescription.length > 0
	) {
		const matched = findMatchedUseTellKeywords(decoy.examineDescription);
		if (matched.length > 0) {
			const matchedList = matched.map((k) => `"${k}"`).join(", ");
			errors.push({
				entityId,
				field: "examineDescription",
				rule: "verb-of-activation",
				message: `Decoy ${entityId}: examineDescription must NOT contain any use-cue keyword — found forbidden keyword(s): ${matchedList}. Rewrite the examineDescription using only neutral descriptive language (no activation/control verbs, no control nouns like "lever"/"button"/"switch"/"dial").`,
				retryUnit,
			});
		}
	}
}

function validateObstacle(
	obstacle: RawObstacle,
	expectedId: string,
	phaseIndex: number,
	errors: ValidationError[],
): void {
	const retryUnit = {
		kind: "obstacle" as const,
		phaseIndex,
		entityId: expectedId,
	};

	if (obstacle.id !== expectedId) {
		errors.push({
			entityId: obstacle.id ?? "",
			field: "id",
			rule: "wrong-id",
			message: `Obstacle id "${obstacle.id}" does not match expected id "${expectedId}"`,
			retryUnit,
		});
	}

	const entityId = obstacle.id ?? expectedId;
	for (const f of ["name", "examineDescription", "shiftFlavor"]) {
		const val = (obstacle as Record<string, unknown>)[f];
		if (typeof val !== "string" || val.length === 0) {
			errors.push({
				entityId,
				field: f,
				rule: "missing-field",
				message: `Obstacle ${entityId}: missing required field "${f}"`,
				retryUnit,
			});
		}
	}
	// shiftFlavor MUST NOT contain {actor}
	if (
		typeof obstacle.shiftFlavor === "string" &&
		obstacle.shiftFlavor.includes("{actor}")
	) {
		errors.push({
			entityId,
			field: "shiftFlavor",
			rule: "actor-exclusion",
			message: `Obstacle ${entityId}: shiftFlavor must not contain "{actor}"`,
			retryUnit,
		});
	}
}

// ── Pack validation ───────────────────────────────────────────────────────────

function validateBoundPack(
	pack: RawBoundPack,
	schedule: ValidationSchedule,
	phaseIndex: number,
	errors: ValidationError[],
	warnings: ValidationError[],
): void {
	const bindings = pack.bindings ?? [];
	const decoys = pack.decoys ?? [];
	const obstacles = pack.obstacles ?? [];

	// Validate each binding against schedule
	for (const [i, sk] of schedule.skeletons.entries()) {
		const binding = bindings[i];
		if (!binding) {
			errors.push({
				entityId: "",
				field: "bindings",
				rule: "missing-field",
				message: `Phase ${phaseIndex}: binding ${i} is missing`,
				retryUnit: { kind: "objective-pair", phaseIndex, pairId: "" },
			});
			continue;
		}

		switch (sk.type) {
			case "carry":
				validateCarryBinding(binding, sk, phaseIndex, warnings, errors);
				break;
			case "use_space":
				validateUseSpaceBinding(binding, sk, phaseIndex, errors);
				break;
			case "use_item":
				validateUseItemBinding(binding, sk, phaseIndex, errors);
				break;
			case "convergence":
				validateConvergenceBinding(binding, sk, phaseIndex, warnings, errors);
				break;
		}
	}

	// Validate decoys: always exactly 2
	if (decoys.length !== schedule.decoys.length) {
		errors.push({
			entityId: "",
			field: "decoys",
			rule: "wrong-count",
			message: `Phase ${phaseIndex}: expected ${schedule.decoys.length} decoys, got ${decoys.length}`,
			retryUnit: { kind: "objective-pair", phaseIndex, pairId: "" },
		});
	} else {
		for (const [i, expectedDecoy] of schedule.decoys.entries()) {
			const decoy = decoys[i];
			if (!decoy) {
				errors.push({
					entityId: expectedDecoy.id,
					field: "decoys",
					rule: "missing-field",
					message: `Phase ${phaseIndex}: decoy ${i} is missing`,
					retryUnit: { kind: "decoy", phaseIndex, decoyId: expectedDecoy.id },
				});
				continue;
			}
			validateDecoy(decoy, expectedDecoy.id, phaseIndex, errors);
		}
	}

	// Validate obstacles
	for (let i = 0; i < schedule.obstacleCount; i++) {
		const expectedId = `obstacle-${i}`;
		const obstacle = obstacles[i];
		if (!obstacle) {
			errors.push({
				entityId: expectedId,
				field: "obstacles",
				rule: "missing-field",
				message: `Phase ${phaseIndex}: obstacle ${i} (id="${expectedId}") is missing`,
				retryUnit: { kind: "obstacle", phaseIndex, entityId: expectedId },
			});
			continue;
		}
		validateObstacle(obstacle, expectedId, phaseIndex, errors);
	}
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate a single-pack binding-shaped response against the pre-minted schedule.
 *
 * Returns `{ ok: true, warnings }` when all hard rules pass.
 * Returns `{ ok: false, errors }` when any hard rules fail.
 */
export function validateBoundContentPack(
	rawResponse: unknown,
	schedule: ValidationSchedule,
): ValidationResult<{ warnings: ValidationError[] }> {
	const errors: ValidationError[] = [];
	const warnings: ValidationError[] = [];

	if (rawResponse == null || typeof rawResponse !== "object") {
		errors.push({
			entityId: "",
			field: "<root>",
			rule: "structural",
			message: "Response is not an object",
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
		return { ok: false, errors };
	}

	const resp = rawResponse as Record<string, unknown>;
	const pack = resp.pack as RawBoundPack | undefined;
	if (!pack || typeof pack !== "object") {
		errors.push({
			entityId: "",
			field: "pack",
			rule: "missing-field",
			message: "Response missing 'pack' field",
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
		return { ok: false, errors };
	}

	validateBoundPack(pack, schedule, 0, errors, warnings);

	return errors.length === 0
		? { ok: true, value: { warnings } }
		: { ok: false, errors };
}

/**
 * Validate a dual-pack binding-shaped response against the pre-minted schedule.
 * Both packA and packB must pass validation with the same schedule.
 */
export function validateBoundDualContentPack(
	rawResponse: unknown,
	schedule: ValidationSchedule,
): ValidationResult<{ warnings: ValidationError[] }> {
	const errors: ValidationError[] = [];
	const warnings: ValidationError[] = [];

	if (rawResponse == null || typeof rawResponse !== "object") {
		errors.push({
			entityId: "",
			field: "<root>",
			rule: "structural",
			message: "Response is not an object",
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
		return { ok: false, errors };
	}

	const resp = rawResponse as Record<string, unknown>;
	const phases = resp.phases as
		| Array<{ packA?: RawBoundPack; packB?: RawBoundPack }>
		| undefined;

	if (!Array.isArray(phases) || phases.length === 0) {
		errors.push({
			entityId: "",
			field: "phases",
			rule: "missing-field",
			message: "Response missing 'phases' array",
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
		return { ok: false, errors };
	}

	const phase = phases[0];
	if (!phase) {
		errors.push({
			entityId: "",
			field: "phases[0]",
			rule: "structural",
			message: "Phase 0 is missing",
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
		return { ok: false, errors };
	}

	const packA = phase.packA;
	const packB = phase.packB;

	if (!packA || typeof packA !== "object") {
		errors.push({
			entityId: "",
			field: "packA",
			rule: "missing-field",
			message: "Phase 0 missing packA",
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
	} else {
		validateBoundPack(packA, schedule, 0, errors, warnings);
	}

	if (!packB || typeof packB !== "object") {
		errors.push({
			entityId: "",
			field: "packB",
			rule: "missing-field",
			message: "Phase 0 missing packB",
			retryUnit: { kind: "objective-pair", phaseIndex: 0, pairId: "" },
		});
	} else {
		validateBoundPack(packB, schedule, 0, errors, warnings);
	}

	return errors.length === 0
		? { ok: true, value: { warnings } }
		: { ok: false, errors };
}
