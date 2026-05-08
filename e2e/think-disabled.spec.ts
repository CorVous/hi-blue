import { expect, test } from "@playwright/test";
import { getAiHandles, stubChatCompletions } from "./helpers";

/**
 * `?think=0` is a wrangler-dev-only affordance that adds
 * `reasoning: { enabled: false }` to every `/v1/chat/completions` request body
 * the SPA POSTs, so the model skips its thinking step entirely.
 *
 * The unit tests in `src/spa/__tests__/llm-client.test.ts` lock the body shape
 * directly. This e2e spec confirms the wiring all the way through:
 * `?think=0` URL param → `isDevHost()` gate → `BrowserLLMProvider` →
 * `streamCompletion` → request body on the wire.
 */

test("?think=0 adds reasoning:{enabled:false} to chat-completions requests", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const observedBodies: unknown[] = [];

	// Capture each request body as it arrives, then fulfil with a deterministic
	// SSE response so the round actually completes.
	await stubChatCompletions(page, (request) => {
		try {
			observedBodies.push(JSON.parse(request.postData() ?? "null"));
		} catch {
			observedBodies.push(null);
		}
		return ["greetings"];
	});

	await page.goto("/?think=0");

	const { names } = await getAiHandles(page);

	await page.fill("#prompt", `*${names[1]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	// Wait for at least one chat-completions request to land.
	await expect.poll(() => observedBodies.length).toBeGreaterThan(0);

	// Every captured request body has reasoning: { enabled: false }.
	for (const body of observedBodies) {
		expect(body).toMatchObject({ reasoning: { enabled: false } });
	}

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});

test("without ?think=0, requests do NOT include the reasoning field", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const observedBodies: Record<string, unknown>[] = [];

	await stubChatCompletions(page, (request) => {
		try {
			const parsed = JSON.parse(request.postData() ?? "null");
			if (parsed && typeof parsed === "object") observedBodies.push(parsed);
		} catch {
			// ignore
		}
		return ["greetings"];
	});

	await page.goto("/");

	const { names } = await getAiHandles(page);

	await page.fill("#prompt", `*${names[1]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	await expect.poll(() => observedBodies.length).toBeGreaterThan(0);

	for (const body of observedBodies) {
		expect(body).not.toHaveProperty("reasoning");
	}

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
