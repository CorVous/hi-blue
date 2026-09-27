import { PINNED_MODEL, PINNED_PROVIDER_ROUTING } from "../src/model.js";

export const EVAL_MODEL = process.env.EVAL_MODEL ?? PINNED_MODEL;

const REASONING_OFF = process.env.EVAL_REASONING === "off";

export function evalRequestOptions(): Record<string, unknown> {
	return {
		usage: { include: true },
		...(EVAL_MODEL === PINNED_MODEL
			? { provider: PINNED_PROVIDER_ROUTING }
			: {}),
		...(REASONING_OFF ? { reasoning: { enabled: false } } : {}),
	};
}
