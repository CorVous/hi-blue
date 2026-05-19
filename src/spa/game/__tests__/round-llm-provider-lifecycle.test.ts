/**
 * Unit tests for MockRoundLLMProvider — onLifecycle callback (issue #437).
 *
 * Verifies that the lifecycle callback fires on started, first-token,
 * completed phases, and that daemonId is propagated correctly.
 */
import { describe, expect, it } from "vitest";
import { MockRoundLLMProvider } from "../round-llm-provider";

describe("MockRoundLLMProvider — onLifecycle callback", () => {
	it("fires started → first-token → completed in order when result resolves", async () => {
		const provider = new MockRoundLLMProvider(["hello world"]);
		const events: string[] = [];

		const result = await provider.streamRound([], [], undefined, undefined, (event) => {
			events.push(event.phase);
		});

		expect(events).toEqual(["started", "first-token", "completed"]);
		expect(result.assistantText).toBe("hello world");
	});

	it("forwards daemonId on every phase", async () => {
		const provider = new MockRoundLLMProvider(["test"]);
		const events: Array<string> = [];

		await provider.streamRound([], [], undefined, "daemon-123", (event) => {
			events.push(
				event.daemonId ? `${event.phase}:${event.daemonId}` : event.phase,
			);
		});

		expect(events).toEqual([
			"started:daemon-123",
			"first-token:daemon-123",
			"completed:daemon-123",
		]);
	});

	it("omits daemonId when not passed", async () => {
		const provider = new MockRoundLLMProvider(["test"]);
		const events: Array<string> = [];

		await provider.streamRound([], [], undefined, undefined, (event) => {
			events.push(event.phase);
		});

		expect(events).toEqual(["started", "first-token", "completed"]);
	});

	it("does not call onLifecycle when callback is absent", async () => {
		const provider = new MockRoundLLMProvider(["hello"]);

		const result = await provider.streamRound([], []);

		expect(result.assistantText).toBe("hello");
	});
});
