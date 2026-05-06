import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "browser",
					include: ["src/**/*.test.ts", "scripts/__tests__/**/*.test.ts"],
					exclude: ["src/proxy/**"],
					environment: "jsdom",
					// Match the wrangler-dev origin so SPA dev-affordance gates
					// (`location.origin === __WORKER_BASE_URL__`) hold under test.
					environmentOptions: {
						jsdom: { url: "http://localhost:8787/" },
					},
				},
			},
			{
				extends: true,
				plugins: [
					cloudflareTest({
						main: "./src/proxy/_smoke.ts",
						configPath: "./wrangler.jsonc",
						miniflare: {
							compatibilityDate: "2026-05-03",
							kvNamespaces: ["RATE_GUARD_KV"],
							bindings: {
								OPENROUTER_API_KEY: "test-openrouter-key",
								PER_IP_DAILY_TOKEN_MAX: "20000",
								GLOBAL_DAILY_TOKEN_MAX: "1000000",
								PRE_CHARGE_ESTIMATE: "4000",
								ALLOWED_ORIGINS: "https://app.example,http://localhost:5173",
							},
						},
					}),
				],
				test: {
					name: "workers",
					include: ["src/proxy/**/*.test.ts"],
				},
			},
		],
	},
});
