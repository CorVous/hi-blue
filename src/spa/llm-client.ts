import { parseSSEStream } from "./streaming.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LOCALSTORAGE_KEY = "openrouter_key";

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

export async function streamChat(opts: {
	message: string;
	signal?: AbortSignal;
	onDelta: (text: string) => void;
}): Promise<void> {
	const { message, signal, onDelta } = opts;
	const { url, headers } = resolveLLMTarget();

	const messages = [
		{ role: "system", content: PERSONA_PLACEHOLDER },
		{ role: "user", content: message },
	];

	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify({ messages, stream: true }),
		...(signal != null ? { signal } : {}),
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	if (!response.body) {
		throw new Error("Response body is null");
	}

	await parseSSEStream(response.body, onDelta);
}
