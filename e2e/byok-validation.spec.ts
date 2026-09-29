import { expect, type Route, test } from "@playwright/test";
import { expectNoPageErrors, goToGame } from "./helpers";

const KEY_VALIDATION_TIMEOUT_MS = 15_000;

test("a stalled key validation says it is in progress, then times out and frees the button", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	const authKeyRoutes: Route[] = [];
	await page.route("https://openrouter.ai/api/v1/auth/key", (route) => {
		authKeyRoutes.push(route);
	});

	await page.clock.install();
	await goToGame(page);

	await page.click("#byok-cog");
	await expect(page.locator("#byok-dialog")).toBeVisible();

	await page.fill("#byok-key-input", "sk-or-v1-stalledkey");
	await page.click("#byok-validate-save");
	await expect(page.locator("#byok-status")).toHaveText("Validating…");
	await expect.poll(() => authKeyRoutes.length).toBe(1);

	await page.click("#byok-validate-save");
	await expect(page.locator("#byok-status")).toHaveText(
		"Validation in progress…",
	);
	expect(authKeyRoutes.length).toBe(1);

	await page.clock.runFor(KEY_VALIDATION_TIMEOUT_MS);
	await expect(page.locator("#byok-status")).toContainText(
		"Couldn't reach OpenRouter",
	);
	await expect(page.locator("#byok-save-unverified")).toBeVisible();

	await page.click("#byok-validate-save");
	await expect(page.locator("#byok-status")).toHaveText("Validating…");
	await expect.poll(() => authKeyRoutes.length).toBe(2);

	await expectNoPageErrors(page, pageErrors);
});

test("a validated key that the browser refuses to store says so instead of hanging on Validating…", async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await page.addInitScript(() => {
		const realSetItem = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key: string, value: string) {
			if (key === "openrouter_key") {
				throw new DOMException("quota exceeded", "QuotaExceededError");
			}
			realSetItem.call(this, key, value);
		};
	});
	await page.route("https://openrouter.ai/api/v1/auth/key", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: { "Access-Control-Allow-Origin": "*" },
			body: JSON.stringify({ data: {} }),
		}),
	);

	await goToGame(page);

	await page.click("#byok-cog");
	await expect(page.locator("#byok-dialog")).toBeVisible();
	await page.fill("#byok-key-input", "sk-or-v1-blockedkey");
	await page.click("#byok-validate-save");

	await expect(page.locator("#byok-status")).toContainText(
		"Couldn't store the key",
	);
	await expect(page.locator("#byok-dialog")).toBeVisible();
	expect(
		await page.evaluate(() => localStorage.getItem("openrouter_key")),
	).toBeNull();

	await expectNoPageErrors(page, pageErrors);
});
