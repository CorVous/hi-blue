import {
	configFromEnv,
	preCharge,
	rateLimitResponse,
	reconcile,
	refundFull,
} from "./rate-guard";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const PINNED_MODEL = "z-ai/glm-4.7-flash";

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
		PER_IP_DAILY_TOKEN_MAX?: string;
		GLOBAL_DAILY_TOKEN_MAX?: string;
		PRE_CHARGE_ESTIMATE?: string;
	},
	kv: KVNamespace,
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

	// 4. Rate-guard: pre-charge at request start
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const nowMs = Date.now();
	const cfg = configFromEnv(env);
	const guard = await preCharge(kv, ip, nowMs, cfg);
	if (!guard.allowed) {
		return rateLimitResponse(guard.reason, nowMs);
	}

	// 5. Pin the model
	const isStream = body.stream === true;

	// Force stream_options.include_usage=true when streaming so OpenRouter
	// emits the usage chunk and we can reconcile from actual token count.
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
		// Network failure — full refund before returning error
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

		// Try to extract usage.total_tokens
		let actualTokens: number | undefined;
		try {
			const parsed = JSON.parse(responseText) as {
				usage?: { total_tokens?: number };
			};
			if (typeof parsed.usage?.total_tokens === "number") {
				actualTokens = parsed.usage.total_tokens;
			}
		} catch {
			// Not JSON — treat as missing usage
		}

		if (actualTokens !== undefined) {
			await reconcile(kv, ip, nowMs, guard.preCharged, actualTokens);
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

	// Side-channel accumulator for SSE text
	let sseBuffer = "";
	let totalTokens: number | undefined;

	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			// Pass bytes through unchanged
			controller.enqueue(chunk);

			// Accumulate text on the side for usage parsing
			sseBuffer += new TextDecoder().decode(chunk);

			// Parse complete SSE lines from buffer
			const lines = sseBuffer.split("\n");
			// Keep the last (possibly incomplete) line in buffer
			sseBuffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) continue;
				const data = trimmed.slice(5).trim();
				if (data === "[DONE]") continue;
				try {
					const parsed = JSON.parse(data) as {
						usage?: { total_tokens?: number };
					};
					if (typeof parsed.usage?.total_tokens === "number") {
						totalTokens = parsed.usage.total_tokens;
					}
				} catch {
					// Non-JSON SSE line — skip
				}
			}
		},
		async flush(controller) {
			// Process any remaining buffered text
			const remaining = sseBuffer.trim();
			if (remaining.startsWith("data:")) {
				const data = remaining.slice(5).trim();
				if (data !== "[DONE]") {
					try {
						const parsed = JSON.parse(data) as {
							usage?: { total_tokens?: number };
						};
						if (typeof parsed.usage?.total_tokens === "number") {
							totalTokens = parsed.usage.total_tokens;
						}
					} catch {
						// ignore
					}
				}
			}

			if (totalTokens !== undefined) {
				await reconcile(kv, ip, nowMs, guard.preCharged, totalTokens);
			} else {
				await refundFull(kv, ip, nowMs, guard.preCharged);
			}

			controller.terminate();
		},
	});

	// Pipe upstream body through transform; handle read errors with refund
	if (upstream.body) {
		upstream.body.pipeTo(writable).catch(async () => {
			await refundFull(kv, ip, nowMs, guard.preCharged);
		});
	} else {
		// No body — close the writable immediately so flush fires
		const writer = writable.getWriter();
		await writer.close();
	}

	return new Response(readable, {
		status: upstream.status,
		headers: { "Content-Type": contentType },
	});
}
