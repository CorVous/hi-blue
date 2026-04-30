export interface LLMProvider {
	/**
	 * Stream a chat completion. Yields text tokens one at a time.
	 */
	streamCompletion(prompt: string): AsyncIterable<string>;
}
