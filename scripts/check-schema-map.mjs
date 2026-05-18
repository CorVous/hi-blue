import { execSync } from "node:child_process";

const base = process.env.GITHUB_BASE_REF ?? "main";
const diff = execSync(`git diff origin/${base}...HEAD --unified=0`, {
	encoding: "utf8",
});

const schemaChanged = /^[+-].*SESSION_SCHEMA_VERSION\s*=\s*\d+/m.test(diff);
const mapChanged = /^[+-].*SCHEMA_ARCHIVE_MAP/m.test(diff);
const migrationAdded = /^\+.*function\s+migrateV\d+/m.test(diff);

if (schemaChanged && !mapChanged && !migrationAdded) {
	console.error(
		`SESSION_SCHEMA_VERSION changed without a SCHEMA_ARCHIVE_MAP entry
or a new migrateV<n>To... function. Choose one:

  (a) Add a SCHEMA_ARCHIVE_MAP entry mapping the OLD schema number
      to the latest released version that shipped it.
  (b) Add a migrateV<old>To... function in session-codec.ts so old
      saves transparently migrate to the new schema.

See AGENTS.md for the full schema-bump workflow.`,
	);
	process.exit(1);
}
