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

export type RetryUnit =
	| { kind: "objective-pair"; phaseIndex: number; pairId: string }
	| { kind: "obstacle"; phaseIndex: number; entityId: string }
	| { kind: "carry-binding"; phaseIndex: number; bindingId: string }
	| { kind: "use-space-binding"; phaseIndex: number; bindingId: string }
	| { kind: "use-item-binding"; phaseIndex: number; bindingId: string }
	| { kind: "convergence-binding"; phaseIndex: number; bindingId: string }
	| { kind: "decoy"; phaseIndex: number; decoyId: string };

type ValidationRule =
	| "verb-of-activation"
	| "actor-presence"
	| "actor-exclusion"
	| "structural"
	| "missing-field"
	| "wrong-count"
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
