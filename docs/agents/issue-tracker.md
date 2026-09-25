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

Used by `/wayfinder` (`.agents/skills/wayfinder/SKILL.md`). Maps and their tickets are ordinary issues
carrying `wayfinder:*` labels; the tracker's own features carry the rest. `<db-id>` below is an issue's
numeric database id (`gh api repos/CorVous/hi-blue/issues/<n> --jq .id`), not its `#number` or `node_id`.

- **Map** — one issue per effort, labelled `wayfinder:map`. It holds the destination, the decisions
  index, the fog, and out-of-scope work, and it is an *index*: detail lives in its tickets.
- **Tickets** — child issues of the map, labelled `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, or `wayfinder:task`. Link each as a native GitHub sub-issue:

  ```sh
  gh api --method POST repos/CorVous/hi-blue/issues/<map>/sub_issues -F sub_issue_id=<child-db-id>
  ```

  Fallback, where sub-issues aren't available: a `Part of #<map>` line at the top of the child body
  (older maps such as #535 use only this line). Keep the body short; the answer goes in a resolution
  comment as the ticket closes.
- **Claim** — `gh issue edit <n> --add-assignee @me` *before* starting work. An open, unassigned
  ticket is unclaimed.
- **Blocking** — use GitHub's native issue dependencies, which is what renders the frontier in the
  tracker UI. Create the tickets first and wire the edges in a second pass: an issue needs an id
  before another can reference it.

  ```sh
  gh api --method POST repos/CorVous/hi-blue/issues/<blocked>/dependencies/blocked_by -F issue_id=<blocker-db-id>
  ```

  Only where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top
  of the child body. A ticket is unblocked when every blocker is closed.
- **Readiness labels** — `ready-for-agent` / `ready-for-human` (see
  [triage-labels.md](triage-labels.md)) mark a specified ticket as AFK or HITL. Blocked state comes
  from the native edges only; there is no `blocked` label.
- **Frontier** — the open, unblocked, unassigned children of a map; first in map order wins.
  `issue_dependencies_summary.blocked_by` counts open blockers only:

  ```sh
  gh api --paginate repos/CorVous/hi-blue/issues/<map>/sub_issues \
    --jq '.[] | select(.state == "open" and (.assignees | length) == 0
                       and .issue_dependencies_summary.blocked_by == 0)
              | "\(.number)\t\(.title)"'
  ```

  Add `and any(.labels[]; .name == "ready-for-agent")` to the `select` for AFK-takeable tickets only.
  For a map whose children use the `Part of #<map>` fallback, list them with
  `gh issue list --state open --search '"Part of #<map>" in:body' --json number,title,assignees` and
  apply the same assignee and blocker checks per issue.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
