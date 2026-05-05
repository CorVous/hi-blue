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
}): Promise<void> {
	const { messages, signal, onDelta, onReasoning, tools, onToolCall } = opts;
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
