import { expect, test } from "@playwright/test";
import { getAiHandles, stubNewGameLLM } from "./helpers";

/**
 * Acceptance spec: new-game synthesis blurbs land in turn-stream system prompts.
 *
 * Proves that the synthesis output flows through the full chain:
 * LLM synthesis JSON call → persona record → prompt-builder → SSE request body.
 *
 * Strategy:
 * 1. Use `stubNewGameLLM` with a custom `synthesis.blurb` factory that embeds a
 *    sentinel string per persona id.
 * 2. Capture every SSE streaming request body.
 * 3. After sending a message, verify that each persona's sentinel appears in at
 *    least one streaming request's system prompt.
 */
test("new-game synthesis blurbs land in turn-stream system prompts", async ({
	page,
}) => {
	const observedBodies: Array<{
		messages?: Array<{ role?: string; content?: string }>;
		stream?: boolean;
	}> = [];

	await stubNewGameLLM(page, {
		synthesis: { blurb: (id) => `Synthesized blurb sentinel for ${id}.` },
		sse: (request) => {
			try {
				const body = JSON.parse(request.postData() ?? "null") as {
					stream?: boolean;
					messages?: Array<{ role?: string; content?: string }>;
				};
				if (body?.stream === true) observedBodies.push(body);
			} catch {
				// ignore
			}
			return ["ok"];
		},
	});

	await page.goto("/");

	// getAiHandles also reads persona display names from .panel-name
	const { ids, names } = await getAiHandles(page);

	// All ids must be 4-char procedural handles
	for (const id of ids) {
		expect(id).toMatch(/^[a-z0-9]{4}$/);
	}

	// Send a message addressed to the first AI using its display name
	await page.fill("#prompt", `*${names[0]} hi`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	// Wait for all 3 AIs to have their SSE streams observed
	await expect
		.poll(() => observedBodies.length, { timeout: 30_000 })
		.toBeGreaterThanOrEqual(3);

	// For each persona id, find a matching SSE body whose system message
	// contains the sentinel blurb for that persona
	for (const id of ids) {
		const sentinel = `Synthesized blurb sentinel for ${id}.`;
		const matchingBody = observedBodies.find(
			(b) =>
				(b.messages?.[0]?.content ?? "").includes(sentinel) ||
				b.messages?.some(
					(m) => m.role === "system" && (m.content ?? "").includes(sentinel),
				),
		);
		expect(
			matchingBody,
			`expected SSE body whose system prompt embeds synthesized blurb for ${id} (sentinel: "${sentinel}"). Observed ${observedBodies.length} bodies.`,
		).toBeDefined();
	}
});
