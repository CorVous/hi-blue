import type { LLMProvider } from "./provider";

/**
 * MockLLMProvider returns canned tokens for use in tests.
 * Implements the same LLMProvider interface as the real provider.
 */
export class MockLLMProvider implements LLMProvider {
	private readonly tokens: string[];

	constructor(tokens: string[] = ["Hello", " ", "world", "!"]) {
		this.tokens = tokens;
	}

	async *streamCompletion(_prompt: string): AsyncIterable<string> {
		for (const token of this.tokens) {
			yield token;
		}
	}
}
