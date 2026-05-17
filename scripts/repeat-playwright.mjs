#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Parse argv: first numeric arg is iteration count (default 10), rest are passthrough
const args = process.argv.slice(2);
let N = 10;
let passthrough = args;

if (args.length > 0 && /^\d+$/.test(args[0])) {
	N = parseInt(args[0], 10);
	passthrough = args.slice(1);
}

let currentIteration = 0;

// Handle SIGINT (Ctrl-C)
process.on("SIGINT", () => {
	console.error(
		`[smoke:repeat] interrupted on iteration ${currentIteration}/${N}`,
	);
	process.exit(130);
});

// Run the loop
for (let i = 1; i <= N; i++) {
	currentIteration = i;
	console.log(
		`[smoke:repeat] iteration ${i}/${N} — running: playwright test ${passthrough.join(" ")}`,
	);

	const result = spawnSync(
		"pnpm",
		["exec", "playwright", "test", ...passthrough],
		{
			stdio: "inherit",
			cwd: repoRoot,
			shell: false,
		},
	);

	if (result.status !== 0) {
		console.error(`[smoke:repeat] FAILED on iteration ${i} of ${N}`);
		process.exit(result.status ?? 1);
	}

	if (result.signal) {
		console.error(
			`[smoke:repeat] FAILED on iteration ${i} of ${N} (signal: ${result.signal})`,
		);
		process.exit(1);
	}
}

console.log(`[smoke:repeat] PASSED ${N}/${N}`);
process.exit(0);
