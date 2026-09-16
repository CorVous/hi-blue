import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	// `exactOptionalPropertyTypes` forbids an explicit `undefined` here, and an
	// absent `workers` key means the same thing to Playwright: auto-detect.
	...(process.env.CI ? { workers: 1 } : {}),
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL: "http://localhost:8787",
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command:
			"pnpm build && pnpm exec wrangler dev --local --port 8787 --var OPENROUTER_API_KEY:test-key",
		url: "http://localhost:8787",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
