import { expect, test } from "@playwright/test";
import {
	collectPageErrors,
	expectNoPageErrors,
	goToGame,
	parseRequestBody,
} from "./helpers";

test("default daemon turns leave thinking on — requests do NOT include the reasoning field", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

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
		expect(body).not.toHaveProperty("reasoning");
	}

	await expectNoPageErrors(page, pageErrors);
});

test("?think=0 turns thinking off — requests add reasoning:{enabled:false}", async ({
	page,
}) => {
	const pageErrors = collectPageErrors(page);

	const observedBodies: Record<string, unknown>[] = [];

	const { names } = await goToGame(page, {
		url: "/?think=0",
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
		expect(body).toMatchObject({ reasoning: { enabled: false } });
	}

	await expectNoPageErrors(page, pageErrors);
});
