export const ACTION_TOOLS = ["go", "pick_up", "put_down", "use"] as const;

export type ActionTool = (typeof ACTION_TOOLS)[number];

export const CRITICAL_PATH_TOOLS: ReadonlySet<ActionTool> = new Set([
	"go",
	"use",
]);

const CRITICAL_PATH_BIAS_FLOOR = -1;
export const PREFERRED_BIAS_THRESHOLD = 2;
export const AVOIDED_BIAS_THRESHOLD = -1;

export const ACTION_TOOL_BIAS: Record<string, Record<ActionTool, number>> = {
	"hot-headed": { go: 2, pick_up: 1, put_down: 0, use: 0 },
	taciturn: { go: -1, pick_up: 0, put_down: 0, use: -1 },
	meticulous: { go: -1, pick_up: 0, put_down: 1, use: 1 },
	erratic: { go: 2, pick_up: 1, put_down: 1, use: 0 },
	melancholic: { go: -2, pick_up: -1, put_down: -1, use: -1 },
	glib: { go: 1, pick_up: 0, put_down: 0, use: -1 },
	pedantic: { go: -1, pick_up: 0, put_down: 1, use: 1 },
	effusive: { go: 1, pick_up: 0, put_down: 0, use: 0 },
	sardonic: { go: 0, pick_up: 0, put_down: 0, use: -1 },
	mercurial: { go: 2, pick_up: 0, put_down: 1, use: 0 },
	diffident: { go: -2, pick_up: -1, put_down: 0, use: -1 },
	zealous: { go: 2, pick_up: 1, put_down: 0, use: 1 },
	verbose: { go: 0, pick_up: 0, put_down: 0, use: 0 },
	sweet: { go: 0, pick_up: 0, put_down: 1, use: 0 },
	anxious: { go: -1, pick_up: -1, put_down: 1, use: -1 },
	haughty: { go: 0, pick_up: -1, put_down: 0, use: -1 },
	sly: { go: 1, pick_up: 1, put_down: 0, use: 1 },
	theatrical: { go: 2, pick_up: 1, put_down: 0, use: -1 },
	aloof: { go: -1, pick_up: -2, put_down: 0, use: -1 },
	cheery: { go: 1, pick_up: 1, put_down: 0, use: 0 },
	mischievous: { go: 2, pick_up: 1, put_down: 1, use: 1 },
	stoic: { go: -1, pick_up: 0, put_down: 0, use: 0 },
	curious: { go: 1, pick_up: 1, put_down: -1, use: 1 },
	earnest: { go: 0, pick_up: 0, put_down: 0, use: 1 },
};

export function toolBiasSum(
	t1: string,
	t2: string,
): Record<ActionTool, number> {
	const result = {} as Record<ActionTool, number>;
	for (const tool of ACTION_TOOLS) {
		const bias1 = ACTION_TOOL_BIAS[t1]?.[tool] ?? 0;
		const bias2 = ACTION_TOOL_BIAS[t2]?.[tool] ?? 0;
		const sum = bias1 + bias2;
		result[tool] = CRITICAL_PATH_TOOLS.has(tool)
			? Math.max(sum, CRITICAL_PATH_BIAS_FLOOR)
			: sum;
	}
	return result;
}

export function actionProfileFor(name: string, t1: string, t2: string): string {
	const biases = toolBiasSum(t1, t2);
	const star = `*${name}`;

	const byBiasDescending = [...ACTION_TOOLS]
		.map((tool) => ({ tool, bias: biases[tool] }))
		.sort((a, b) => b.bias - a.bias);

	const preferred = byBiasDescending
		.filter((x) => x.bias >= PREFERRED_BIAS_THRESHOLD)
		.map((x) => x.tool);
	const avoided = byBiasDescending
		.filter(
			(x) =>
				x.bias <= AVOIDED_BIAS_THRESHOLD && !CRITICAL_PATH_TOOLS.has(x.tool),
		)
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
