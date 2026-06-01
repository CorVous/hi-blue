/**
 * Per-temperament per-tool affinity biases for action-tool variation
 * (issue: daemon-action-variation).
 *
 * Background: daemons emit `message` calls frequently but rarely use the
 * non-message action surface, even when the same turn can carry both.
 * Counterpart to `engagement-clauses.ts`: where that module shapes
 * *whether* a daemon speaks, this one shapes *which actions* they take
 * when they do act.
 *
 * Tool surface: `go`, `face`, `pick_up`, `put_down`, `use` — the daemon
 * action set after #466–#472 (the `examine` tool was removed in favour
 * of auto-emitted examine flavor; `look` was renamed to `face`; `give`
 * was removed). `examine`'s old perception signal is folded into `face`
 * for the temperaments that leaned on it most.
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
 *   - The critical-path channels (`go`, `use`) have a baseline floor:
 *     the combined sum can never drop below -1, and they are never
 *     surfaced in a persona's "avoided" list. Objective completion
 *     requires daemons to move (`go` — spatial and convergence
 *     objectives) and to operate interactive objects (`use`), so no
 *     temperament draw — not even a doubled `melancholic` or a
 *     `melancholic`+`diffident` pair — can produce a daemon that is told
 *     to refuse movement or item-use. Flavor-only channels (`face`,
 *     `pick_up`, `put_down`) can still be flagged as avoided.
 */

export const ACTION_TOOLS = [
	"go",
	"face",
	"pick_up",
	"put_down",
	"use",
] as const;

export type ActionTool = (typeof ACTION_TOOLS)[number];

/**
 * Tools on the critical path to objective completion. They get a baseline
 * floor in `toolBiasSum` and are never listed as "avoided" in a rendered
 * action profile, so no temperament pairing can suppress a daemon's
 * ability to move or to use interactive objects.
 */
export const CRITICAL_PATH_TOOLS: ReadonlySet<ActionTool> = new Set([
	"go",
	"use",
]);

/**
 * Per-temperament per-tool affinity bias on a [-2, +2] scale.
 * Negative = less likely to use this tool; positive = more likely.
 *
 * `face` carries the old `look` value, bumped +1 for temperaments that
 * had a strong (`≥ +2`) `examine` lean and dropped -1 for the one with
 * a strong (`≤ -2`) `examine` aversion (glib) — so the perception
 * signal that used to route through `examine` survives the tool's
 * removal.
 */
export const ACTION_TOOL_BIAS: Record<string, Record<ActionTool, number>> = {
	"hot-headed": { go: 2, face: 1, pick_up: 1, put_down: 0, use: 0 },
	taciturn: { go: -1, face: 0, pick_up: 0, put_down: 0, use: -1 },
	meticulous: { go: -1, face: 2, pick_up: 0, put_down: 1, use: 1 },
	erratic: { go: 2, face: 0, pick_up: 1, put_down: 1, use: 0 },
	melancholic: { go: -2, face: 0, pick_up: -1, put_down: -1, use: -1 },
	glib: { go: 1, face: 0, pick_up: 0, put_down: 0, use: -1 },
	pedantic: { go: -1, face: 2, pick_up: 0, put_down: 1, use: 1 },
	effusive: { go: 1, face: 1, pick_up: 0, put_down: 0, use: 0 },
	sardonic: { go: 0, face: 1, pick_up: 0, put_down: 0, use: -1 },
	mercurial: { go: 2, face: 1, pick_up: 0, put_down: 1, use: 0 },
	diffident: { go: -2, face: -1, pick_up: -1, put_down: 0, use: -1 },
	zealous: { go: 2, face: 1, pick_up: 1, put_down: 0, use: 1 },
	// verbose is a pure messaging trait — it carries no action-tool lean.
	verbose: { go: 0, face: 0, pick_up: 0, put_down: 0, use: 0 },
	sweet: { go: 0, face: 1, pick_up: 0, put_down: 1, use: 0 },
	anxious: { go: -1, face: 0, pick_up: -1, put_down: 1, use: -1 },
	haughty: { go: 0, face: 1, pick_up: -1, put_down: 0, use: -1 },
	sly: { go: 1, face: 1, pick_up: 1, put_down: 0, use: 1 },
	theatrical: { go: 2, face: 2, pick_up: 1, put_down: 0, use: -1 },
	aloof: { go: -1, face: -1, pick_up: -2, put_down: 0, use: -1 },
	cheery: { go: 1, face: 1, pick_up: 1, put_down: 0, use: 0 },
	mischievous: { go: 2, face: 1, pick_up: 1, put_down: 1, use: 1 },
	stoic: { go: -1, face: 0, pick_up: 0, put_down: 0, use: 0 },
	curious: { go: 1, face: 2, pick_up: 1, put_down: -1, use: 1 },
	earnest: { go: 0, face: 1, pick_up: 0, put_down: 0, use: 1 },
};

/**
 * Sum two temperaments' biases per tool. Returns a record keyed by each tool
 * in `ACTION_TOOLS`. Unknown temperaments are treated as 0 contributors
 * (mirrors `engagement-clauses.biasSum`'s defensive handling).
 *
 * The critical-path channels (`go`, `use`) are floored at -1: every daemon
 * retains some likelihood of moving and of using interactive objects, since
 * both are required for objective completion. `go` previously had no floor,
 * so a doubled `melancholic` (go -4) or `melancholic`+`diffident` pair could
 * bottom out movement entirely — exactly the all-silent, no-spatial-progress
 * draw seen in playtest 0x8CBA.
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
		result[tool] = CRITICAL_PATH_TOOLS.has(tool) ? Math.max(sum, -1) : sum;
	}
	return result;
}

/**
 * Render an action-profile clause for a persona.
 *
 * v2.5: softens the directive so preferred tools come up frequently but
 * not exclusively (~70/30 split with other available actions), and
 * avoided tools still fire occasionally when the moment fits. v2's hard
 * "STRICTLY" produced 95-100% emissions on the leaned tool, suppressing
 * variety within a persona; the v2.5 wording aims for variety-with-bias
 * instead of mono-tool fixation.
 *
 * Thresholds:
 *   - preferred: per-tool bias sum ≥ +2 (a clear push from the temperament pair)
 *   - avoided:   per-tool bias sum ≤ -1 (a non-trivial pull-back)
 *
 * The threshold pair is asymmetric on purpose. Most temperament pairs
 * have a handful of mild positive biases (which we don't want to call
 * out — "leans toward 5 tools" loses meaning), so the positive
 * threshold is higher. Avoidances are rarer and inherently more
 * informative, so the negative threshold is lower.
 *
 * Critical-path tools (`go`, `use`) are excluded from the avoided list
 * even when their bias sum is negative: the eval data shows the model
 * reads an avoided-clause as a near-hard constraint, and telling a
 * daemon to avoid movement or item-use strands the spatial / convergence
 * objectives that depend on them.
 *
 * Personas whose summed bias table has no preferred and no (flavor-tool)
 * avoided entries get a balanced-default clause so the `<action_profile>`
 * block is never empty. The balanced clause and the avoided clause are
 * mutually exclusive — a persona is never told it is both "balanced" and
 * "hesitant about" a list of tools in the same breath.
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
		.filter((x) => x.bias <= -1 && !CRITICAL_PATH_TOOLS.has(x.tool))
		.sort((a, b) => a.bias - b.bias)
		.map((x) => x.tool);

	const fmt = (arr: ActionTool[]): string =>
		arr.map((t) => `\`${t}\``).join(", ");

	const parts: string[] = [];
	if (preferred.length > 0) {
		parts.push(
			`${star} leans toward ${fmt(preferred)} (~70% of action emissions). The remaining ~30% spreads across the other available action tools — don't fixate on a single tool. Variety beats repetition.`,
		);
	} else if (avoided.length === 0) {
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
