import { execFileSync } from "node:child_process";

/**
 * CI gate for save-format version bumps.
 *
 * A bump of `SESSION_SCHEMA_VERSION` or `GAME_SAVE_VERSION` supersedes the
 * version that was live before it. Saves sealed at the superseded version must
 * still be routable, so the bump has to come with archive handling for that
 * exact version:
 *
 *   - session schema: an `SCHEMA_ARCHIVE_MAP` entry for the superseded number,
 *     or a `migrateV<old>To...` function that migrates those saves in place.
 *   - game save ("gs"): a `GAME_SAVE_ARCHIVE_MAP` entry for the superseded
 *     number. There is no migrate fallback on this axis.
 *
 * This is decided from real contents, not from the diff's prose: the
 * superseded version is read out of the base revision, and the maps are
 * parsed out of the revision under test (HEAD). A diff line that merely
 * mentions `SCHEMA_ARCHIVE_MAP` — a comment, a doc string, an import —
 * satisfies nothing.
 *
 * See AGENTS.md → "Bumping save-format versions".
 */

const base = process.env.GITHUB_BASE_REF ?? "main";
const baseRef = `origin/${base}`;
const headRef = "HEAD";

// Default maxBuffer is 1 MiB; a PR that touches large committed artifacts
// (e.g. eval JSON dumps) produces output bigger than that and would crash
// execFileSync with ENOBUFS. 256 MiB is comfortably ample.
const MAX_BUFFER = 256 * 1024 * 1024;

const SOURCE_FILE = /\.(?:[cm]?[jt]s)$/;

/** The two save-format axes this gate covers. */
const AXES = [
	{
		constant: "SESSION_SCHEMA_VERSION",
		map: "SCHEMA_ARCHIVE_MAP",
		migration: true,
	},
	{
		constant: "GAME_SAVE_VERSION",
		map: "GAME_SAVE_ARCHIVE_MAP",
		migration: false,
	},
];

function git(args) {
	return execFileSync("git", args, {
		encoding: "utf8",
		maxBuffer: MAX_BUFFER,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/** Run git, returning null when the command fails (e.g. a path absent in a revision). */
function tryGit(args) {
	try {
		return git(args);
	} catch {
		return null;
	}
}

// Without the base revision there is nothing to compare against, and every
// lookup below would quietly find no constant and pass. Fail loudly instead.
if (
	tryGit(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]) === null
) {
	console.error(
		`Cannot resolve the base revision ${baseRef}.

  This check compares the working revision against the base branch, so the
  base has to be fetched first:

      git fetch origin ${base}

  Set GITHUB_BASE_REF to compare against a different base branch.`,
	);
	process.exit(1);
}

function revisionText(rev, path) {
	return tryGit(["show", `${rev}:${path}`]);
}

/** The numeric value of `const <name> = <n>` declared in this text, or null. */
function parseConstant(text, name) {
	if (typeof text !== "string") return null;
	const match = new RegExp(
		`(?:^|\\n)[ \\t]*(?:export\\s+)?const\\s+${name}\\b[^=\\n]*=\\s*(\\d+)`,
	).exec(text);
	return match ? Number(match[1]) : null;
}

/**
 * The version(s) a constant superseded in this change: values it declares in
 * the base revision that it no longer declares at HEAD. A change that leaves
 * the number alone (a re-export, a reformat, a doc edit next to it) is not a
 * bump and supersedes nothing.
 */
function supersededVersions(constant) {
	const paths = new Set([
		...sourceFilesContaining(baseRef, constant),
		...sourceFilesContaining(headRef, constant),
	]);
	const before = new Set();
	const after = new Set();
	for (const path of paths) {
		const oldValue = parseConstant(revisionText(baseRef, path), constant);
		if (oldValue !== null) before.add(oldValue);
		const newValue = parseConstant(revisionText(headRef, path), constant);
		if (newValue !== null) after.add(newValue);
	}
	return {
		superseded: [...before].filter((version) => !after.has(version)),
		current: [...after].sort((a, b) => a - b),
	};
}

/** Source files in `rev` whose text contains `needle`. */
function sourceFilesContaining(rev, needle) {
	const out = tryGit(["grep", "-l", "-I", "-e", needle, rev, "--"]);
	if (out === null) return [];
	return out
		.split("\n")
		.map((line) => line.slice(line.indexOf(":") + 1).trim())
		.filter((line) => line.length > 0 && SOURCE_FILE.test(line));
}

/** The body of the object literal that follows `openIndex` (a `{`), or null. */
function readObjectBody(text, openIndex) {
	let depth = 0;
	let quote = null;
	for (let i = openIndex; i < text.length; i++) {
		const char = text[i];
		if (quote !== null) {
			if (char === "\\") {
				i++;
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "/" && text[i + 1] === "/") {
			const end = text.indexOf("\n", i);
			i = end === -1 ? text.length : end;
			continue;
		}
		if (char === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end === -1 ? text.length : end + 1;
			continue;
		}
		if (char === "{") {
			depth++;
		} else if (char === "}") {
			depth--;
			if (depth === 0) return text.slice(openIndex + 1, i);
		}
	}
	return null;
}

/** Split an object body on top-level commas (ignoring nesting and strings). */
function splitTopLevel(body) {
	const parts = [];
	let depth = 0;
	let quote = null;
	let start = 0;
	for (let i = 0; i < body.length; i++) {
		const char = body[i];
		if (quote !== null) {
			if (char === "\\") i++;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "{" || char === "[" || char === "(") depth++;
		else if (char === "}" || char === "]" || char === ")") depth--;
		else if (char === "," && depth === 0) {
			parts.push(body.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(body.slice(start));
	return parts;
}

/** True when a map entry's value names an archived build. */
function isUsableValue(value) {
	const trimmed = value.trim();
	if (trimmed.length === 0) return false;
	if (trimmed === "undefined" || trimmed === "null") return false;
	if (/^["'`]["'`]$/.test(trimmed)) return false;
	return true;
}

/**
 * What the named archive map actually maps at HEAD, parsed out of every
 * source file that declares it: the versions it routes to an archived build,
 * and the versions it lists without naming one.
 */
function readArchiveMap(mapName) {
	const routed = new Set();
	const blank = new Set();
	const declaration = new RegExp(
		`(?:^|\\n)[ \\t]*(?:export\\s+)?(?:const\\s+)?${mapName}\\b\\s*(?::[^=\\n]*)?=\\s*\\{`,
		"g",
	);
	for (const path of sourceFilesContaining(headRef, mapName)) {
		const text = revisionText(headRef, path);
		if (typeof text !== "string") continue;
		declaration.lastIndex = 0;
		let match = declaration.exec(text);
		while (match !== null) {
			const body = readObjectBody(text, match.index + match[0].length - 1);
			if (body !== null) {
				for (const entry of splitTopLevel(body)) {
					const parsed = /^\s*["'`]?(\d+)["'`]?\s*:\s*([\s\S]*?)\s*$/.exec(
						entry,
					);
					if (parsed !== null) {
						const version = Number(parsed[1]);
						if (isUsableValue(parsed[2])) routed.add(version);
						else blank.add(version);
					}
				}
			}
			match = declaration.exec(text);
		}
	}
	return { routed, blank };
}

/** True when HEAD defines or calls a `migrateV<version>To...` function. */
function hasMigrationFrom(version) {
	const name = `migrateV${version}To`;
	const definition = new RegExp(
		`(?:function\\s+|(?:const|let|var)\\s+)?${name}[A-Za-z0-9_]*\\s*[(=]`,
	);
	for (const path of sourceFilesContaining(headRef, name)) {
		const text = revisionText(headRef, path);
		if (typeof text === "string" && definition.test(text)) return true;
	}
	return false;
}

function sessionFailure({ missing, current, map }) {
	const from = missing.join(", ");
	const to = current.length > 0 ? current.join(", ") : "a new value";
	const lacks = missing
		.map((version) =>
			map.blank.has(version)
				? `SCHEMA_ARCHIVE_MAP has an entry for ${version} that does not name an archived build`
				: `SCHEMA_ARCHIVE_MAP has no entry for ${version}`,
		)
		.join("\n  ");
	return `SESSION_SCHEMA_VERSION changed (${from} -> ${to}) without archive
handling for the superseded schema version ${from}.

  ${lacks}, and HEAD defines no migrateV${from}To... function. Saves sealed at
  schema ${from} would have no route to a released build. Choose one:

  (a) Add an SCHEMA_ARCHIVE_MAP entry in
      src/spa/persistence/archive-map.ts mapping ${from} to the latest
      released version that shipped it.
  (b) Add a migrateV${from}To... function in
      src/spa/persistence/session-codec.ts so old saves migrate in place.

See AGENTS.md for the full schema-bump workflow.`;
}

function gameSaveFailure({ missing, current, map }) {
	const from = missing.join(", ");
	const to = current.length > 0 ? current.join(", ") : "a new value";
	const lacks = missing
		.map((version) =>
			map.blank.has(version)
				? `GAME_SAVE_ARCHIVE_MAP has an entry for ${version} that does not name an archived build`
				: `GAME_SAVE_ARCHIVE_MAP has no entry for ${version}`,
		)
		.join("\n  ");
	return `GAME_SAVE_VERSION changed (${from} -> ${to}) without archive handling
for the superseded game-save version ${from}.

  ${lacks}. Add one in src/spa/persistence/archive-map.ts mapping ${from} to
  the latest released version that shipped it, so the version-mismatch can
  link the user to an archived build. This axis has no migrateV* fallback.`;
}

let failed = false;
for (const axis of AXES) {
	const { superseded, current } = supersededVersions(axis.constant);
	if (superseded.length === 0) continue;

	const map = readArchiveMap(axis.map);
	const missing = superseded.filter(
		(version) =>
			!map.routed.has(version) &&
			!(axis.migration && hasMigrationFrom(version)),
	);
	if (missing.length === 0) continue;

	failed = true;
	console.error(
		axis.migration
			? sessionFailure({ missing, current, map })
			: gameSaveFailure({ missing, current, map }),
	);
}

if (failed) process.exit(1);
