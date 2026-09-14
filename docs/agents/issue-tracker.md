# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Wayfinding operations

Wayfinder maps and their tickets are ordinary issues carrying `wayfinder:*` labels; the tracker's own
features carry the rest.

- **Map** — one issue per effort, labelled `wayfinder:map`. It holds the destination, the decisions
  index, the fog, and out-of-scope work, and it is an *index*: detail lives in its tickets.
- **Tickets** — labelled `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or
  `wayfinder:task`. Each names its map with a `Part of: #<map>` body line — GitHub's native
  sub-issue links are not used here — and keeps a short body; the answer goes in a resolution
  comment as the ticket closes.
- **Claim** — assign the issue to the dev driving it *before* starting work. An open, unassigned
  ticket is unclaimed.
- **Blocking** — use GitHub's native issue dependencies, which is what renders the frontier in the
  tracker UI:

  ```sh
  gh api graphql -f query='mutation($b:ID!,$k:ID!){addBlockedBy(input:{issueId:$b, blockingIssueId:$k}){issue{number} blockingIssue{number}}}' \
    -f b="$(gh issue view <blocked> --json id --jq .id)" \
    -f k="$(gh issue view <blocking> --json id --jq .id)"
  ```

  Keep the `Blocked by: #a, #b` body line as well, so the relationship survives a body copy. Create
  the tickets first and wire the edges in a second pass: an issue needs an id before another can
  reference it.
- **Readiness labels** — `ready-for-agent` (from the triage table above) marks a takeable ticket;
  `blocked` marks one waiting on an open blocker. Keep them in step with the native edges.
- **Frontier** — the open, unblocked, unassigned children of a map. Query by label, then confirm the
  edges, since a label can lag:

  ```sh
  gh issue list --repo CorVous/hi-blue --state open --label ready-for-agent \
    --json number,title,labels,assignees --jq '.[] | select(.assignees | length == 0) | "\(.number)\t\(.title)"'
  ```

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
