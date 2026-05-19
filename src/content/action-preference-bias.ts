/**
 * Per-temperament per-tool affinity biases for action-tool variation
 * (issue: daemon-action-variation).
 *
 * Background: daemons emit `message` calls frequently but rarely use the
 * non-message action surface (go / look / examine / pick_up / put_down /
 * give / use), even when the same turn can carry both. Counterpart to
 * `engagement-clauses.ts`: where that module shapes *whether* a daemon
 * speaks, this one shapes *which actions* they take when they do act.
 *
 * Each temperament contributes a per-tool numeric bias on a [-2, +2]
 * scale. Two temperaments combine (sum) per tool. The combined biases
 * are mapped through `actionProfileFor` into a concrete prose clause
 * baked into the persona's prompt at synthesis time.
 *
 * Calibration:
 *   - Temperaments with direct action implications get strong weights
 *     (±1, ±2) on the tools they push or suppress.
 *   - Ambiguous temperaments get 0 on most tools — they don't move the
 *     dial in any particular direction.
 *   - The `use` channel has a baseline floor: the combined sum can
 *     never drop below -1, so every persona retains some likelihood of
 *     using interactive objects (critical for objective-completion).
 */

import { TEMPERAMENT_POOL } from "./temperament-pool.js";

export const ACTION_TOOLS = [
	"go",
	"look",
	"examine",
	"pick_up",
	"put_down",
	"give",
	"use",
] as const;

export type ActionTool = (typeof ACTION_TOOLS)[number];

/**
 * Per-temperament per-tool affinity bias on a [-2, +2] scale.
 * Negative = less likely to use this tool; positive = more likely.
 */
export const ACTION_TOOL_BIAS: Record<string, Record<ActionTool, number>> = {
	"hot-headed": {
		go: 2,
		look: 1,
		examine: -1,
		pick_up: 1,
		put_down: 0,
		give: 1,
		use: 0,
	},
	taciturn: {
		go: -1,
		look: 0,
		examine: 1,
		pick_up: 0,
		put_down: 0,
		give: -1,
		use: -1,
	},
	meticulous: {
		go: -1,
		look: 1,
		examine: 2,
		pick_up: 0,
		put_down: 1,
		give: 0,
		use: 1,
	},
	erratic: {
		go: 2,
		look: 1,
		examine: -1,
		pick_up: 1,
		put_down: 0,
		give: 0,
		use: 0,
	},
	melancholic: {
		go: -2,
		look: 0,
		examine: 1,
		pick_up: -1,
		put_down: -1,
		give: -1,
		use: -1,
	},
	glib: {
		go: 1,
		look: 1,
		examine: -2,
		pick_up: 0,
		put_down: 0,
		give: 1,
		use: -1,
	},
	pedantic: {
		go: -1,
		look: 1,
		examine: 2,
		pick_up: 0,
		put_down: 1,
		give: 0,
		use: 1,
	},
	effusive: {
		go: 1,
		look: 1,
		examine: -1,
		pick_up: 1,
		put_down: 0,
		give: 2,
		use: 0,
	},
	sardonic: {
		go: 0,
		look: 1,
		examine: 0,
		pick_up: 0,
		put_down: 0,
		give: 1,
		use: -1,
	},
	mercurial: {
		go: 1,
		look: 1,
		examine: 0,
		pick_up: 0,
		put_down: 0,
		give: 0,
		use: 0,
	},
	diffident: {
		go: -2,
		look: -1,
		examine: 1,
		pick_up: -1,
		put_down: 0,
		give: -2,
		use: -1,
	},
	zealous: {
		go: 2,
		look: 1,
		examine: 0,
		pick_up: 1,
		put_down: 0,
		give: 1,
		use: 1,
	},
	verbose: {
		go: 1,
		look: 1,
		examine: 0,
		pick_up: 0,
		put_down: 0,
		give: 1,
		use: 0,
	},
	sweet: {
		go: 0,
		look: 1,
		examine: 1,
		pick_up: 1,
		put_down: 0,
		give: 2,
		use: 0,
	},
	anxious: {
		go: -1,
		look: 0,
		examine: 1,
		pick_up: -1,
		put_down: 1,
		give: 0,
		use: -1,
	},
	haughty: {
		go: 1,
		look: 1,
		examine: 0,
		pick_up: 0,
		put_down: 0,
		give: 0,
		use: 0,
	},
	sly: { go: 1, look: 1, examine: 0, pick_up: 1, put_down: 0, give: 1, use: 0 },
	theatrical: {
		go: 2,
		look: 2,
		examine: -1,
		pick_up: 1,
		put_down: 0,
		give: 1,
		use: -1,
	},
	aloof: {
		go: -1,
		look: -1,
		examine: 1,
		pick_up: -2,
		put_down: 0,
		give: -2,
		use: -1,
	},
	cheery: {
		go: 1,
		look: 1,
		examine: 0,
		pick_up: 1,
		put_down: 0,
		give: 1,
		use: 0,
	},
	mischievous: {
		go: 2,
		look: 1,
		examine: 0,
		pick_up: 1,
		put_down: 1,
		give: 1,
		use: 1,
	},
	stoic: {
		go: -1,
		look: 0,
		examine: 1,
		pick_up: 0,
		put_down: 0,
		give: -1,
		use: 0,
	},
	curious: {
		go: 1,
		look: 2,
		examine: 2,
		pick_up: 1,
		put_down: -1,
		give: 0,
		use: 1,
	},
	earnest: {
		go: 0,
		look: 1,
		examine: 1,
		pick_up: 0,
		put_down: 0,
		give: 1,
		use: 1,
	},
};

/**
 * Sum two temperaments' biases per tool. Returns a record keyed by each tool
 * in `ACTION_TOOLS`. Unknown temperaments are treated as 0 contributors
 * (mirrors `engagement-clauses.biasSum`'s defensive handling).
 *
 * The `use` channel is floored at -1 — this is the "baseline floor on `use`"
 * decision in the plan: every daemon retains some likelihood of using
 * interactive objects, since `use` is the critical-path tool for objective
 * completion.
 */
export function toolBiasSum(
	t1: string,
	t2: string,
): Record<ActionTool, number> {
	const result = {} as Record<ActionTool, number>;
	for (const tool of ACTION_TOOLS) {
		const bias1 = ACTION_TOOL_BIAS[t1]?.[tool] ?? 0;
		const bias2 = ACTION_TOOL_BIAS[t2]?.[tool] ?? 0;
		const sum = bias1 + bias2;
		result[tool] = tool === "use" ? Math.max(sum, -1) : sum;
	}
	return result;
}

/**
 * Render an action-profile clause for a persona.
 *
 * v2: switched from prose ("examines methodically") to directive language
 * ("STRICTLY prefers", "AVOIDS"). v2.5 (current): softens the directive so
 * preferred tools come up frequently but not exclusively (~70/30 split with
 * other available actions), and avoided tools still fire occasionally when
 * the moment fits. v2's hard "STRICTLY" produced 95-100% emissions on the
 * leaned tool, suppressing variety within a persona; the v2.5 wording aims
 * for variety-with-bias instead of mono-tool fixation.
 *
 * Thresholds:
 *   - preferred: per-tool bias sum ≥ +2 (a clear push from the temperament pair)
 *   - avoided:   per-tool bias sum ≤ -1 (a non-trivial pull-back)
 *
 * The threshold pair is asymmetric on purpose. Most temperament pairs
 * have a handful of mild positive biases (which we don't want to call
 * out — "leans toward 6 tools" loses meaning), so the positive
 * threshold is higher. Avoidances are rarer and inherently more
 * informative, so the negative threshold is lower.
 *
 * Personas whose summed bias table is featureless (no tool ≥ +2 and no
 * tool ≤ -1) get a balanced-default clause so the `<action_profile>`
 * block is never empty.
 */
export function actionProfileFor(name: string, t1: string, t2: string): string {
	const biases = toolBiasSum(t1, t2);
	const star = `*${name}`;

	// Tools sorted by bias descending — used to pick stable, deterministic
	// preferred / avoided orderings (highest-magnitude first).
	const sorted = [...ACTION_TOOLS]
		.map((tool) => ({ tool, bias: biases[tool] }))
		.sort((a, b) => b.bias - a.bias);

	const preferred = sorted.filter((x) => x.bias >= 2).map((x) => x.tool);
	const avoided = sorted
		.filter((x) => x.bias <= -1)
		.sort((a, b) => a.bias - b.bias)
		.map((x) => x.tool);

	const fmt = (arr: ActionTool[]): string =>
		arr.map((t) => `\`${t}\``).join(", ");

	const parts: string[] = [];
	if (preferred.length > 0) {
		parts.push(
			`${star} leans toward ${fmt(preferred)} (~70% of action emissions). The remaining ~30% spreads across the other available action tools — don't fixate on a single tool. Variety beats repetition.`,
		);
	} else {
		parts.push(
			`${star} engages with the action surface in a balanced way — no single tool dominates their reflexes.`,
		);
	}
	if (avoided.length > 0) {
		parts.push(
			`${star} is hesitant about ${fmt(avoided)} — picks them less often than other actions, but still uses them when the moment clearly calls for it.`,
		);
	}
	return parts.join(" ");
}

/**
 * List the temperaments present in the bias table — convenience for tests
 * that want to walk the full set without re-importing the pool.
 */
export function knownTemperaments(): readonly string[] {
	return TEMPERAMENT_POOL;
}
