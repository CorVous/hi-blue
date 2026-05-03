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
	env: { OPENROUTER_API_KEY?: string },
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

	// 4. Pin the model
	const modifiedBody = { ...body, model: PINNED_MODEL };

	// 5. Forward to OpenRouter
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
		const message =
			err instanceof Error
				? err.message
				: "Network error forwarding to OpenRouter";
		return openAiError(502, "upstream_error", message);
	}

	// 6. Non-2xx from upstream → 502
	if (!upstream.ok) {
		return openAiError(
			502,
			"upstream_error",
			`OpenRouter returned ${upstream.status} ${upstream.statusText}`,
		);
	}

	// 7. Stream response back unchanged
	const contentType =
		upstream.headers.get("Content-Type") ?? "application/octet-stream";
	return new Response(upstream.body, {
		status: upstream.status,
		headers: { "Content-Type": contentType },
	});
}
