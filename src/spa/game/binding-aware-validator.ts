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
	bindings?: RawBinding[];
	decoys?: RawDecoy[];
	obstacles?: RawObstacle[];
}

export interface ValidationSchedule {
	skeletons: BindingSkeleton[];
	decoys: { id: string }[];
	obstacleCount: number;
}

const CONVERGENCE_TIER_FIELDS = [
	"convergenceTier1Flavor",
	"convergenceTier2Flavor",
	"convergenceTier1ActorFlavor",
	"convergenceTier2ActorFlavor",
];

const ACTIVATION_OUTCOME_FIELDS = [
	"activationFlavor",
	"satisfactionFlavor",
	"postExamineDescription",
	"postLookFlavor",
];

const CARRY_OBJECT_REQUIRED_FIELDS = [
	"name",
	"examineDescription",
	"useOutcome",
	"placementFlavor",
	"proximityFlavor",
];
const CARRY_SPACE_REQUIRED_FIELDS = [
	"name",
	"examineDescription",
	"proximityFlavor",
];
const CARRY_SPACE_FORBIDDEN_FIELDS = [
	...ACTIVATION_OUTCOME_FIELDS,
	...CONVERGENCE_TIER_FIELDS,
];

const USE_SPACE_REQUIRED_FIELDS = [
	"name",
	"examineDescription",
	"proximityFlavor",
	...ACTIVATION_OUTCOME_FIELDS,
];
const USE_SPACE_FORBIDDEN_FIELDS = [
	...CONVERGENCE_TIER_FIELDS,
	"pairsWithSpaceId",
	"placementFlavor",
];

const USE_ITEM_REQUIRED_FIELDS = [
	"name",
	"examineDescription",
	"proximityFlavor",
	"useOutcome",
	"activationFlavor",
	"postExamineDescription",
	"postLookFlavor",
];

const CONVERGENCE_SPACE_REQUIRED_FIELDS = [
	"name",
	"examineDescription",
	"proximityFlavor",
	...CONVERGENCE_TIER_FIELDS,
];
const CONVERGENCE_SPACE_FORBIDDEN_FIELDS = [
	...ACTIVATION_OUTCOME_FIELDS,
	"useAvailable",
];

const DECOY_REQUIRED_FIELDS = [
	"name",
	"examineDescription",
	"proximityFlavor",
	"useOutcome",
];
const DECOY_FORBIDDEN_FIELDS = [
	"activationFlavor",
	"postExamineDescription",
	"postLookFlavor",
];

const OBSTACLE_REQUIRED_FIELDS = ["name", "examineDescription", "shiftFlavor"];

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

type EntitySubKey = "object" | "space" | "item";

function bindingShapeHint(
	subKey: EntitySubKey,
	expectedId: string,
	retryUnit: ValidationError["retryUnit"],
): string {
	switch (retryUnit.kind) {
		case "carry-binding":
			return subKey === "object"
				? `{ "type": "carry", "object": { "id": "${expectedId}", "name": ..., "examineDescription": ..., ... }, "space": { ... } }`
				: `{ "type": "carry", "object": { ... }, "space": { "id": "${expectedId}", "name": ..., "examineDescription": ..., ... } }`;
		case "use-space-binding":
			return `{ "type": "use_space", "space": { "id": "${expectedId}", "name": ..., "examineDescription": ..., "activationFlavor": ..., ... } }`;
		case "use-item-binding":
			return `{ "type": "use_item", "item": { "id": "${expectedId}", "name": ..., "examineDescription": ..., "useOutcome": ..., ... } }`;
		case "convergence-binding":
			return `{ "type": "convergence", "space": { "id": "${expectedId}", "name": ..., "convergenceTier1Flavor": ..., ... } }`;
		default:
			return `{ "id": "${expectedId}", ... }`;
	}
}

function checkWrongId(
	entity: RawBindingEntity,
	expectedId: string,
	retryUnit: ValidationError["retryUnit"],
	errors: ValidationError[],
	subKey: EntitySubKey,
): void {
	if (entity.id !== expectedId) {
		const actual = entity.id === undefined ? "(missing)" : `"${entity.id}"`;
		const shape = bindingShapeHint(subKey, expectedId, retryUnit);
		errors.push({
			entityId: entity.id ?? "",
			field: "id",
			rule: "wrong-id",
			message:
				`The "${subKey}" sub-object inside this binding must include a top-level string field "id" equal to "${expectedId}". ` +
				`Got ${actual}. Required shape: ${shape}`,
			retryUnit,
		});
	}
}

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
			message:
				`Carry binding: the binding object has no "object" key. ` +
				`Add a top-level "object" sub-object with id "${objectId}". Required shape: ${bindingShapeHint("object", objectId, bindingRetryUnit)}`,
			retryUnit: bindingRetryUnit,
		});
	} else {
		checkWrongId(obj, objectId, bindingRetryUnit, errors, "object");
		for (const f of CARRY_OBJECT_REQUIRED_FIELDS) {
			requiredString(obj, f, objectId, bindingRetryUnit, errors);
		}
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
	}

	if (!space || typeof space !== "object") {
		errors.push({
			entityId: spaceId,
			field: "space",
			rule: "missing-field",
			message:
				`Carry binding: the binding object has no "space" key. ` +
				`Add a top-level "space" sub-object with id "${spaceId}". Required shape: ${bindingShapeHint("space", spaceId, bindingRetryUnit)}`,
			retryUnit: bindingRetryUnit,
		});
	} else {
		checkWrongId(space, spaceId, bindingRetryUnit, errors, "space");
		for (const f of CARRY_SPACE_REQUIRED_FIELDS) {
			requiredString(space, f, spaceId, bindingRetryUnit, errors);
		}
		for (const f of CARRY_SPACE_FORBIDDEN_FIELDS) {
			forbiddenField(space, f, spaceId, bindingRetryUnit, errors);
		}
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
			message:
				`UseSpace binding: the binding object has no "space" key. ` +
				`Add a top-level "space" sub-object with id "${spaceId}". Required shape: ${bindingShapeHint("space", spaceId, bindingRetryUnit)}`,
			retryUnit: bindingRetryUnit,
		});
		return;
	}

	checkWrongId(space, spaceId, bindingRetryUnit, errors, "space");
	for (const f of USE_SPACE_REQUIRED_FIELDS) {
		requiredString(space, f, spaceId, bindingRetryUnit, errors);
	}
	for (const f of USE_SPACE_FORBIDDEN_FIELDS) {
		forbiddenField(space, f, spaceId, bindingRetryUnit, errors);
	}
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
			message:
				`UseItem binding: the binding object has no "item" key. ` +
				`Add a top-level "item" sub-object with id "${itemId}". Required shape: ${bindingShapeHint("item", itemId, bindingRetryUnit)}`,
			retryUnit: bindingRetryUnit,
		});
		return;
	}

	checkWrongId(item, itemId, bindingRetryUnit, errors, "item");
	for (const f of USE_ITEM_REQUIRED_FIELDS) {
		requiredString(item, f, itemId, bindingRetryUnit, errors);
	}
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
			message:
				`Convergence binding: the binding object has no "space" key. ` +
				`Add a top-level "space" sub-object with id "${spaceId}". Required shape: ${bindingShapeHint("space", spaceId, bindingRetryUnit)}`,
			retryUnit: bindingRetryUnit,
		});
		return;
	}

	checkWrongId(space, spaceId, bindingRetryUnit, errors, "space");
	for (const f of CONVERGENCE_SPACE_REQUIRED_FIELDS) {
		requiredString(space, f, spaceId, bindingRetryUnit, errors);
	}
	for (const f of CONVERGENCE_SPACE_FORBIDDEN_FIELDS) {
		forbiddenField(space, f, spaceId, bindingRetryUnit, errors);
	}
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
	for (const f of DECOY_REQUIRED_FIELDS) {
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
	for (const f of DECOY_FORBIDDEN_FIELDS) {
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
	for (const f of OBSTACLE_REQUIRED_FIELDS) {
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
