# ADR 0012 — Release channels and versioned URLs at `/v/<version>/`

**Status:** Accepted

Issue #146 asks that a save written against an older schema stay playable after the live SPA has moved on. The only honest way to honour that is to keep the older code around: every schema version of the SPA needs a permanent hosting URL so a banner on the live build can link the user back to the build that wrote their save. Today's Pages pipeline (`actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages`) is a single-artifact world — each `main` push replaces the whole site, and there's nowhere for a tagged release to land that a future deploy won't overwrite. This ADR records the URL surface, the move to a `gh-pages` branch as the deploy target, and the per-tag deploy mechanism that PR 1 lands.

## Decision

The deployed site has three URL spaces:

- `/` — latest stable release. PR 1 keeps this mirroring whatever `main` last built; PR 2 will flip it to mirror the highest stable `v*` tag.
- `/v/<version>/` — every released build, permanent. Segment is `0.0.0` (or `0.2.0-beta.1`), not `v0.0.0`.
- `/nightly/` — reserved path. Not populated in PR 1; PR 2 moves the `main` build here so `/` can become the stable mirror.

Beta tags ship at `/v/X.Y.Z-beta.N/` only — there is no `/beta/` channel.

Pages source switches from "GitHub Actions" to a `gh-pages` branch, managed by `peaceiris/actions-gh-pages@v4` with `keep_files: true`. `deploy-pages.yml` writes the `main` build into the branch root; a new `release.yml` triggered on `v*` tag push (and `workflow_dispatch` for backfill) writes the tagged build into `v/<version>/`. Both workflows share a `gh-pages-write` concurrency group with `cancel-in-progress: false`, so a tag push and a `main` push can't race peaceiris's pull-rebase-push cycle.

The tag regex is exact: stable `^v\d+\.\d+\.\d+$` or beta `^v\d+\.\d+\.\d+-beta\.\d+$`. Anything else fails the workflow loudly. No `alpha`, no `rc`. Both workflows check out with `fetch-depth: 0` so `build-spa.mjs`'s `git describe --tags --exact-match` and `--abbrev=0` queries return real answers — a side benefit is that the pre-existing main-build banner bug (`LATEST_RELEASE_VERSION` was null because the default shallow clone has no tags, so the banner fell back to `PKG_VERSION`) is fixed by the same change.

PR 1 is workflow plumbing only. The SPA continues to render `/` as it did before, with no awareness of `/v/<version>/`. PR 2 lands the `/nightly/` move, the highest-stable root-mirror, the `SCHEMA_ARCHIVE_MAP`, and the version-mismatch banner that links a stale save to its archived build.

## Considered Options

**Per-tag deploy via `gh-pages` branch with `keep_files: true` (chosen).** Each tagged release writes its own subdirectory and the deploy is one-tag-at-a-time. Old `/v/<version>/` subdirs survive every subsequent deploy untouched, which is the property #146 needs. The branch becomes the durable record of what's been released — recoverable, diffable, and inspectable without re-running CI.

**Composed Pages artifact rebuilding every archived tag on every deploy (rejected).** The "GitHub Actions" Pages source can only publish one artifact, so the natural alternative was a build job that checks out each tag, builds it, copies the output into `dist/v/<version>/`, and uploads the union as a single artifact. This was rejected because deploy wall-clock grows linearly with the tag count (each schema version is a full `pnpm install` + `pnpm run build`), and any one tag whose build breaks under a future toolchain bump takes the whole deploy down — including `/`. The per-tag model isolates a stale tag's failure to that tag.

**`/` as a redirect to `/v/<latest>/` (rejected).** A one-line `meta refresh` or JS redirect at `/` would let "latest" be a pointer instead of a copy. But the redirect would show in the address bar as a sub-path the user didn't type, and bookmarks of `/` would silently jump versions on the next release — a save's permanent home would no longer be a stable URL the user can recognise. The duplicate tree (`/` and `/v/<latest>/` serve byte-identical files) is the honest representation: bookmarks of `/` stay on `/`, archives stay at `/v/<version>/`, and the version-mismatch banner can point at the latter without the user ever seeing a redirect.

**A `/beta/` channel for the latest beta tag (rejected).** Symmetric with the stable `/` mirror, this would have a "latest beta" URL that auto-advances on each beta push. Rejected because a beta channel is the kind of thing you can't retract — once a beta is broken and at `/beta/`, the only fix is another beta push, and there's no equivalent of the per-tag rollback. Beta tags ship at `/v/X.Y.Z-beta.N/` only, where the URL is the permission slip: if you have it, you opted in.

**A built `/archive/` index page (deferred).** Listing every `/v/<version>/` at a discoverable URL is useful but not on the critical path for #146 (the banner is the discoverability surface that matters), and the index can be synthesised from the `gh-pages` branch contents at any later point without changing what the workflows write. Deferred rather than rejected.

**CI gate in `release.yml` (rejected).** A `workflow_call` to `ci.yml` before deploying a tag would re-run lint/typecheck/test/smoke on the tagged commit. Rejected because tagged commits come from `main`, which is already CI-green per branch protection — the gate is ~5min of redundancy guarding the rare off-`main` tag. If off-`main` tagging becomes a workflow we'll revisit; for now the trust boundary is "tags ride on `main` commits."

**`workflow_call` indirection between `ci.yml` and `release.yml` (rejected).** Once the CI gate was dropped, the `workflow_call` plumbing has nothing to do. The two workflows stay independent.

**Env-var override for `__VERSION__` (rejected).** The release workflow could have exported `VERSION=${TAG#v}` for `build-spa.mjs` to consume. Rejected because `build-spa.mjs` already derives `RELEASE_VERSION` from `git describe --tags --exact-match` when checked out at a tag, and `fetch-depth: 0` makes that work in CI. One code path, same behaviour locally and in CI.

## Consequences

- Releases before the `v0.0.0` bootstrap tag are not retroactively archived. The historical hi-blue builds are not addressable; the archive starts at `v0.0.0`.
- The Worker base URL is shared across schema versions. If `WORKER_BASE_URL` ever changes, every archived `/v/<version>/` build pointing at the old worker breaks. This hasn't happened and isn't planned; if it ever does, the migration is to rebuild archived tags against the new worker. Accepted as an unlikely-but-real risk for a hobbyist project.
- Migrating an old save's data into the live SPA's schema is out of scope. PR 1 ships the *hosting* path that #146 needs (the old code lives somewhere reachable). PR 2 ships the banner that points at that URL. A data-migration path remains future work.
- After PR 1 merges, the live site shows the last `actions/deploy-pages` artifact until repo Settings → Pages source is manually flipped to `gh-pages` / (root). During that window the site is frozen, not 404'd. Tolerated for a hobbyist project; the post-merge ops checklist on the PR description covers the manual flip.
- `concurrency.group: gh-pages-write` shared between `deploy-pages.yml` and `release.yml` means a `main` push during a tag deploy (or vice versa) queues rather than races. With `cancel-in-progress: false`, an in-flight release deploy is never killed by a `main` push — which matters because re-running a tag deploy is a manual `workflow_dispatch` whereas re-running a `main` deploy happens on the next push.
- `fetch-depth: 0` on both workflows fixes the pre-existing main-build banner bug (`LATEST_RELEASE_VERSION` was null on the deployed site, so the banner showed `v0.0.0 · 0xsha` instead of `v<latest-tag> · 0xsha`). This wasn't the motivating change, but it falls out for free.
