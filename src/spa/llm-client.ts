import { PINNED_MODEL } from "../model.js";
import type { OpenAiMessage } from "./game/round-llm-provider.js";
import type { OpenAiTool } from "./game/tool-registry.js";
import type { ToolCallResult } from "./streaming.js";
import { parseSSEStream } from "./streaming.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LOCALSTORAGE_KEY = "openrouter_key";

export class CapHitError extends Error {
	readonly status = 429 as const;
	readonly reason: "per-ip-daily" | "global-daily" | "unknown";
	readonly retryAfterSec: number | null;

	constructor(opts: {
		message: string;
		reason: "per-ip-daily" | "global-daily" | "unknown";
		retryAfterSec: number | null;
	}) {
		super(opts.message);
		this.name = "CapHitError";
		this.reason = opts.reason;
		this.retryAfterSec = opts.retryAfterSec;
	}
}

export async function parseCapHitFromResponse(
	response: Response,
): Promise<CapHitError | null> {
	if (response.status !== 429) return null;

	const retryAfterHeader = response.headers?.get("Retry-After");
	const retryAfterSec =
		retryAfterHeader != null ? Number(retryAfterHeader) : null;

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return new CapHitError({
			message: "rate limit exceeded",
			reason: "unknown",
			retryAfterSec,
		});
	}

	const err =
		body != null &&
		typeof body === "object" &&
		"error" in body &&
		body.error != null &&
		typeof body.error === "object"
			? (body.error as Record<string, unknown>)
			: null;

	if (!err || err.type !== "rate_limit_exceeded") {
		return new CapHitError({
			message: "rate limit exceeded",
			reason: "unknown",
			retryAfterSec,
		});
	}

	const code = err.code;
	const reason: "per-ip-daily" | "global-daily" | "unknown" =
		code === "per-ip-daily"
			? "per-ip-daily"
			: code === "global-daily"
				? "global-daily"
				: "unknown";

	const message =
		typeof err.message === "string" ? err.message : "rate limit exceeded";

	return new CapHitError({ message, reason, retryAfterSec });
}

export const PERSONA_PLACEHOLDER =
	"[placeholder persona — replaced by real persona content in #43]";

export function resolveLLMTarget(): {
	url: string;
	headers: Record<string, string>;
} {
	let key: string | null = null;
	try {
		key = localStorage.getItem(LOCALSTORAGE_KEY);
	} catch {
		// silently fall through — privacy mode or storage unavailable
	}

	// Treat empty string the same as null
	if (key) {
		return {
			url: OPENROUTER_URL,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${key}`,
			},
		};
	}

	return {
		url: `${__WORKER_BASE_URL__}/v1/chat/completions`,
		headers: { "Content-Type": "application/json" },
	};
}

// Re-export the message types from round-llm-provider (canonical definition)
// and OpenAiTool from tool-registry so callers can import from one place.
export type {
	OpenAiMessage,
	OpenAiToolCall,
} from "./game/round-llm-provider.js";
export type { OpenAiTool } from "./game/tool-registry.js";

export async function streamCompletion(opts: {
	messages: OpenAiMessage[];
	signal?: AbortSignal;
	onDelta: (text: string) => void;
	onReasoning?: (text: string) => void;
	tools?: OpenAiTool[];
	onToolCall?: (call: ToolCallResult) => void;
	disableReasoning?: boolean;
}): Promise<void> {
	const {
		messages,
		signal,
		onDelta,
		onReasoning,
		tools,
		onToolCall,
		disableReasoning,
	} = opts;
	const { url, headers } = resolveLLMTarget();

	const bodyObj: Record<string, unknown> = {
		model: PINNED_MODEL,
		messages,
		stream: true,
	};

	// Only include tools/tool_choice when tools are provided (do not send empty array)
	if (tools && tools.length > 0) {
		bodyObj.tools = tools;
		bodyObj.tool_choice = "auto";
	}

	// OpenRouter Reasoning Tokens API: { enabled: false } skips the model's
	// thinking step entirely (vs. { exclude: true } which still thinks but
	// hides the trace). Used by the ?think=0 dev affordance.
	if (disableReasoning) {
		bodyObj.reasoning = { enabled: false };
	}

	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(bodyObj),
		...(signal != null ? { signal } : {}),
	});

	if (!response.ok) {
		const capHit = await parseCapHitFromResponse(response);
		if (capHit) throw capHit;
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	if (!response.body) {
		throw new Error("Response body is null");
	}

	await parseSSEStream(response.body, onDelta, onReasoning, onToolCall);
}

export interface JsonCompletionResult {
	content: string | null;
	reasoning: string | null;
}

export async function chatCompletionJson(opts: {
	messages: OpenAiMessage[];
	disableReasoning?: boolean;
}): Promise<JsonCompletionResult> {
	const { messages, disableReasoning } = opts;
	const { url, headers } = resolveLLMTarget();

	const bodyObj: Record<string, unknown> = {
		model: PINNED_MODEL,
		messages,
		stream: false,
		response_format: { type: "json_object" },
	};

	if (disableReasoning) {
		bodyObj.reasoning = { enabled: false };
	}

	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(bodyObj),
	});

	if (!response.ok) {
		const capHit = await parseCapHitFromResponse(response);
		if (capHit) throw capHit;
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error("chatCompletionJson: failed to parse response JSON");
	}

	const msg =
		body != null &&
		typeof body === "object" &&
		"choices" in body &&
		Array.isArray((body as Record<string, unknown>).choices)
			? ((body as Record<string, unknown>).choices as unknown[])[0]
			: null;

	const message =
		msg != null &&
		typeof msg === "object" &&
		"message" in (msg as Record<string, unknown>)
			? ((msg as Record<string, unknown>).message as Record<string, unknown>)
			: null;

	const content =
		message != null && typeof message.content === "string"
			? message.content
			: null;

	const reasoning =
		message != null && typeof message.reasoning === "string"
			? message.reasoning
			: null;

	return { content, reasoning };
}

export async function streamChat(opts: {
	message: string;
	signal?: AbortSignal;
	onDelta: (text: string) => void;
	onReasoning?: (text: string) => void;
}): Promise<void> {
	return streamCompletion({
		messages: [
			{ role: "system", content: PERSONA_PLACEHOLDER },
			{ role: "user", content: opts.message },
		],
		...(opts.signal != null ? { signal: opts.signal } : {}),
		onDelta: opts.onDelta,
		...(opts.onReasoning != null ? { onReasoning: opts.onReasoning } : {}),
	});
}
