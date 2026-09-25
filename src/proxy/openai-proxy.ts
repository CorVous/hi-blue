import { PINNED_MODEL } from "../model.js";
import {
	computeCostMicroUsd,
	getModelPricing,
	type ModelPricing,
	USD_TO_MICRO_USD,
} from "./pricing";
import {
	configFromEnv,
	preCharge,
	rateLimitResponse,
	reconcile,
	refundFull,
} from "./rate-guard";

export { PINNED_MODEL };

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const UNPARSEABLE_BODY = Symbol("unparseable-body");
const SSE_DATA_PREFIX = "data:";
const SSE_STREAM_END_MARKER = "[DONE]";

function openAiError(
	status: number,
	type: "invalid_request_error" | "upstream_error",
	message: string,
): Response {
	return new Response(
		JSON.stringify({
			error: {
				message,
				type,
				code: null,
			},
		}),
		{
			status,
			headers: { "Content-Type": "application/json" },
		},
	);
}

export async function handleChatCompletions(
	request: Request,
	env: {
		OPENROUTER_API_KEY?: string;
		PER_IP_DAILY_MICRO_USD_MAX?: string;
		GLOBAL_DAILY_MICRO_USD_MAX?: string;
		PRE_CHARGE_MICRO_USD?: string;
	},
	kv: KVNamespace,
	ctx: ExecutionContext,
): Promise<Response> {
	if (!env.OPENROUTER_API_KEY) {
		return openAiError(
			502,
			"upstream_error",
			"OpenRouter API key not configured",
		);
	}

	const body = await readJsonBody(request);
	if (body === UNPARSEABLE_BODY) {
		return openAiError(
			400,
			"invalid_request_error",
			"Invalid JSON in request body",
		);
	}
	if (!hasNonEmptyMessages(body)) {
		return openAiError(
			400,
			"invalid_request_error",
			"Request body must include a non-empty messages array",
		);
	}

	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const nowMs = Date.now();
	const guard = await preCharge(kv, ip, nowMs, configFromEnv(env));
	if (!guard.allowed) {
		return rateLimitResponse(guard.reason, nowMs);
	}

	const pricingLookupInParallel = getModelPricing(PINNED_MODEL, nowMs);
	const refundPreCharge = (): Promise<void> =>
		refundFull(kv, ip, nowMs, guard.preCharged);
	const settleFromUsage = async (usage: ParsedUsage | null): Promise<void> => {
		if (usage === null) return refundPreCharge();
		const cost = await resolveCostMicroUsd(usage, pricingLookupInParallel);
		logPromptCacheHitRate(usage);
		await reconcile(kv, ip, nowMs, guard.preCharged, cost);
	};

	const isStream = body.stream === true;
	let upstream: Response;
	try {
		upstream = await forwardToOpenRouter(
			env.OPENROUTER_API_KEY,
			pinModelAndRequestUsage(body, isStream),
		);
	} catch (err) {
		await refundPreCharge();
		const message =
			err instanceof Error
				? err.message
				: "Network error forwarding to OpenRouter";
		return openAiError(502, "upstream_error", message);
	}

	if (!upstream.ok) {
		await refundPreCharge();
		return openAiError(
			502,
			"upstream_error",
			`OpenRouter returned ${upstream.status} ${upstream.statusText}`,
		);
	}

	if (!isStream) {
		return relayWholeResponse(upstream, settleFromUsage, refundPreCharge);
	}
	return relayStreamedResponse(upstream, settleFromUsage, refundPreCharge, ctx);
}

async function readJsonBody(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return UNPARSEABLE_BODY;
	}
}

function hasNonEmptyMessages(body: unknown): body is Record<string, unknown> {
	if (typeof body !== "object" || body === null) return false;
	const { messages } = body as { messages?: unknown };
	return Array.isArray(messages) && messages.length >= 1;
}

function pinModelAndRequestUsage(
	body: Record<string, unknown>,
	isStream: boolean,
): Record<string, unknown> {
	const upstreamBody: Record<string, unknown> = {
		...body,
		model: PINNED_MODEL,
	};
	if (isStream) {
		upstreamBody.stream_options = {
			...(typeof body.stream_options === "object" &&
			body.stream_options !== null
				? (body.stream_options as Record<string, unknown>)
				: {}),
			include_usage: true,
		};
	}
	return upstreamBody;
}

function forwardToOpenRouter(
	apiKey: string,
	upstreamBody: Record<string, unknown>,
): Promise<Response> {
	return fetch(OPENROUTER_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(upstreamBody),
	});
}

function upstreamContentType(upstream: Response): string {
	return upstream.headers.get("Content-Type") ?? "application/octet-stream";
}

async function relayWholeResponse(
	upstream: Response,
	settleFromUsage: (usage: ParsedUsage | null) => Promise<void>,
	refundPreCharge: () => Promise<void>,
): Promise<Response> {
	let responseText: string;
	try {
		responseText = await upstream.text();
	} catch {
		await refundPreCharge();
		return openAiError(
			502,
			"upstream_error",
			"Failed to read upstream response",
		);
	}

	await settleFromUsage(extractUsage(responseText));

	return new Response(responseText, {
		status: upstream.status,
		headers: { "Content-Type": upstreamContentType(upstream) },
	});
}

async function relayStreamedResponse(
	upstream: Response,
	settleFromUsage: (usage: ParsedUsage | null) => Promise<void>,
	refundPreCharge: () => Promise<void>,
	ctx: ExecutionContext,
): Promise<Response> {
	let sseBuffer = "";
	let usage: ParsedUsage | null = null;

	const tryParseSseLine = (line: string): void => {
		const trimmed = line.trim();
		if (!trimmed.startsWith(SSE_DATA_PREFIX)) return;
		const data = trimmed.slice(SSE_DATA_PREFIX.length).trim();
		if (data === SSE_STREAM_END_MARKER) return;
		const parsed = parseUsageJson(data);
		if (parsed !== null) usage = parsed;
	};

	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			controller.enqueue(chunk);

			sseBuffer += new TextDecoder().decode(chunk);
			const lines = sseBuffer.split("\n");
			sseBuffer = lines.pop() ?? "";
			for (const line of lines) tryParseSseLine(line);
		},
		flush(controller) {
			if (sseBuffer.trim().length > 0) tryParseSseLine(sseBuffer);
			ctx.waitUntil(settleFromUsage(usage));
			controller.terminate();
		},
	});

	if (upstream.body) {
		ctx.waitUntil(upstream.body.pipeTo(writable).catch(refundPreCharge));
	} else {
		const writer = writable.getWriter();
		await writer.close();
	}

	return new Response(readable, {
		status: upstream.status,
		headers: { "Content-Type": upstreamContentType(upstream) },
	});
}

interface ParsedUsage {
	promptTokens: number;
	completionTokens: number;
	cachedTokens?: number;
	costUsd?: number;
}

function extractUsage(responseText: string): ParsedUsage | null {
	try {
		return parseUsageJson(responseText);
	} catch {
		return null;
	}
}

function parseUsageJson(text: string): ParsedUsage | null {
	let parsed: {
		usage?: {
			prompt_tokens?: number;
			completion_tokens?: number;
			cost?: number;
			prompt_tokens_details?: { cached_tokens?: number };
			cache_read_input_tokens?: number;
		};
	};
	try {
		parsed = JSON.parse(text) as typeof parsed;
	} catch {
		return null;
	}
	const promptTokens = parsed.usage?.prompt_tokens;
	const completionTokens = parsed.usage?.completion_tokens;
	if (
		typeof promptTokens !== "number" ||
		typeof completionTokens !== "number"
	) {
		return null;
	}
	const cachedFromOpenAi = parsed.usage?.prompt_tokens_details?.cached_tokens;
	const cachedFromAnthropic = parsed.usage?.cache_read_input_tokens;
	const cachedTokens =
		typeof cachedFromOpenAi === "number"
			? cachedFromOpenAi
			: typeof cachedFromAnthropic === "number"
				? cachedFromAnthropic
				: undefined;
	const costUsd =
		typeof parsed.usage?.cost === "number" ? parsed.usage.cost : undefined;
	return {
		promptTokens,
		completionTokens,
		...(cachedTokens !== undefined ? { cachedTokens } : {}),
		...(costUsd !== undefined ? { costUsd } : {}),
	};
}

async function resolveCostMicroUsd(
	usage: ParsedUsage,
	pricingPromise: Promise<ModelPricing>,
): Promise<number> {
	if (usage.costUsd !== undefined) {
		return Math.ceil(usage.costUsd * USD_TO_MICRO_USD);
	}
	const pricing = await pricingPromise;
	return computeCostMicroUsd(
		usage.promptTokens,
		usage.completionTokens,
		pricing,
	);
}

function logPromptCacheHitRate(usage: ParsedUsage): void {
	if (usage.cachedTokens === undefined) return;
	const pct =
		usage.promptTokens > 0
			? Math.round((usage.cachedTokens / usage.promptTokens) * 100)
			: 0;
	console.log(
		`[cache] prompt ${usage.cachedTokens}/${usage.promptTokens} cached (${pct}%)`,
	);
}
