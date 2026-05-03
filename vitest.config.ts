import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "browser",
					include: ["src/**/*.test.ts"],
					exclude: ["src/proxy/**"],
					environment: "jsdom",
				},
			},
			{
				extends: true,
				plugins: [
					cloudflareTest({
						main: "./src/proxy/_smoke.ts",
						configPath: "./wrangler.jsonc",
						miniflare: {
							kvNamespaces: ["RATE_GUARD_KV"],
							bindings: {
								ENABLE_TEST_MODES: "1",
								TOKEN_PACE_MS: "0",
								OPENROUTER_API_KEY: "test-openrouter-key",
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
