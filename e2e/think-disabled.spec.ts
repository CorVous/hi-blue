import { expect, test } from "@playwright/test";
import { expectNoPageErrors, goToGame, parseRequestBody } from "./helpers";

test("default daemon turns add reasoning:{enabled:false} to chat-completions requests", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const observedBodies: unknown[] = [];

	const { names } = await goToGame(page, {
		sse: (request) => {
			observedBodies.push(parseRequestBody(request));
			return ["greetings"];
		},
	});

	await page.fill("#prompt", `*${names[1]} hello`);
	await expect(page.locator("#send")).toBeEnabled();
	await page.click("#send");

	await expect.poll(() => observedBodies.length).toBeGreaterThan(0);

	for (const body of observedBodies) {
		expect(body).toMatchObject({ reasoning: { enabled: false } });
	}

	await expectNoPageErrors(page, pageErrors);
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
			const parsed = parseRequestBody(request);
			if (parsed && typeof parsed === "object") observedBodies.push(parsed);
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

	await expectNoPageErrors(page, pageErrors);
});
