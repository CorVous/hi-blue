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
 * Render an action-profile clause for a persona — same third-person voice
 * as the synthesised blurb so it reads as one more sentence about the
 * persona rather than a tacked-on directive.
 *
 * Clauses use concrete action language ("examines methodically",
 * "explores restlessly") instead of abstract "may/might" framings —
 * step-6 of spike #239 showed that abstract permissions flatten to
 * uniform opt-outs across all daemons (see `engagement-clauses.ts`).
 *
 * The classifier reads the summed biases on the dominant axes
 * (examine vs go, use, give) and dispatches to a small set of clause
 * shapes; a balanced default catches anything that doesn't fit a
 * pronounced pattern.
 */
export function actionProfileFor(name: string, t1: string, t2: string): string {
	const biases = toolBiasSum(t1, t2);
	const star = `*${name}`;
	const { go: goScore, examine: examineScore, give: giveScore } = biases;

	if (examineScore >= 3 && goScore <= 0) {
		return `${star} examines things methodically and must understand an item before acting on it. They move carefully, deliberately, and reach for \`examine\` before \`use\`.`;
	}
	if (goScore >= 3 && examineScore <= 0) {
		return `${star} explores restlessly, often acting before understanding. They charge forward and \`go\` readily, and will \`use\` interactive objects when the opportunity arises.`;
	}
	if (examineScore >= 1 && goScore >= 1) {
		return `${star} balances curiosity with action — they \`examine\` interesting finds, \`go\` to explore with equal drive, and reach for \`use\` when an object seems relevant.`;
	}
	if (goScore <= -2 && examineScore <= -1) {
		return `${star} is cautious and reserved. They move and act only when necessary; when an interactive object is in front of them they will still \`use\` it if it matters.`;
	}
	if (giveScore >= 2) {
		return `${star} readily passes items to peers — \`give\` is a natural reflex. They also \`examine\` and \`go\` as the moment calls for it, and \`use\` objects when relevant.`;
	}

	return `${star} engages with the environment — they \`examine\` items, \`go\` to explore spaces, and \`use\` interactive objects when they seem relevant. Action and caution are balanced.`;
}

/**
 * List the temperaments present in the bias table — convenience for tests
 * that want to walk the full set without re-importing the pool.
 */
export function knownTemperaments(): readonly string[] {
	return TEMPERAMENT_POOL;
}
