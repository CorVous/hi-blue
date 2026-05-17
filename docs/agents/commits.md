# Commit messages: Conventional Commits

Versioning and changelog generation are driven by commit messages. We follow the [Conventional Commits 1.0.0 specification](https://www.conventionalcommits.org/en/v1.0.0/#specification). Every commit that lands on `main` should match the format below so `changelogen` can read it.

## Format

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

- **type** — see the type list below. Lowercase.
- **scope** — optional, in parentheses. A short noun naming the area touched (`prompt-builder`, `spa`, `proxy`, `evals`, `e2e`). Use existing scopes when possible.
- **!** — append `!` after type/scope to mark a breaking change (e.g. `feat(spa)!: …`). Equivalent to a `BREAKING CHANGE:` footer.
- **description** — imperative, lowercase, no trailing period. ≤72 chars.
- **body** — wrap at ~72 chars. Explain the *why*, not the *what*.
- **footer** — `BREAKING CHANGE: <reason>` and/or issue refs like `Closes #123`.

## Types we use

| Type | Meaning | Triggers release? |
| ---- | ------- | ----------------- |
| `feat` | A new user-visible feature | minor bump |
| `fix` | A bug fix | patch bump |
| `perf` | Performance improvement with no behaviour change | patch bump |
| `refactor` | Internal restructure, no behaviour change | no bump |
| `docs` | Docs only (README, ADRs, CONTEXT.md, agent guides) | no bump |
| `test` | Adding or fixing tests only | no bump |
| `chore` | Tooling, deps, config, repo housekeeping | no bump |
| `ci` | CI workflow changes only | no bump |
| `build` | Build pipeline changes only | no bump |
| `style` | Formatting only (Biome, whitespace) | no bump |
| `revert` | Reverts a prior commit (body names the SHA) | depends on reverted commit |

Any commit (regardless of type) with `!` or a `BREAKING CHANGE:` footer triggers a **major** bump.

While we are pre-1.0 (version `0.x.y`), breaking changes bump the **minor** segment, not the major — per semver's pre-1.0 rules. `feat` still bumps the minor; `fix` still bumps the patch.

## Examples

A feature:

```
feat(spa): add convergence-objective satisfaction flavor
```

A bug fix with an issue reference:

```
fix(proxy): drop KV writes on aborted requests

Closes #427
```

A breaking change announced via `!`:

```
feat(prompt-builder)!: drop legacy phase-goal field from system prompt

BREAKING CHANGE: Saves from before the single-game restructure can no
longer be resumed; archive on load and start a new Session.
```

A docs-only change (no release):

```
docs(adr): record decision to retire Wipe lie
```

A chore (no release):

```
chore(deps): bump wrangler to 4.86.0
```

## Squash-merge titles

We squash-merge PRs. The squash commit's **title** is what `changelogen` parses — not the individual commit messages inside the PR. So:

- The PR title must itself be a valid Conventional Commit.
- Inside the PR, commit messages can be looser (WIP notes, fixups, etc.). They're discarded by the squash.
- When merging, double-check the squash title before confirming the merge.

## Releasing

`changelogen` reads commits since the last `v*` tag and turns them into a `CHANGELOG.md` entry + version bump.

```sh
pnpm release           # bump version, write CHANGELOG.md, commit, tag
git push --follow-tags # push the commit and the new tag to origin
```

The first release in a fresh clone has no prior tag, so changelogen will scan from the first commit. To bound that on the initial run, use `--from <sha>` or tag the current `main` as `v0.0.0` before running.

For a dry-run preview without writing anything:

```sh
pnpm dlx changelogen
```

## What to do when you mistype a commit

- **Not yet pushed** — `git commit --amend` to fix the message.
- **Pushed but PR not merged** — force-push the branch (`git push --force-with-lease`) after amending or rebasing.
- **Already merged** — leave it. The next release's changelog will be slightly off; note it in the Release PR's body if it matters.

The squash-merge title is the source of truth, so a sloppy in-PR commit is fine as long as the PR title is correct when merged.
