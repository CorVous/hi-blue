import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const script = path.join(root, "scripts/check-schema-map.mjs");

function git(args: string[], cwd: string): { status: number; stdout: string } {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
	return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

/**
 * Spin up a temp git repo with a fake `origin/main` branch and a current HEAD,
 * then invoke check-schema-map.mjs with GITHUB_BASE_REF=main so it compares
 * HEAD against origin/main.
 */
function runScriptWith({
	baselineFile,
	headFile,
	fileName,
}: {
	baselineFile: string;
	headFile: string;
	fileName: string;
}): { status: number; stderr: string } {
	const repo = mkdtempSync(path.join(tmpdir(), "schema-map-test-"));
	try {
		git(["init", "-q", "-b", "main"], repo);
		git(["config", "user.email", "t@example.com"], repo);
		git(["config", "user.name", "T"], repo);
		git(["config", "commit.gpgsign", "false"], repo);

		// Baseline commit on main
		writeFileSync(path.join(repo, fileName), baselineFile);
		git(["add", "."], repo);
		git(["commit", "-q", "--no-gpg-sign", "-m", "baseline"], repo);

		// Mirror to a fake remote named "origin" pointing at this same repo's main
		git(["update-ref", "refs/remotes/origin/main", "HEAD"], repo);

		// HEAD diverges from origin/main with the test diff
		git(["checkout", "-q", "-b", "feature"], repo);
		writeFileSync(path.join(repo, fileName), headFile);
		git(["add", "."], repo);
		git(["commit", "-q", "--no-gpg-sign", "-m", "change"], repo);

		const result = spawnSync("node", [script], {
			cwd: repo,
			env: { ...process.env, GITHUB_BASE_REF: "main" },
			encoding: "utf-8",
		});
		return { status: result.status ?? 1, stderr: result.stderr ?? "" };
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
}

describe("check-schema-map.mjs", () => {
	it("fails when SESSION_SCHEMA_VERSION bumps without a map entry or migration", () => {
		const result = runScriptWith({
			fileName: "session-codec.ts",
			baselineFile: "export const SESSION_SCHEMA_VERSION = 9;\n",
			headFile: "export const SESSION_SCHEMA_VERSION = 10;\n",
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("SESSION_SCHEMA_VERSION changed");
	});

	it("passes when SESSION_SCHEMA_VERSION bumps alongside a SCHEMA_ARCHIVE_MAP change", () => {
		const result = runScriptWith({
			fileName: "session-codec.ts",
			baselineFile:
				"export const SESSION_SCHEMA_VERSION = 9;\nexport const SCHEMA_ARCHIVE_MAP = {};\n",
			headFile:
				'export const SESSION_SCHEMA_VERSION = 10;\nexport const SCHEMA_ARCHIVE_MAP = { 9: "0.1.1" };\n',
		});
		expect(result.status).toBe(0);
	});

	it("passes when SESSION_SCHEMA_VERSION bumps alongside a new migrateV<n>To function", () => {
		const result = runScriptWith({
			fileName: "session-codec.ts",
			baselineFile: "export const SESSION_SCHEMA_VERSION = 9;\n",
			headFile:
				"export const SESSION_SCHEMA_VERSION = 10;\nfunction migrateV9ToV10() {}\n",
		});
		expect(result.status).toBe(0);
	});

	it("passes when SESSION_SCHEMA_VERSION is untouched", () => {
		const result = runScriptWith({
			fileName: "session-codec.ts",
			baselineFile:
				"export const SESSION_SCHEMA_VERSION = 9;\nconst other = 1;\n",
			headFile: "export const SESSION_SCHEMA_VERSION = 9;\nconst other = 2;\n",
		});
		expect(result.status).toBe(0);
	});
});
