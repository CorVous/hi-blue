import { execFileSync } from "node:child_process";

const base = process.env.GITHUB_BASE_REF ?? "main";
const baseRef = `origin/${base}`;
const headRef = "HEAD";

const GIT_OUTPUT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

const SOURCE_FILE = /\.(?:[cm]?[jt]s)$/;

const SAVE_FORMAT_AXES = [
	{
		constant: "SESSION_SCHEMA_VERSION",
		map: "SCHEMA_ARCHIVE_MAP",
		allowsMigrationFallback: true,
	},
	{
		constant: "GAME_SAVE_VERSION",
		map: "GAME_SAVE_ARCHIVE_MAP",
		allowsMigrationFallback: false,
	},
];

function git(args) {
	return execFileSync("git", args, {
		encoding: "utf8",
		maxBuffer: GIT_OUTPUT_MAX_BUFFER_BYTES,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function gitOrNull(args) {
	try {
		return git(args);
	} catch {
		return null;
	}
}

function assertBaseRevisionResolvable() {
	const resolved = gitOrNull([
		"rev-parse",
		"--verify",
		"--quiet",
		`${baseRef}^{commit}`,
	]);
	if (resolved !== null) return;
	console.error(
		`Cannot resolve the base revision ${baseRef}.

  This check compares the working revision against the base branch, so the
  base has to be fetched first:

      git fetch origin ${base}

  Set GITHUB_BASE_REF to compare against a different base branch.`,
	);
	process.exit(1);
}

assertBaseRevisionResolvable();

function revisionText(rev, path) {
	return gitOrNull(["show", `${rev}:${path}`]);
}

function parseNumericConstant(text, name) {
	if (typeof text !== "string") return null;
	const match = new RegExp(
		`(?:^|\\n)[ \\t]*(?:export\\s+)?const\\s+${name}\\b[^=\\n]*=\\s*(\\d+)`,
	).exec(text);
	return match ? Number(match[1]) : null;
}

function supersededVersions(constant) {
	const paths = new Set([
		...sourceFilesContaining(baseRef, constant),
		...sourceFilesContaining(headRef, constant),
	]);
	const before = new Set();
	const after = new Set();
	for (const path of paths) {
		const oldValue = parseNumericConstant(
			revisionText(baseRef, path),
			constant,
		);
		if (oldValue !== null) before.add(oldValue);
		const newValue = parseNumericConstant(
			revisionText(headRef, path),
			constant,
		);
		if (newValue !== null) after.add(newValue);
	}
	return {
		superseded: [...before].filter((version) => !after.has(version)),
		current: [...after].sort((a, b) => a - b),
	};
}

function sourceFilesContaining(rev, needle) {
	const out = gitOrNull(["grep", "-l", "-I", "-e", needle, rev, "--"]);
	if (out === null) return [];
	return out
		.split("\n")
		.map((line) => line.slice(line.indexOf(":") + 1).trim())
		.filter((line) => line.length > 0 && SOURCE_FILE.test(line));
}

function readObjectLiteralBody(text, openBraceIndex) {
	let depth = 0;
	let quote = null;
	for (let i = openBraceIndex; i < text.length; i++) {
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
			if (depth === 0) return text.slice(openBraceIndex + 1, i);
		}
	}
	return null;
}

function splitOnTopLevelCommas(body) {
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

function namesArchivedBuild(value) {
	const trimmed = value.trim();
	if (trimmed.length === 0) return false;
	if (trimmed === "undefined" || trimmed === "null") return false;
	if (/^["'`]["'`]$/.test(trimmed)) return false;
	return true;
}

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
			const body = readObjectLiteralBody(
				text,
				match.index + match[0].length - 1,
			);
			if (body !== null) {
				for (const entry of splitOnTopLevelCommas(body)) {
					const parsed = /^\s*["'`]?(\d+)["'`]?\s*:\s*([\s\S]*?)\s*$/.exec(
						entry,
					);
					if (parsed !== null) {
						const version = Number(parsed[1]);
						if (namesArchivedBuild(parsed[2])) routed.add(version);
						else blank.add(version);
					}
				}
			}
			match = declaration.exec(text);
		}
	}
	return { routed, blank };
}

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
for (const axis of SAVE_FORMAT_AXES) {
	const { superseded, current } = supersededVersions(axis.constant);
	if (superseded.length === 0) continue;

	const map = readArchiveMap(axis.map);
	const missing = superseded.filter(
		(version) =>
			!map.routed.has(version) &&
			!(axis.allowsMigrationFallback && hasMigrationFrom(version)),
	);
	if (missing.length === 0) continue;

	failed = true;
	console.error(
		axis.allowsMigrationFallback
			? sessionFailure({ missing, current, map })
			: gameSaveFailure({ missing, current, map }),
	);
}

if (failed) process.exit(1);
