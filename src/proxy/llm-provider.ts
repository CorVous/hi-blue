/**
 * LLM Provider interface for the proxy.
 * The server is a thin LLM proxy — no game logic lives here.
 * The provider is constructor-injected so tests can swap in MockLLMProvider.
 */
export interface LLMProvider {
	/**
	 * Stream a completion for a given user message.
	 * Yields text tokens one at a time.
	 */
	streamCompletion(userMessage: string): AsyncIterable<string>;
}

/**
 * Mock LLM provider for tests.
 * Returns a deterministic stream of tokens from the configured response.
 */
export class MockLLMProvider implements LLMProvider {
	private readonly tokens: string[];

	constructor(response: string) {
		this.tokens = response
			.split(" ")
			.flatMap((word, i, arr) => (i < arr.length - 1 ? [word, " "] : [word]));
	}

	async *streamCompletion(_userMessage: string): AsyncIterable<string> {
		for (const token of this.tokens) {
			yield token;
		}
	}
}

/**
 * Anthropic Claude Haiku provider (real, via fetch).
 * Requires ANTHROPIC_API_KEY in env.
 * Never instantiated in tests — createProvider() throws before reaching this.
 */
export class AnthropicProvider implements LLMProvider {
	private readonly apiKey: string;
	private readonly model: string;

	constructor(apiKey: string, model = "claude-haiku-4-5") {
		this.apiKey = apiKey;
		this.model = model;
	}

	async *streamCompletion(userMessage: string): AsyncIterable<string> {
		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": this.apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: this.model,
				max_tokens: 1024,
				stream: true,
				messages: [{ role: "user", content: userMessage }],
			}),
		});

		if (!response.ok || !response.body) {
			throw new Error(
				`Anthropic API error: ${response.status} ${response.statusText}`,
			);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const data = line.slice(6).trim();
					if (data === "[DONE]") return;
					try {
						const parsed = JSON.parse(data) as {
							type: string;
							delta?: { type: string; text?: string };
						};
						if (
							parsed.type === "content_block_delta" &&
							parsed.delta?.type === "text_delta" &&
							parsed.delta.text
						) {
							yield parsed.delta.text;
						}
					} catch {
						// skip malformed lines
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}
}
