import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const script = path.join(root, "scripts/check-schema-map.mjs");

const SESSION_CONSTANT = "src/spa/persistence/version-constants.ts";
const SESSION_CODEC = "src/spa/persistence/session-codec.ts";
const GAME_SAVE_CONSTANT = "src/save-serializer.ts";
const ARCHIVE_MAP = "src/spa/persistence/archive-map.ts";

/**
 * Git environment variables that let an ambient repository leak into a
 * spawned `git` process. When this suite runs from a git hook (husky's
 * `pre-push` runs `pnpm run test`) — or from any shell where they are
 * exported — git sets `GIT_DIR` and friends. Those OUTRANK the `cwd` passed
 * to `spawnSync`, so `git -C <tempdir>` silently operates on the real
 * checkout instead: rewriting its branch pointer, emptying its index and
 * clobbering its `origin/main`. Reports of a worktree corrupting itself
 * after `pnpm run test` trace back to exactly this.
 *
 * Scrub them so `cwd` is the only thing deciding which repo a spawned git
 * command sees.
 */
const GIT_ENV_VARS = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_COMMON_DIR",
	"GIT_PREFIX",
	"GIT_CEILING_DIRECTORIES",
	"GIT_NAMESPACE",
] as const;

/** An environment with every inherited git pointer removed. */
function cleanGitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
	for (const key of GIT_ENV_VARS) delete env[key];
	return env;
}

function git(args: string[], cwd: string): { status: number; stdout: string } {
	const result = spawnSync("git", args, {
		cwd,
		env: cleanGitEnv(),
		encoding: "utf-8",
	});
	return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

/** One file a scenario writes at the baseline commit and again at HEAD. */
type FileChange = {
	path: string;
	/** null = the file does not exist in the baseline revision. */
	baseline: string | null;
	/** null = the file is deleted at HEAD. */
	head: string | null;
};

function writeSide(
	repo: string,
	change: FileChange,
	side: "baseline" | "head",
): void {
	const content = change[side];
	const target = path.join(repo, change.path);
	if (content === null) {
		rmSync(target, { force: true });
		return;
	}
	mkdirSync(path.dirname(target), { recursive: true });
	writeFileSync(target, content);
}

/**
 * Spin up a temp git repo with a fake `origin/main` branch and a current HEAD,
 * then invoke check-schema-map.mjs with GITHUB_BASE_REF=main so it compares
 * HEAD against origin/main.
 */
function runScriptWith(
	changes: FileChange[],
	{ withOriginMain = true }: { withOriginMain?: boolean } = {},
): {
	status: number;
	stderr: string;
} {
	const repo = mkdtempSync(path.join(tmpdir(), "schema-map-test-"));
	try {
		git(["init", "-q", "-b", "main"], repo);
		git(["config", "user.email", "t@example.com"], repo);
		git(["config", "user.name", "T"], repo);
		git(["config", "commit.gpgsign", "false"], repo);

		// Baseline commit on main
		for (const change of changes) writeSide(repo, change, "baseline");
		git(["add", "-A"], repo);
		git(["commit", "-q", "--no-gpg-sign", "-m", "baseline"], repo);

		// Mirror to a fake remote named "origin" pointing at this same repo's main
		if (withOriginMain) {
			git(["update-ref", "refs/remotes/origin/main", "HEAD"], repo);
		}

		// HEAD diverges from origin/main with the test diff
		git(["checkout", "-q", "-b", "feature"], repo);
		for (const change of changes) writeSide(repo, change, "head");
		git(["add", "-A"], repo);
		git(["commit", "-q", "--no-gpg-sign", "-m", "change"], repo);

		const result = spawnSync("node", [script], {
			cwd: repo,
			// The script shells out to `git diff`/`git show` against its own
			// cwd, so it is subject to the same ambient-`GIT_DIR` leak as the
			// helpers above. Scrub the env for it too.
			env: cleanGitEnv({ GITHUB_BASE_REF: "main" }),
			encoding: "utf-8",
		});
		return { status: result.status ?? 1, stderr: result.stderr ?? "" };
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
}

function sessionConstant(version: number): string {
	return `export const SESSION_SCHEMA_VERSION = ${version} as const;\n`;
}

function gameSaveConstant(version: number): string {
	return `export const GAME_SAVE_VERSION = ${version} as const;\n`;
}

/** Render the real archive-map module, with optional leading comment lines. */
function archiveMapFile({
	comment = "",
	session = {},
	gameSave = {},
}: {
	comment?: string;
	session?: Record<number, string>;
	gameSave?: Record<number, string>;
}): string {
	const render = (entries: Record<number, string>): string =>
		Object.entries(entries)
			.map(([version, build]) => `\t${version}: ${JSON.stringify(build)},`)
			.join("\n");
	return `${comment}export const SCHEMA_ARCHIVE_MAP: Record<number, string> = {\n${render(
		session,
	)}\n};\n\nexport const GAME_SAVE_ARCHIVE_MAP: Record<number, string> = {\n${render(
		gameSave,
	)}\n};\n`;
}

/** An archive map that predates the bump under test, as the real one would. */
const PRIOR_GS_MAP = { 3: "0.0.2-beta.1" };

describe("check-schema-map.mjs", () => {
	it("fails when SESSION_SCHEMA_VERSION bumps without a map entry or migration", () => {
		const result = runScriptWith([
			{
				path: SESSION_CODEC,
				baseline: sessionConstant(9),
				head: sessionConstant(10),
			},
		]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("SESSION_SCHEMA_VERSION changed");
	});

	it("passes when SESSION_SCHEMA_VERSION bumps alongside a SCHEMA_ARCHIVE_MAP change", () => {
		const result = runScriptWith([
			{
				path: SESSION_CODEC,
				baseline: `${sessionConstant(9)}export const SCHEMA_ARCHIVE_MAP = {};\n`,
				head: `${sessionConstant(10)}export const SCHEMA_ARCHIVE_MAP = { 9: "0.1.1" };\n`,
			},
		]);
		expect(result.status).toBe(0);
	});

	it("passes when SESSION_SCHEMA_VERSION bumps alongside a new migrateV<n>To function", () => {
		const result = runScriptWith([
			{
				path: SESSION_CODEC,
				baseline: sessionConstant(9),
				head: `${sessionConstant(10)}function migrateV9ToV10() {}\n`,
			},
		]);
		expect(result.status).toBe(0);
	});

	it("passes when SESSION_SCHEMA_VERSION is untouched", () => {
		const result = runScriptWith([
			{
				path: SESSION_CODEC,
				baseline: `${sessionConstant(9)}const other = 1;\n`,
				head: `${sessionConstant(9)}const other = 2;\n`,
			},
		]);
		expect(result.status).toBe(0);
	});

	// The regression this gate was fixed for: the old check treated any added
	// or removed line mentioning the map identifier as "the map changed", so a
	// bump whose only map-file edit was prose passed.
	it("fails when the only map edit accompanying a bump is a comment naming the map", () => {
		const result = runScriptWith([
			{
				path: SESSION_CONSTANT,
				baseline: sessionConstant(9),
				head: sessionConstant(10),
			},
			{
				path: ARCHIVE_MAP,
				baseline: archiveMapFile({
					session: {},
					gameSave: PRIOR_GS_MAP,
				}),
				head: archiveMapFile({
					comment:
						"// SCHEMA_ARCHIVE_MAP is documented in AGENTS.md; the bump only refreshed this prose.\n",
					session: {},
					gameSave: PRIOR_GS_MAP,
				}),
			},
		]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("SESSION_SCHEMA_VERSION changed (9 -> 10)");
		expect(result.stderr).toContain("superseded schema version 9");
		expect(result.stderr).toContain("SCHEMA_ARCHIVE_MAP has no entry for 9");
	});

	it("passes when the map gains a real entry for the superseded version", () => {
		const result = runScriptWith([
			{
				path: SESSION_CONSTANT,
				baseline: sessionConstant(9),
				head: sessionConstant(10),
			},
			{
				path: ARCHIVE_MAP,
				baseline: archiveMapFile({
					session: {},
					gameSave: PRIOR_GS_MAP,
				}),
				head: archiveMapFile({
					session: { 9: "0.0.2-beta.2" },
					gameSave: PRIOR_GS_MAP,
				}),
			},
		]);
		expect(result.status).toBe(0);
	});

	it("fails when the map only has an entry for some other schema version", () => {
		const result = runScriptWith([
			{
				path: SESSION_CONSTANT,
				baseline: sessionConstant(9),
				head: sessionConstant(10),
			},
			{
				path: ARCHIVE_MAP,
				baseline: archiveMapFile({
					session: { 8: "0.0.2-beta.1" },
					gameSave: PRIOR_GS_MAP,
				}),
				head: archiveMapFile({
					session: { 8: "0.0.2-beta.1" },
					gameSave: PRIOR_GS_MAP,
				}),
			},
		]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("SCHEMA_ARCHIVE_MAP has no entry for 9");
	});

	it("fails when the map lists the superseded version without naming a build", () => {
		const result = runScriptWith([
			{
				path: SESSION_CONSTANT,
				baseline: sessionConstant(9),
				head: sessionConstant(10),
			},
			{
				path: ARCHIVE_MAP,
				baseline: archiveMapFile({
					session: { 9: "0.0.2-beta.2" },
					gameSave: PRIOR_GS_MAP,
				}),
				head: archiveMapFile({
					session: { 9: "" },
					gameSave: PRIOR_GS_MAP,
				}),
			},
		]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("does not name an archived build");
	});

	it("fails when the new migration starts from a version other than the superseded one", () => {
		const result = runScriptWith([
			{
				path: SESSION_CONSTANT,
				baseline: sessionConstant(9),
				head: sessionConstant(10),
			},
			{
				path: SESSION_CODEC,
				baseline: "export function readSealed() {}\n",
				head: "export function readSealed() {}\nfunction migrateV8ToV9(sealed) { return sealed; }\n",
			},
		]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("superseded schema version 9");
	});

	it("passes when the superseded version is covered by a migration in another file", () => {
		const result = runScriptWith([
			{
				path: SESSION_CONSTANT,
				baseline: sessionConstant(9),
				head: sessionConstant(10),
			},
			{
				path: SESSION_CODEC,
				baseline: "export function readSealed() {}\n",
				head: "export function readSealed() {}\nfunction migrateV9ToV10(sealed) { return sealed; }\n",
			},
		]);
		expect(result.status).toBe(0);
	});

	it("fails when GAME_SAVE_VERSION bumps with a map comment as the only map edit", () => {
		const result = runScriptWith([
			{
				path: GAME_SAVE_CONSTANT,
				baseline: gameSaveConstant(4),
				head: gameSaveConstant(5),
			},
			{
				path: ARCHIVE_MAP,
				baseline: archiveMapFile({
					session: { 11: "0.0.2-beta.2" },
					gameSave: PRIOR_GS_MAP,
				}),
				head: archiveMapFile({
					comment: "// GAME_SAVE_ARCHIVE_MAP is defined below.\n",
					session: { 11: "0.0.2-beta.2" },
					gameSave: PRIOR_GS_MAP,
				}),
			},
		]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("GAME_SAVE_VERSION changed (4 -> 5)");
		expect(result.stderr).toContain("superseded game-save version 4");
		expect(result.stderr).toContain("GAME_SAVE_ARCHIVE_MAP has no entry for 4");
	});

	it("passes when GAME_SAVE_ARCHIVE_MAP gains a real entry for the superseded version", () => {
		const result = runScriptWith([
			{
				path: GAME_SAVE_CONSTANT,
				baseline: gameSaveConstant(4),
				head: gameSaveConstant(5),
			},
			{
				path: ARCHIVE_MAP,
				baseline: archiveMapFile({
					session: { 11: "0.0.2-beta.2" },
					gameSave: {},
				}),
				head: archiveMapFile({
					session: { 11: "0.0.2-beta.2" },
					gameSave: { 4: "0.0.2-beta.2" },
				}),
			},
		]);
		expect(result.status).toBe(0);
	});

	it("fails when a GAME_SAVE_VERSION bump adds only a migrate function (no fallback on that axis)", () => {
		const result = runScriptWith([
			{
				path: GAME_SAVE_CONSTANT,
				baseline: gameSaveConstant(4),
				head: gameSaveConstant(5),
			},
			{
				path: SESSION_CODEC,
				baseline: "export function readSealed() {}\n",
				head: "export function readSealed() {}\nfunction migrateV4ToV5(sealed) { return sealed; }\n",
			},
		]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("has no migrateV* fallback");
	});

	it("passes when both axes bump and both maps gain entries for the superseded versions", () => {
		const result = runScriptWith([
			{
				path: SESSION_CONSTANT,
				baseline: sessionConstant(9),
				head: sessionConstant(10),
			},
			{
				path: GAME_SAVE_CONSTANT,
				baseline: gameSaveConstant(4),
				head: gameSaveConstant(5),
			},
			{
				path: ARCHIVE_MAP,
				baseline: archiveMapFile({ session: {}, gameSave: {} }),
				head: archiveMapFile({
					session: { 9: "0.0.2-beta.2" },
					gameSave: { 4: "0.0.2-beta.2" },
				}),
			},
		]);
		expect(result.status).toBe(0);
	});

	it("passes when neither version constant changes", () => {
		const result = runScriptWith([
			{
				path: SESSION_CONSTANT,
				baseline: sessionConstant(9),
				head: sessionConstant(9),
			},
			{
				path: ARCHIVE_MAP,
				baseline: archiveMapFile({
					session: {},
					gameSave: PRIOR_GS_MAP,
				}),
				head: archiveMapFile({
					session: { 9: "0.0.2-beta.2" },
					gameSave: PRIOR_GS_MAP,
				}),
			},
		]);
		expect(result.status).toBe(0);
	});

	// The superseded version comes from the base revision's constant, not from
	// prose that happens to look like a bump.
	it("passes when a comment claims a bump but the constant keeps its number", () => {
		const result = runScriptWith([
			{
				path: SESSION_CONSTANT,
				baseline:
					"// SESSION_SCHEMA_VERSION is 9 today.\nexport const SESSION_SCHEMA_VERSION = 9 as const;\n",
				head: "// SESSION_SCHEMA_VERSION = 10 once the boundary moves.\nexport const SESSION_SCHEMA_VERSION = 9 as const;\n",
			},
		]);
		expect(result.status).toBe(0);
	});

	// Nothing to compare against must be a loud failure, never a silent pass.
	it("fails when the base revision cannot be resolved", () => {
		const result = runScriptWith(
			[
				{
					path: SESSION_CONSTANT,
					baseline: sessionConstant(9),
					head: sessionConstant(10),
				},
			],
			{ withOriginMain: false },
		);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"Cannot resolve the base revision origin/main",
		);
	});
});

/**
 * Regression coverage for the ambient-`GIT_DIR` leak.
 *
 * Before the fix, every `git` call in this suite inherited `GIT_DIR` from the
 * environment. `GIT_DIR` outranks the `cwd` given to `spawnSync`, so running
 * this suite under a git hook (husky's `pre-push` runs `pnpm run test`) made
 * the temp-repo scaffolding run against the *developer's real checkout*:
 * it moved the branch pointer onto junk `baseline`/`change` commits, emptied
 * the index, clobbered `origin/main`, and flipped `core.bare`. The tests still
 * reported green, so the damage was silent.
 */
describe("spawned-git isolation", () => {
	/**
	 * A throwaway repo plus a probe for which git directory a spawned command
	 * actually resolved.
	 *
	 * `--absolute-git-dir` is the discriminator here, NOT `--show-toplevel`.
	 * `GIT_DIR` redirects which git dir is opened, but `--show-toplevel` still
	 * answers from the cwd — so a leaked `GIT_DIR` is invisible to it. Measured
	 * directly: with `GIT_DIR` at repo A and cwd in repo B, `--show-toplevel`
	 * wrongly reports B while `--absolute-git-dir` correctly reports A. An
	 * earlier revision of this test asserted `--show-toplevel` and therefore
	 * passed against the unfixed code, pinning nothing.
	 */
	function makeProbe(): {
		repoGitDir: string;
		resolvedGitDir: () => string;
		cleanup: () => void;
	} {
		const repo = mkdtempSync(path.join(tmpdir(), "schema-map-gitdir-"));
		git(["init", "-q", "-b", "main"], repo);
		git(["config", "user.email", "t@example.com"], repo);
		git(["config", "user.name", "T"], repo);
		git(["commit", "-q", "--no-gpg-sign", "--allow-empty", "-m", "x"], repo);
		return {
			// `--absolute-git-dir` reports the git directory itself, so the
			// expected value carries the `/.git` suffix.
			repoGitDir: realpathSync(path.join(repo, ".git")),
			resolvedGitDir: () =>
				realpathSync(
					git(["rev-parse", "--absolute-git-dir"], repo).stdout.trim(),
				),
			cleanup: () => rmSync(repo, { recursive: true, force: true }),
		};
	}

	it("keeps caller-supplied variables while still scrubbing git pointers", () => {
		const env = cleanGitEnv({ GITHUB_BASE_REF: "main", GIT_DIR: "/nope" });
		expect(env.GITHUB_BASE_REF).toBe("main");
		expect(env.GIT_DIR).toBeUndefined();
	});

	it("resolves the given cwd's repo even when GIT_DIR points elsewhere", () => {
		const probe = makeProbe();
		const original = process.env.GIT_DIR;
		try {
			// Simulate what a git hook (or an exported GIT_DIR) provides. In a
			// linked worktree this is a file pointing at
			// `<main>/.git/worktrees/<name>`, which git resolves itself.
			process.env.GIT_DIR = path.join(root, ".git");
			expect(probe.resolvedGitDir()).toBe(probe.repoGitDir);
		} finally {
			if (original === undefined) {
				delete process.env.GIT_DIR;
			} else {
				process.env.GIT_DIR = original;
			}
			probe.cleanup();
		}
	});
});
