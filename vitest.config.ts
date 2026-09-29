import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const DOM_FREE_TESTS = [
	"src/__tests__/**/*.test.ts",
	"src/content/__tests__/**/*.test.ts",
	"src/spa/game/__tests__/**/*.test.ts",
	"src/spa/persistence/__tests__/**/*.test.ts",
	"scripts/__tests__/**/*.test.ts",
	"evals/__tests__/**/*.test.ts",
];

export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "logic",
					include: DOM_FREE_TESTS,
					environment: "node",
					environmentOptions: {
						jsdom: { url: "http://localhost:8787/" },
					},
					setupFiles: ["src/spa/test-setup.ts"],
				},
			},
			{
				extends: true,
				test: {
					name: "browser",
					include: ["src/**/*.test.ts"],
					exclude: [
						"src/proxy/**",
						"src/spa/__tests__/build.test.ts",
						...DOM_FREE_TESTS,
					],
					environment: "jsdom",
					environmentOptions: {
						jsdom: { url: "http://localhost:8787/" },
					},
					setupFiles: ["src/spa/test-setup.ts"],
				},
			},
			{
				extends: true,
				test: {
					name: "build",
					include: ["src/spa/__tests__/build.test.ts"],
					environment: "node",
				},
			},
			{
				extends: true,
				plugins: [
					cloudflareTest({
						main: "./src/proxy/worker.ts",
						configPath: "./wrangler.jsonc",
						miniflare: {
							compatibilityDate: "2026-05-03",
							kvNamespaces: ["RATE_GUARD_KV"],
							bindings: {
								OPENROUTER_API_KEY: "test-openrouter-key",
								PER_IP_DAILY_MICRO_USD_MAX: "20000",
								GLOBAL_DAILY_MICRO_USD_MAX: "1000000",
								PRE_CHARGE_MICRO_USD: "4000",
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
