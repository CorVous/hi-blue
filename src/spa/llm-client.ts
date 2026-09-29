import { PINNED_MODEL, PINNED_PROVIDER_ROUTING } from "../model.js";
import type { OpenAiMessage } from "./game/round-llm-provider.js";
import type { OpenAiTool } from "./game/tool-registry.js";
import {
	CapHitError,
	HttpStatusError,
	UpstreamErrorBodyError,
} from "./llm-errors.js";
import { readStoredByokKey } from "./openrouter-key.js";
import type { ToolCallResult, UsageInfo } from "./streaming.js";
import { parseSSEStream } from "./streaming.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export {
	CapHitError,
	type CapHitReason,
	HttpStatusError,
	isRetryPointless,
	UpstreamErrorBodyError,
	upstreamMessageOf,
} from "./llm-errors.js";

async function readJsonOrNull(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function errorObjectOf(body: unknown): Record<string, unknown> | null {
	if (body == null || typeof body !== "object" || !("error" in body)) {
		return null;
	}
	const error = (body as Record<string, unknown>).error;
	return error != null && typeof error === "object"
		? (error as Record<string, unknown>)
		: null;
}

function retryAfterSecOf(response: Response): number | null {
	const header = response.headers?.get("Retry-After");
	if (header == null) return null;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return seconds;
	const dateMs = Date.parse(header);
	if (Number.isNaN(dateMs)) return null;
	return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
}

function capHitFromBody(response: Response, body: unknown): CapHitError | null {
	if (response.status !== 429) return null;
	const err = errorObjectOf(body);
	if (!err || err.type !== "rate_limit_exceeded") return null;
	if (err.code !== "per-ip-daily" && err.code !== "global-daily") return null;

	const retryAfterHeader = response.headers?.get("Retry-After");
	const retryAfterSec =
		retryAfterHeader != null ? Number(retryAfterHeader) : null;
	const message =
		typeof err.message === "string" ? err.message : "rate limit exceeded";

	return new CapHitError({ message, reason: err.code, retryAfterSec });
}

export async function parseCapHitFromResponse(
	response: Response,
): Promise<CapHitError | null> {
	if (response.status !== 429) return null;
	return capHitFromBody(response, await readJsonOrNull(response));
}

async function errorFromFailedResponse(
	response: Response,
): Promise<CapHitError | HttpStatusError> {
	const body = await readJsonOrNull(response);
	const capHit = capHitFromBody(response, body);
	if (capHit) return capHit;
	const upstreamMessage = errorObjectOf(body)?.message;
	return new HttpStatusError({
		status: response.status,
		statusText: response.statusText,
		upstreamMessage:
			typeof upstreamMessage === "string" && upstreamMessage.length > 0
				? upstreamMessage
				: null,
		retryAfterSec: retryAfterSecOf(response),
	});
}

export function resolveLLMTarget(): {
	url: string;
	headers: Record<string, string>;
} {
	const key = readStoredByokKey();
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

export type { OpenAiMessage } from "./game/round-llm-provider.js";
export type { OpenAiTool } from "./game/tool-registry.js";

export type { UsageInfo } from "./streaming.js";

function completionRequestBody(
	messages: OpenAiMessage[],
	disableReasoning: boolean | undefined,
): Record<string, unknown> {
	const bodyObj: Record<string, unknown> = {
		model: PINNED_MODEL,
		provider: PINNED_PROVIDER_ROUTING,
		messages,
		usage: { include: true },
	};
	if (disableReasoning) {
		bodyObj.reasoning = { enabled: false };
	}
	return bodyObj;
}

async function postCompletion(
	bodyObj: Record<string, unknown>,
	signal: AbortSignal | undefined,
): Promise<Response> {
	const { url, headers } = resolveLLMTarget();
	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(bodyObj),
		...(signal != null ? { signal } : {}),
	});
	if (!response.ok) throw await errorFromFailedResponse(response);
	return response;
}

export async function streamCompletion(opts: {
	messages: OpenAiMessage[];
	signal?: AbortSignal;
	onDelta: (text: string) => void;
	onReasoning?: (text: string) => void;
	tools?: OpenAiTool[];
	onToolCall?: (call: ToolCallResult) => void;
	onUsage?: (usage: UsageInfo) => void;
	disableReasoning?: boolean;
}): Promise<void> {
	const {
		messages,
		signal,
		onDelta,
		onReasoning,
		tools,
		onToolCall,
		onUsage,
		disableReasoning,
	} = opts;

	const bodyObj = completionRequestBody(messages, disableReasoning);
	bodyObj.stream = true;
	bodyObj.stream_options = { include_usage: true };

	if (tools && tools.length > 0) {
		bodyObj.tools = tools;
		bodyObj.tool_choice = "auto";
		bodyObj.parallel_tool_calls = true;
	}

	const response = await postCompletion(bodyObj, signal);

	if (!response.body) {
		throw new Error("Response body is null");
	}

	await parseSSEStream(
		response.body,
		onDelta,
		onReasoning,
		onToolCall,
		onUsage,
	);
}

export interface JsonCompletionResult {
	content: string | null;
	reasoning: string | null;
}

export async function chatCompletionJson(opts: {
	messages: OpenAiMessage[];
	disableReasoning?: boolean;
	signal?: AbortSignal;
}): Promise<JsonCompletionResult> {
	const { messages, disableReasoning, signal } = opts;

	const bodyObj = completionRequestBody(messages, disableReasoning);
	bodyObj.stream = false;
	bodyObj.response_format = { type: "json_object" };

	const response = await postCompletion(bodyObj, signal);

	let body: unknown;
	try {
		body = await response.json();
	} catch (err) {
		if (signal?.aborted) throw err;
		throw new Error("chatCompletionJson: failed to parse response JSON");
	}

	const errorObj = errorObjectOf(body);
	if (errorObj !== null) {
		const message =
			typeof errorObj.message === "string" ? errorObj.message : "unknown error";
		const code = typeof errorObj.code === "string" ? errorObj.code : undefined;
		throw new UpstreamErrorBodyError(
			code === undefined
				? { upstreamMessage: message }
				: { upstreamMessage: message, upstreamCode: code },
		);
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
