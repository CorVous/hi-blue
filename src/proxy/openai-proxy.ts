import { PINNED_MODEL } from "../model.js";
import { computeCostMicroUsd, getModelPricing } from "./pricing";
import {
	configFromEnv,
	preCharge,
	rateLimitResponse,
	reconcile,
	refundFull,
} from "./rate-guard";

export { PINNED_MODEL };

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function openAiError(
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
	// 1. Require the API key
	if (!env.OPENROUTER_API_KEY) {
		return openAiError(
			502,
			"upstream_error",
			"OpenRouter API key not configured",
		);
	}

	// 2. Parse JSON body
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return openAiError(
			400,
			"invalid_request_error",
			"Invalid JSON in request body",
		);
	}

	// 3. Validate messages array
	if (
		typeof body !== "object" ||
		body === null ||
		!Array.isArray(body.messages) ||
		body.messages.length < 1
	) {
		return openAiError(
			400,
			"invalid_request_error",
			"Request body must include a non-empty messages array",
		);
	}

	// 4. Cost-guard: pre-charge at request start
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const nowMs = Date.now();
	const cfg = configFromEnv(env);
	const guard = await preCharge(kv, ip, nowMs, cfg);
	if (!guard.allowed) {
		return rateLimitResponse(guard.reason, nowMs);
	}

	// Kick off the pricing lookup in parallel with the upstream call so the
	// reconciliation step doesn't add latency. `getModelPricing` is memoised
	// per isolate, so this is typically a no-op after the first request.
	const pricingPromise = getModelPricing(PINNED_MODEL, nowMs);

	// 5. Pin the model
	const isStream = body.stream === true;

	// Force stream_options.include_usage=true when streaming so OpenRouter
	// emits the usage chunk and we can reconcile from actual token counts.
	const modifiedBody: Record<string, unknown> = {
		...body,
		model: PINNED_MODEL,
	};
	if (isStream) {
		modifiedBody.stream_options = {
			...(typeof body.stream_options === "object" &&
			body.stream_options !== null
				? (body.stream_options as Record<string, unknown>)
				: {}),
			include_usage: true,
		};
	}

	// 6. Forward to OpenRouter
	let upstream: Response;
	try {
		upstream = await fetch(OPENROUTER_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(modifiedBody),
		});
	} catch (err) {
		await refundFull(kv, ip, nowMs, guard.preCharged);
		const message =
			err instanceof Error
				? err.message
				: "Network error forwarding to OpenRouter";
		return openAiError(502, "upstream_error", message);
	}

	// 7. Non-2xx from upstream → refund + 502
	if (!upstream.ok) {
		await refundFull(kv, ip, nowMs, guard.preCharged);
		return openAiError(
			502,
			"upstream_error",
			`OpenRouter returned ${upstream.status} ${upstream.statusText}`,
		);
	}

	// 8a. Non-streaming: read full body, reconcile from usage, return
	if (!isStream) {
		let responseText: string;
		try {
			responseText = await upstream.text();
		} catch {
			await refundFull(kv, ip, nowMs, guard.preCharged);
			return openAiError(
				502,
				"upstream_error",
				"Failed to read upstream response",
			);
		}

		const usage = extractUsage(responseText);

		if (usage !== null) {
			const pricing = await pricingPromise;
			const cost = computeCostMicroUsd(
				usage.promptTokens,
				usage.completionTokens,
				pricing,
			);
			await reconcile(kv, ip, nowMs, guard.preCharged, cost);
		} else {
			await refundFull(kv, ip, nowMs, guard.preCharged);
		}

		const contentType =
			upstream.headers.get("Content-Type") ?? "application/octet-stream";
		return new Response(responseText, {
			status: upstream.status,
			headers: { "Content-Type": contentType },
		});
	}

	// 8b. Streaming: tee the response, parse SSE for usage, reconcile on close
	const contentType =
		upstream.headers.get("Content-Type") ?? "application/octet-stream";

	let sseBuffer = "";
	let usage: { promptTokens: number; completionTokens: number } | null = null;

	const tryParseSseLine = (line: string): void => {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) return;
		const data = trimmed.slice(5).trim();
		if (data === "[DONE]") return;
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

			const finalUsage = usage;
			const kvWork =
				finalUsage !== null
					? pricingPromise.then((pricing) =>
							reconcile(
								kv,
								ip,
								nowMs,
								guard.preCharged,
								computeCostMicroUsd(
									finalUsage.promptTokens,
									finalUsage.completionTokens,
									pricing,
								),
							),
						)
					: refundFull(kv, ip, nowMs, guard.preCharged);
			ctx.waitUntil(kvWork);

			controller.terminate();
		},
	});

	if (upstream.body) {
		ctx.waitUntil(
			upstream.body.pipeTo(writable).catch(() => {
				return refundFull(kv, ip, nowMs, guard.preCharged);
			}),
		);
	} else {
		const writer = writable.getWriter();
		await writer.close();
	}

	return new Response(readable, {
		status: upstream.status,
		headers: { "Content-Type": contentType },
	});
}

/**
 * Extract `{prompt_tokens, completion_tokens}` from a non-streaming JSON
 * response. Returns null if the body is unparseable or either field is
 * missing — callers should treat null as "issue a full refund".
 */
function extractUsage(
	responseText: string,
): { promptTokens: number; completionTokens: number } | null {
	try {
		return parseUsageJson(responseText);
	} catch {
		return null;
	}
}

function parseUsageJson(
	text: string,
): { promptTokens: number; completionTokens: number } | null {
	let parsed: {
		usage?: { prompt_tokens?: number; completion_tokens?: number };
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
	return { promptTokens, completionTokens };
}
