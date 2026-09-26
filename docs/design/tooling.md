# Tooling design notes

Why the scripts under `scripts/` behave the way they do. Read this next to the
code; anything the names already say is not repeated here.

## `check-schema-map.mjs`: the save-format bump gate

The CI gate behind AGENTS.md "Bumping save-format versions". It covers two
axes, listed in `SAVE_FORMAT_AXES`:

- **Session schema** (`SESSION_SCHEMA_VERSION`). A bump passes if
  `SCHEMA_ARCHIVE_MAP` has an entry for the superseded number, or if HEAD
  defines a `migrateV<old>To...` function that migrates those saves in place.
- **Game save** (`GAME_SAVE_VERSION`, the "gs" axis). Only a
  `GAME_SAVE_ARCHIVE_MAP` entry for the superseded number passes. This axis has
  no migrate fallback (`allowsMigrationFallback: false`).

A bump supersedes the version that was live before it. Saves sealed at that
version still need a route to a released build, so the gate asks about that
exact version and no other.

### It reads real file contents, not diff prose

The superseded version comes from the constant's value in the base revision.
The archive maps are parsed out of the object literals declared at HEAD. A
diff line that only mentions `SCHEMA_ARCHIVE_MAP` (a comment, a doc string, an
import) counts for nothing. An earlier version of the check treated any
added or removed line that named the map as "the map changed", so a bump whose
only map edit was prose got through. Two tests pin this down: "a comment naming
the map" and "a comment claims a bump but the constant keeps its number".

Some consequences:

- A change that leaves a constant's number alone (a re-export, a reformat, a
  doc edit next to it) supersedes nothing and passes.
- A map entry must name an archived build. `namesArchivedBuild` rejects empty,
  `null`, `undefined` and `""` values, and the failure message tells a blank
  entry apart from a missing one.
- A migration only counts if it starts from the superseded version: a
  `migrateV8ToV9` would not cover a 9 → 10 bump. (No migration functions
  exist today; see persistence.md, "Session schema history".)
- The object-literal reader skips string contents and `//` and `/* */`
  comments while it counts braces, so braces inside them do not end the map
  early.

### It fails loudly when the base revision is missing

`assertBaseRevisionResolvable` exits with status 1 when `origin/<base>` cannot
be resolved. Without the base there is nothing to compare against. Every
lookup would then find no constant and the check would quietly pass. Set
`GITHUB_BASE_REF` to compare against a branch other than `main`.

### `GIT_OUTPUT_MAX_BUFFER_BYTES`

Node's default `execFileSync` buffer is 1 MiB. A PR that touches large
committed artifacts, such as eval JSON dumps under `docs/evals/`, produces git
output bigger than that, and the script would crash with `ENOBUFS`. 256 MiB is
far more than any real diff needs.

### Tests must not touch the developer's real checkout

`scripts/__tests__/check-schema-map.test.ts` builds a throwaway repo in a temp
dir and runs git there. Git environment variables (`GIT_DIR`,
`GIT_WORK_TREE`, `GIT_INDEX_FILE` and the rest of `AMBIENT_GIT_POINTER_VARS`)
take priority over the `cwd` passed to `spawnSync`. Husky's `pre-push` hook
runs `pnpm run test` with those variables set. Before the fix, the scaffolding
ran against the real checkout instead of the temp repo: it moved the branch
pointer onto junk `baseline`/`change` commits, emptied the index, overwrote
`origin/main` and flipped `core.bare`. The tests still passed, so nothing
flagged the damage. `envWithoutAmbientGitPointers` removes those variables from
every spawned git command, and from the script under test, since the script
also runs git in its own cwd.

The isolation test checks `git rev-parse --absolute-git-dir`, not
`--show-toplevel`. A leaked `GIT_DIR` changes which git dir is opened, but
`--show-toplevel` still answers from the cwd, so it cannot see the leak. With
`GIT_DIR` pointing at repo A and the cwd in repo B, `--show-toplevel` reports B
while `--absolute-git-dir` correctly reports A. An earlier version of this test
used `--show-toplevel` and passed against the unfixed code. The expected value
ends in `/.git` because `--absolute-git-dir` reports the git directory itself.

## `check-no-comments.mjs`: the no-comments rule

The second half of `pnpm lint` (AGENTS.md "Code comments"). The code carries
no comments; the reasons live in these design docs, the ADRs and
`CONTEXT.md`, where they can be read as a whole and kept current in one place.

- **What it scans.** `src/`, `e2e/`, `evals/`, `scripts/` and the root config
  files listed in `ROOTS`, skipping `node_modules`, `dist` and `.wrangler`.
  Pass paths to check only those.
- **How it finds comments.** Script and JSON files go through the TypeScript
  parser (`ts.getLeadingCommentRanges` / `getTrailingCommentRanges` on every
  node), so `//` inside a string or a URL is never mistaken for a comment.
  Shell, CSS and HTML files use a pattern per language; a leading `#!` is kept.
- **Kept directives** (`KEPT_DIRECTIVES`): `biome-ignore`, `@ts-expect-error`,
  `@ts-ignore`, `/// <reference>`, `@vitest-environment`, `v8`/`c8` ignore
  hints and `@__PURE__`. These change what a tool does, so they are code, not
  commentary.
- **`--fix`** removes every reported comment, and the whole line when the
  comment was alone on it.

## `build-spa.mjs`

- **Content-hashed entry names** (`[name]-[hash]`). A new commit changes the
  asset URLs, so downstream caches are invalidated automatically. The Worker
  pairs this with long-lived `Cache-Control` headers on `/assets/*`, which
  makes the bundles immutable and cacheable.
- **`deleteStaleHashedAssets`** runs before every build. esbuild does not clean
  its `outdir`, so without it old hashes would pile up in `dist/assets/` across
  rebuilds.
- **`wireHashedAssetsIntoIndexHtmlPlugin`**: `src/spa/index.html` keeps the
  unhashed `./assets/index.{js,css}` paths so it stays a valid template. After
  each build (including watch rebuilds) the plugin looks up the hashed output
  names in the esbuild metafile and writes `dist/index.html` with them. The
  build is the only place hashes get wired in.
- **`__DEV__`** is true exactly when `WORKER_BASE_URL` is the default
  `http://localhost:8787` (`IS_DEV_BUILD`). Any other base URL, including the
  LAN URL that `pnpm dev:lan` bakes in, produces a non-dev build with no dev
  inspector, debug footers or BYOK localhost shortcut (ADR 0013).
- **Release constants.** `__RELEASE_VERSION__` is the version of a `v*` tag
  sitting exactly on HEAD, or null. It decides the "exactly on a release"
  branch of the banner suffix. `__LATEST_RELEASE_VERSION__` is the latest `v*`
  tag that is an ancestor of HEAD.
- **Version list.** A one-shot build then runs `generate-version-list.mjs`. A
  failure there is logged as a warning and does not fail the build.

## `generate-version-list.mjs`

Writes `dist/v/index.html`, a page listing every `v*` tag from highest to
lowest (`sort -V | tac`) with its commit date and a Beta badge for `-beta` tags.
Errors are logged and swallowed so the SPA build never fails because of this
page (ADR 0012 covers the versioned URLs it links to).

## `repeat-vitest.mjs` / `repeat-playwright.mjs`

Flake hunters: run the suite `iterations` times (the default is 20 for Vitest
and 10 for Playwright; a leading numeric argument overrides it, and every other
argument goes to the runner) and stop at the first failure. Ctrl-C reports the
current iteration and exits with 130, the shell convention for SIGINT.

## `dev-lan.mjs`

See AGENTS.md "Local development". It prefers a private-range IPv4 address
(10/8, 172.16/12, 192.168/16) over any other non-internal address, since that is
the one another device on the LAN can reach.
