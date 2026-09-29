import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(__dirname, "../repeat.mjs");

function runRepeat(args: string[]) {
	return spawnSync("node", [script, ...args], {
		encoding: "utf-8",
		timeout: 10_000,
	});
}

describe("repeat.mjs", () => {
	it.each([
		"0",
		"-3",
	])("rejects a count of %s before running anything", (count) => {
		const result = runRepeat(["vitest", count]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("count must be at least 1");
		expect(result.stdout).not.toContain("iteration");
	});

	it("rejects an unknown runner", () => {
		const result = runRepeat(["jest", "3"]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("usage: repeat.mjs <vitest|playwright>");
	});
});
