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
						miniflare: {
							kvNamespaces: ["RATE_LIMIT_KV"],
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
