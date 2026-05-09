import { expect, test } from "@playwright/test";
import { goToGame } from "./helpers";

/**
 * Routine daemon turns disable reasoning by default — `BrowserLLMProvider`
 * passes `disableReasoning: true` to `streamCompletion`, which adds
 * `reasoning: { enabled: false }` to every `/v1/chat/completions` body the
 * SPA POSTs so GLM-4.7 skips its thinking step entirely.
 *
 * `?think=1` is a wrangler-dev-only affordance that opts thinking back on
 * for prompt-tuning.
 *
 * The unit tests in `src/spa/__tests__/llm-client.test.ts` and
 * `src/spa/game/__tests__/browser-llm-provider.test.ts` lock the body shape
 * directly. This e2e spec confirms the wiring all the way through:
 * URL → `isDevHost()` gate → `BrowserLLMProvider` → `streamCompletion` →
 * request body on the wire.
 */

test("default daemon turns add reasoning:{enabled:false} to chat-completions requests", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const observedBodies: unknown[] = [];

	// Capture each request body as it arrives, then fulfil with a deterministic
	// SSE response so the round actually completes.
	const { names } = await goToGame(page, {
		sse: (request) => {
			try {
				observedBodies.push(JSON.parse(request.postData() ?? "null"));
			} catch {
				observedBodies.push(null);
			}
			return ["greetings"];
		},
	});

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

test("?think=1 opts back into thinking — requests do NOT include the reasoning field", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const observedBodies: Record<string, unknown>[] = [];

	const { names } = await goToGame(page, {
		url: "/?think=1",
		sse: (request) => {
			try {
				const parsed = JSON.parse(request.postData() ?? "null");
				if (parsed && typeof parsed === "object") observedBodies.push(parsed);
			} catch {
				// ignore
			}
			return ["greetings"];
		},
	});

	await page.fill("#prompt", `*${names[1]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	await expect.poll(() => observedBodies.length).toBeGreaterThan(0);

	for (const body of observedBodies) {
		expect(body).not.toHaveProperty("reasoning");
	}

	expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
});
