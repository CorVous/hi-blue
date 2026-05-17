# Release channels and versioned URLs (handoff)

Design grilling for [#146](https://github.com/CorVous/hi-blue/issues/146). The conversation
expanded from "link old saves to an archived build" into the full versioning +
URL-routing system the link target requires.

Versioning primitives already landed on `main` via [#427](https://github.com/CorVous/hi-blue/pull/427)
— see `docs/agents/commits.md`, `scripts/build-spa.mjs`, `src/spa/bbs-chrome.ts`,
and the `pnpm release` script. Bootstrap tag `v0.0.0` is pushed.

The branch for the remaining work is `claude/add-archive-nightly-endpoints-HTLju`
(no commits yet — grilling only).

## URL surface (locked)

- `/` — latest stable release
- `/v/<version>/` — every released build, permanent (segment is `0.0.0`, not
  `v0.0.0`; the `v` lives in the namespace prefix)
- `/nightly/` — latest `main` build
- Reserved top-level paths: `/v/`, `/nightly/`. `/beta` channel is **out** —
  beta tags still get cut and built, they get `/v/X.Y.Z-beta.N/` only.

## Two-PR split (locked)

### PR 1 — versioned URLs at `/v/<version>/`

Goal: every tag is reachable at a permanent URL. **No UX change at `/`** —
`main` continues to overwrite root for now. This isolates the gh-pages /
peaceiris migration from the channel-rules change.

Concrete deliverables:

1. **Switch GitHub Pages source from `actions/deploy-pages` to a `gh-pages`
   branch.** Manual repo-settings flip after merge (Settings → Pages → Branch:
   `gh-pages` / `/`). Can't be scripted — call out in PR description.
2. **Rewrite `.github/workflows/deploy-pages.yml`** to use
   `peaceiris/actions-gh-pages@v4` with `destination_dir: ''`, `keep_files:
   true`. Writes `main` builds to gh-pages root.
3. **New `.github/workflows/release.yml`**:
   - Triggers: `push: tags: ['v*']` + `workflow_dispatch` with `tag` input.
   - **Tag regex** (fail loudly on mismatch):
     - `^v\d+\.\d+\.\d+$` (stable)
     - `^v\d+\.\d+\.\d+-beta\.\d+$` (beta)
   - **CI gate before deploy**: re-run lint / typecheck / test on the tagged
     commit (duplicate the steps from `ci.yml`; don't bother with
     `workflow_call` indirection).
   - Build with `__VERSION__` derived from `GITHUB_REF_NAME`.
   - Deploy via peaceiris to `destination_dir: v/${VERSION_WITHOUT_V_PREFIX}/`.
4. **Concurrency lock** on both workflows: `concurrency: { group:
   gh-pages-write, cancel-in-progress: false }`. Prevents a `main` push and a
   tag push from racing peaceiris's pull-push cycle.
5. `deploy-worker.yml` unchanged (Worker deploys are independent).

Post-merge ops sequence:
1. Merge PR 1
2. Wait for the rewritten `deploy-pages.yml` to populate `gh-pages` root
3. Flip Pages source to `gh-pages` branch in repo Settings
4. `workflow_dispatch` `release.yml` with `tag: v0.0.0` to populate `/v/0.0.0/`

### PR 2 — channel aliases + #146 banner

Goal: realise the channel layout and wire the version-mismatch banner.

Concrete deliverables:

1. **Move `main` from `/` to `/nightly/`** in `deploy-pages.yml` (change
   `destination_dir`).
2. **Add latest-stable mirroring** to `release.yml`: after writing
   `/v/<version>/`, if the just-pushed tag matches the stable regex *and* is
   the highest stable tag by semver across all tags in the repo, also write
   to `destination_dir: ''` (gh-pages root). Beta tags never touch root.
3. **`src/spa/persistence/archive-map.ts`** (new file):
   ```ts
   export const SCHEMA_ARCHIVE_MAP: Record<number, string> = {
     // 4: "0.1.1",  // schema 4 last shipped in v0.1.1
   };
   ```
   Hand-edited. Key = old `STORAGE_SCHEMA_VERSION`. Value = version string
   without `v` prefix. Empty at launch.
4. **Persistence change**: widen the `LoadResult` variant in
   `src/spa/persistence/session-codec.ts:151`:
   ```ts
   | { kind: "version-mismatch"; schemaVersion: number };
   ```
   Then propagate through `active-session-dispatcher.ts` to the render reason.
   Persistence stays URL-ignorant; UI does the map lookup.
5. **Banner rewrite** in `src/spa/routes/start.ts` (and `routes/game.ts` if it
   shares the surface — verify):
   - Map hit: "Your saved game is from an older version (schema N). Continue
     playing it at [v0.1.1 →](./v/0.1.1/), or start a new game below."
   - Map miss: existing "discarded" copy unchanged.
   - Use a real `<a href="./v/<version>/">` with relative URL so it works
     under any prefix. Full page nav is correct (loads the archived SPA fresh).
6. **`scripts/check-schema-map.mjs`** (~15-line diff check):
   ```js
   import { execSync } from "node:child_process";
   const base = process.env.GITHUB_BASE_REF ?? "main";
   const diff = execSync(`git diff origin/${base}...HEAD --unified=0`).toString();
   const schemaChanged = /^[+-].*STORAGE_SCHEMA_VERSION\s*=\s*\d+/m.test(diff);
   const mapChanged   = /^[+-].*SCHEMA_ARCHIVE_MAP/m.test(diff);
   if (schemaChanged && !mapChanged) { /* fail with instructions */ }
   ```
   Plus a step in `ci.yml` (`if: github.event_name == 'pull_request'`).
7. **Document the schema-bump flow** near `STORAGE_SCHEMA_VERSION` and in
   `AGENTS.md`: "When you change this, add an entry to `SCHEMA_ARCHIVE_MAP`
   mapping the OLD number to the latest released version
   (`git describe --tags --abbrev=0 --match 'v*'`)."

## Out of scope (decided in the conversation)

- Custom domain (`base-url.com` was placeholder for
  `corvous.github.io/hi-blue`).
- `/archive/` index page listing all releases. If wanted later, synthesize at
  `/archive/` from gh-pages tree.
- "You're viewing an archived version" banner inside `/v/<version>/` builds.
- Retroactive tagging of pre-`v0.0.0` history.
- Migrating save blobs across schema bumps (this is the *hosting* path, not
  the *migration* path — per #146).
- Worker URL stability across schema versions (acceptable risk for now; old
  archives break if `WORKER_BASE_URL` ever changes, which it hasn't).

## Still open — last unanswered question

User answered everything up through Q11. **Q12 was sent and not answered yet**
— three yes/no confirmations:

1. `LoadResult` carries `schemaVersion: number`; UI does the map lookup —
   correct?
2. Banner copy ("schema N. Continue at [link]. Or start a new game below.")
   and relative-URL link approach — close enough, or want different wording?
3. No "you're on an archived build" indicator inside `/v/<version>/` — correct?

Confirm Q12 before writing code.

## Anti-patterns to avoid

- **Don't** compose a single Pages artifact that re-builds every archived tag
  on every deploy. Rejected in conversation — gets slow, one bad old tag
  breaks every deploy.
- **Don't** put the schemaVersion → URL map in the persistence layer or have
  persistence return URLs. Layering boundary is real.
- **Don't** make `/` a redirect to `/v/<latest>/`. Confuses the URL bar /
  bookmarks. Duplicate the file tree.
- **Don't** force-push `v0.0.0` to trigger the workflow for the bootstrap. Use
  `workflow_dispatch` — that's what it's for.
- **Don't** add `alpha` / `rc` to the tag regex. Easy to add later, hard to
  retract.

## Suggested skills for the next session

- **None of the workflow skills are a strong fit yet.** The grilling is
  ~95% done — Q12 just needs three confirmations, then implementation begins.
- After Q12, **`tdd`** is appropriate for PR 2's persistence + banner work
  (red: write a test asserting the new banner renders with the link; green:
  wire the variant through; refactor).
- Skip **`to-issues`** / **`to-prd`** — this handoff doc plus issue #146
  itself cover the scope. Splitting PR 1 into a separate issue is optional;
  if the user wants tighter tracking, file a "PR 1: per-tag URL hosting" issue
  that links back here.
- Skip **`diagnose`** — no bug to debug.
- Skip **`improve-codebase-architecture`** — this is a feature, not a refactor.
