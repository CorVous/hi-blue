import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "./llm-provider";

describe("MockLLMProvider", () => {
	it("yields tokens that reconstruct the original response", async () => {
		const provider = new MockLLMProvider("hello world");
		const tokens: string[] = [];

		for await (const token of provider.streamCompletion("any message")) {
			tokens.push(token);
		}

		expect(tokens.join("")).toBe("hello world");
	});

	it("yields multiple tokens for a multi-word response", async () => {
		const provider = new MockLLMProvider("foo bar baz");
		const tokens: string[] = [];

		for await (const token of provider.streamCompletion("prompt")) {
			tokens.push(token);
		}

		expect(tokens.length).toBeGreaterThan(1);
		expect(tokens.join("")).toBe("foo bar baz");
	});

	it("ignores the input message and always returns configured response", async () => {
		const provider = new MockLLMProvider("fixed response");
		const tokens1: string[] = [];
		const tokens2: string[] = [];

		for await (const token of provider.streamCompletion("message A")) {
			tokens1.push(token);
		}
		for await (const token of provider.streamCompletion("message B")) {
			tokens2.push(token);
		}

		expect(tokens1.join("")).toBe("fixed response");
		expect(tokens2.join("")).toBe("fixed response");
	});
});
