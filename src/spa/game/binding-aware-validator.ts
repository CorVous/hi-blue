import type { BindingSkeleton } from "./binding-prompt-builder.js";
import { obstacleIds } from "./binding-prompt-builder.js";
import type {
	PackLabel,
	ValidationError,
	ValidationResult,
} from "./content-pack-validation.js";
import {
	findMatchedUseTellKeywords,
	USE_CUE_KEYWORD_HINTS,
} from "./content-pack-validation.js";

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

const PACK_REQUIRED_FIELDS = ["setting", "wallName"] as const;

const OBSTACLE_REQUIRED_FIELDS = ["name", "examineDescription", "shiftFlavor"];

type RetryTarget = ValidationError["retryUnit"];

const WHOLE_PACK_RETRY_UNIT: RetryTarget = {
	kind: "objective-pair",
	pairId: "",
};

interface EntityLabel {
	noun: string;
	forbiddenReason: string;
}

const BINDING_ENTITY_LABEL: EntityLabel = {
	noun: "Entity",
	forbiddenReason: " for this binding type",
};
const DECOY_LABEL: EntityLabel = { noun: "Decoy", forbiddenReason: "" };
const OBSTACLE_LABEL: EntityLabel = { noun: "Obstacle", forbiddenReason: "" };

function requiredString(
	entity: Record<string, unknown>,
	field: string,
	entityId: string,
	retryUnit: RetryTarget,
	errors: ValidationError[],
	label: EntityLabel,
): void {
	const val = entity[field];
	if (typeof val !== "string" || val.length === 0) {
		errors.push({
			entityId,
			field,
			rule: "missing-field",
			message: `${label.noun} ${entityId}: missing required field "${field}"`,
			retryUnit,
		});
	}
}

function forbiddenField(
	entity: Record<string, unknown>,
	field: string,
	entityId: string,
	retryUnit: RetryTarget,
	errors: ValidationError[],
	label: EntityLabel,
): void {
	if (entity[field] !== undefined) {
		errors.push({
			entityId,
			field,
			rule: "binding-forbidden-field",
			message: `${label.noun} ${entityId}: field "${field}" is forbidden${label.forbiddenReason}`,
			retryUnit,
		});
	}
}

type EntitySubKey = "object" | "space" | "item";

function bindingShapeHint(
	subKey: EntitySubKey,
	expectedId: string,
	retryUnit: RetryTarget,
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
	retryUnit: RetryTarget,
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

function hasText(value: string | undefined): value is string {
	return typeof value === "string" && value.length > 0;
}

function useCueHintList(): string {
	return USE_CUE_KEYWORD_HINTS.map((k) => `"${k}"`).join(", ");
}

interface EntityCheckContext {
	entity: RawBindingEntity;
	entityId: string;
	skeletonId: string | undefined;
	retryUnit: RetryTarget;
	errors: ValidationError[];
	warnings: ValidationError[];
}

interface BindingEntityRule {
	subKey: EntitySubKey;
	skeletonId: (sk: BindingSkeleton) => string | undefined;
	required: readonly string[];
	forbidden: readonly string[];
	extraCheck: (ctx: EntityCheckContext) => void;
}

interface BindingRule {
	label: string;
	retryUnit: (bindingIndex: number) => RetryTarget;
	entities: readonly BindingEntityRule[];
}

function requireActorInPlacement({
	entity,
	entityId,
	skeletonId,
	retryUnit,
	errors,
}: EntityCheckContext): void {
	if (
		hasText(entity.placementFlavor) &&
		!entity.placementFlavor.includes("{actor}")
	) {
		errors.push({
			entityId,
			field: "placementFlavor",
			rule: "actor-presence",
			message: `Carry object ${skeletonId}: placementFlavor must contain "{actor}"`,
			retryUnit,
		});
	}
}

function warnOnUseCue(label: string, suffix: string) {
	return ({
		entity,
		entityId,
		skeletonId,
		retryUnit,
		warnings,
	}: EntityCheckContext): void => {
		if (
			hasText(entity.examineDescription) &&
			findMatchedUseTellKeywords(entity.examineDescription).length > 0
		) {
			warnings.push({
				entityId,
				field: "examineDescription",
				rule: "binding-forbidden-field",
				message: `${label} ${skeletonId}: examineDescription contains a use-cue keyword (warning only${suffix})`,
				retryUnit,
			});
		}
	};
}

function requireUseCue(label: string) {
	return ({
		entity,
		entityId,
		skeletonId,
		retryUnit,
		errors,
	}: EntityCheckContext): void => {
		if (
			hasText(entity.examineDescription) &&
			findMatchedUseTellKeywords(entity.examineDescription).length === 0
		) {
			errors.push({
				entityId,
				field: "examineDescription",
				rule: "verb-of-activation",
				message: `${label} ${skeletonId}: examineDescription must contain at least one use-cue keyword (e.g. ${useCueHintList()}). Current text: ${JSON.stringify(entity.examineDescription)}`,
				retryUnit,
			});
		}
	};
}

const BINDING_RULES: Readonly<Record<BindingSkeleton["type"], BindingRule>> = {
	carry: {
		label: "Carry",
		retryUnit: (i) => ({ kind: "carry-binding", bindingId: `carry-${i}` }),
		entities: [
			{
				subKey: "object",
				skeletonId: (sk) => sk.objectId,
				required: CARRY_OBJECT_REQUIRED_FIELDS,
				forbidden: [],
				extraCheck: requireActorInPlacement,
			},
			{
				subKey: "space",
				skeletonId: (sk) => sk.spaceId,
				required: CARRY_SPACE_REQUIRED_FIELDS,
				forbidden: CARRY_SPACE_FORBIDDEN_FIELDS,
				extraCheck: warnOnUseCue(
					"Carry space",
					" — carry spaces should not have use-cue",
				),
			},
		],
	},
	use_space: {
		label: "UseSpace",
		retryUnit: (i) => ({
			kind: "use-space-binding",
			bindingId: `useSpace-${i}`,
		}),
		entities: [
			{
				subKey: "space",
				skeletonId: (sk) => sk.spaceId,
				required: USE_SPACE_REQUIRED_FIELDS,
				forbidden: USE_SPACE_FORBIDDEN_FIELDS,
				extraCheck: requireUseCue("UseSpace space"),
			},
		],
	},
	use_item: {
		label: "UseItem",
		retryUnit: (i) => ({ kind: "use-item-binding", bindingId: `useItem-${i}` }),
		entities: [
			{
				subKey: "item",
				skeletonId: (sk) => sk.itemId,
				required: USE_ITEM_REQUIRED_FIELDS,
				forbidden: [],
				extraCheck: requireUseCue("UseItem item"),
			},
		],
	},
	convergence: {
		label: "Convergence",
		retryUnit: (i) => ({
			kind: "convergence-binding",
			bindingId: `convergence-${i}`,
		}),
		entities: [
			{
				subKey: "space",
				skeletonId: (sk) => sk.spaceId,
				required: CONVERGENCE_SPACE_REQUIRED_FIELDS,
				forbidden: CONVERGENCE_SPACE_FORBIDDEN_FIELDS,
				extraCheck: warnOnUseCue("Convergence space", ""),
			},
		],
	},
};

function validateBindingEntity(
	binding: RawBinding,
	sk: BindingSkeleton,
	rule: BindingRule,
	entityRule: BindingEntityRule,
	retryUnit: RetryTarget,
	warnings: ValidationError[],
	errors: ValidationError[],
): void {
	const { subKey } = entityRule;
	const entity = binding[subKey];
	const skeletonId = entityRule.skeletonId(sk);
	const entityId = skeletonId ?? "";

	if (!entity || typeof entity !== "object") {
		errors.push({
			entityId,
			field: subKey,
			rule: "missing-field",
			message:
				`${rule.label} binding: the binding object has no "${subKey}" key. ` +
				`Add a top-level "${subKey}" sub-object with id "${entityId}". Required shape: ${bindingShapeHint(subKey, entityId, retryUnit)}`,
			retryUnit,
		});
		return;
	}

	checkWrongId(entity, entityId, retryUnit, errors, subKey);
	for (const f of entityRule.required) {
		requiredString(
			entity,
			f,
			entityId,
			retryUnit,
			errors,
			BINDING_ENTITY_LABEL,
		);
	}
	for (const f of entityRule.forbidden) {
		forbiddenField(
			entity,
			f,
			entityId,
			retryUnit,
			errors,
			BINDING_ENTITY_LABEL,
		);
	}
	entityRule.extraCheck({
		entity,
		entityId,
		skeletonId,
		retryUnit,
		errors,
		warnings,
	});
}

function validateBinding(
	binding: RawBinding,
	sk: BindingSkeleton,
	bindingIndex: number,
	warnings: ValidationError[],
	errors: ValidationError[],
): void {
	const rule = BINDING_RULES[sk.type];
	const retryUnit = rule.retryUnit(bindingIndex);
	for (const entityRule of rule.entities) {
		validateBindingEntity(
			binding,
			sk,
			rule,
			entityRule,
			retryUnit,
			warnings,
			errors,
		);
	}
}

function validateDecoy(
	decoy: RawDecoy,
	expectedId: string,
	errors: ValidationError[],
): void {
	const retryUnit = {
		kind: "decoy" as const,
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
		requiredString(decoy, f, entityId, retryUnit, errors, DECOY_LABEL);
	}
	for (const f of DECOY_FORBIDDEN_FIELDS) {
		forbiddenField(decoy, f, entityId, retryUnit, errors, DECOY_LABEL);
	}
	if (hasText(decoy.examineDescription)) {
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
	errors: ValidationError[],
): void {
	const retryUnit = {
		kind: "obstacle" as const,
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
		requiredString(obstacle, f, entityId, retryUnit, errors, OBSTACLE_LABEL);
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
	errors: ValidationError[],
	warnings: ValidationError[],
): void {
	const bindings = pack.bindings ?? [];
	const decoys = pack.decoys ?? [];
	const obstacles = pack.obstacles ?? [];

	for (const field of PACK_REQUIRED_FIELDS) {
		const value = pack[field];
		if (typeof value !== "string" || value.trim().length === 0) {
			errors.push({
				entityId: "",
				field,
				rule: "missing-field",
				message: `Pack is missing required top-level string field "${field}"`,
				retryUnit: WHOLE_PACK_RETRY_UNIT,
			});
		}
	}

	for (const [i, sk] of schedule.skeletons.entries()) {
		const binding = bindings[i];
		if (!binding) {
			errors.push({
				entityId: "",
				field: "bindings",
				rule: "missing-field",
				message: `Binding ${i} is missing`,
				retryUnit: WHOLE_PACK_RETRY_UNIT,
			});
			continue;
		}

		validateBinding(binding, sk, i, warnings, errors);
	}

	if (decoys.length !== schedule.decoys.length) {
		errors.push({
			entityId: "",
			field: "decoys",
			rule: "wrong-count",
			message: `Expected ${schedule.decoys.length} decoys, got ${decoys.length}`,
			retryUnit: WHOLE_PACK_RETRY_UNIT,
		});
	} else {
		for (const [i, expectedDecoy] of schedule.decoys.entries()) {
			const decoy = decoys[i];
			if (!decoy) {
				errors.push({
					entityId: expectedDecoy.id,
					field: "decoys",
					rule: "missing-field",
					message: `Decoy ${i} is missing`,
					retryUnit: { kind: "decoy", decoyId: expectedDecoy.id },
				});
				continue;
			}
			validateDecoy(decoy, expectedDecoy.id, errors);
		}
	}

	if (obstacles.length !== schedule.obstacleCount) {
		const expectedIds = obstacleIds(schedule.obstacleCount)
			.map((id) => `"${id}"`)
			.join(", ");
		errors.push({
			entityId: "",
			field: "obstacles",
			rule: "wrong-count",
			message: `Expected exactly ${schedule.obstacleCount} obstacles (${expectedIds || "none"}), got ${obstacles.length}`,
			retryUnit: WHOLE_PACK_RETRY_UNIT,
		});
	}

	for (const [i, expectedId] of obstacleIds(schedule.obstacleCount).entries()) {
		const obstacle = obstacles[i];
		if (!obstacle) {
			errors.push({
				entityId: expectedId,
				field: "obstacles",
				rule: "missing-field",
				message: `Obstacle ${i} (id="${expectedId}") is missing`,
				retryUnit: { kind: "obstacle", entityId: expectedId },
			});
			continue;
		}
		validateObstacle(obstacle, expectedId, errors);
	}
}

function labelWithPack(
	error: ValidationError,
	pack: PackLabel,
): ValidationError {
	return { ...error, retryUnit: { ...error.retryUnit, pack } };
}

function validateLabelledPack(
	pack: RawBoundPack | undefined,
	label: PackLabel,
	schedule: ValidationSchedule,
	errors: ValidationError[],
	warnings: ValidationError[],
): void {
	const packErrors: ValidationError[] = [];
	const packWarnings: ValidationError[] = [];
	if (!pack || typeof pack !== "object") {
		packErrors.push({
			entityId: "",
			field: `pack${label}`,
			rule: "missing-field",
			message: `Phase 0 missing pack${label}`,
			retryUnit: WHOLE_PACK_RETRY_UNIT,
		});
	} else {
		validateBoundPack(pack, schedule, packErrors, packWarnings);
	}
	errors.push(...packErrors.map((e) => labelWithPack(e, label)));
	warnings.push(...packWarnings.map((w) => labelWithPack(w, label)));
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
			retryUnit: WHOLE_PACK_RETRY_UNIT,
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
			retryUnit: WHOLE_PACK_RETRY_UNIT,
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
			retryUnit: WHOLE_PACK_RETRY_UNIT,
		});
		return { ok: false, errors };
	}

	validateLabelledPack(phase.packA, "A", schedule, errors, warnings);
	validateLabelledPack(phase.packB, "B", schedule, errors, warnings);

	return errors.length === 0
		? { ok: true, value: { warnings } }
		: { ok: false, errors };
}
