import { expect, test } from "@playwright/test";
import { goToGame, type ParsedBody, parseRequestBody } from "./helpers";

function blurbSentinelFor(personaId: string): string {
	return `Synthesized blurb sentinel for ${personaId}.`;
}

test("new-game synthesis blurbs land in turn-stream system prompts", async ({
	page,
}) => {
	const observedStreamingBodies: NonNullable<ParsedBody>[] = [];

	const { ids, names } = await goToGame(page, {
		synthesis: { blurb: blurbSentinelFor },
		sse: (request) => {
			const body = parseRequestBody(request);
			if (body?.stream === true) observedStreamingBodies.push(body);
			return ["ok"];
		},
	});

	for (const id of ids) {
		expect(id).toMatch(/^[a-z0-9]{4}$/);
	}

	await page.fill("#prompt", `*${names[0]} hi`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	await expect
		.poll(() => observedStreamingBodies.length, { timeout: 30_000 })
		.toBeGreaterThanOrEqual(3);

	for (const id of ids) {
		const sentinel = blurbSentinelFor(id);
		const matchingBody = observedStreamingBodies.find(
			(b) =>
				(b.messages?.[0]?.content ?? "").includes(sentinel) ||
				b.messages?.some(
					(m) => m.role === "system" && (m.content ?? "").includes(sentinel),
				),
		);
		expect(
			matchingBody,
			`expected SSE body whose system prompt embeds synthesized blurb for ${id} (sentinel: "${sentinel}"). Observed ${observedStreamingBodies.length} bodies.`,
		).toBeDefined();
	}
});
