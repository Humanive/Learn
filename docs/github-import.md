# GitHub to Multica import

A GitHub Actions workflow mirrors new GitHub issues and new issue comments into
this workspace's Multica issues. It is one way. Nothing is written back to
GitHub, and edits made in Multica are never overwritten.

## What it does

| GitHub event | Effect in Multica |
| --- | --- |
| Issue opened | Creates an unassigned `todo` issue carrying the title, body, source URL, author, and the immutable GitHub issue id. |
| Issue comment created | Adds a comment to the matching Multica issue. Comments on a pull request are skipped. |
| Anything else | Ignored. |

A comment that arrives before its issue has been imported creates the issue
first, from the payload the event already carries.

## Configuration

Set these in the repository under Settings, Secrets and variables, Actions.

| Name | Kind | Purpose |
| --- | --- | --- |
| `MULTICA_TOKEN` | Secret | A `mul_` user personal access token for the target Multica workspace. The CLI reads it from the environment, so no login, workspace discovery, or daemon runs in Actions. |
| `MULTICA_SERVER_URL` | Variable | The Multica server URL, for example `https://multica.ai`. |
| `MULTICA_WORKSPACE_ID` | Variable | UUID of the workspace that receives the issues. |
| `MULTICA_IMPORT_SINCE` | Variable | RFC3339 timestamp. Only GitHub comments created at or after it are imported. Required, and never defaulted to the current time, so a rerun reconciles against the same boundary. |
| `MULTICA_PROJECT_ID` | Variable | Optional. Places imported issues in a project. |

The workflow itself needs no GitHub token: `GITHUB_TOKEN` is supplied
automatically with read-only `contents` and `issues` permissions.

## How duplicates are avoided

Each imported issue carries the metadata key `github_issue_key` with the value
`Humanive/Learn#<number>`, plus `github_issue_id` with GitHub's immutable issue
id. A rerun looks that key up and stops.

The key is written after the issue is created, so a run that dies in between
leaves an issue without metadata. The issue body also carries a
`github-source:` marker line, and the next run finds that issue by search and
writes the missing metadata rather than creating a second copy. If two issues
ever claim the same source, the run fails instead of picking one.

Comments dedupe the same way. Each imported comment carries a
`github-comment:Humanive/Learn#<number>/<comment id>` marker, and the importer
compares GitHub's current comment list against the markers it finds on the
Multica issue. This is a check-then-write, not a transaction: a comment could
in principle be posted twice if a run dies between the comparison and the
write. Reconciliation makes that self-healing on the next event for that issue
rather than something the workflow tries to prevent.

Because a GitHub Actions concurrency group is not a FIFO queue, reconciliation
is what makes a replaced or cancelled run safe. The workflow queues runs per
source issue with `cancel-in-progress: false`, and each run imports every
comment it has not seen, so a dropped middle event still lands.

An issue with 2000 or more Multica comments fails the run. The server caps a
comment read at that many rows, so the oldest markers may be missing and
reconciling would repost history. Reconcile such an issue by hand.

## How imported text stays inert

External text is data, never code. Every Multica call is an argument vector
with no shell, and bodies are passed through `--description-file` and
`--content-file` inside the working directory rather than through an
interpolated command line.

On the way in the importer rewrites three things in the title, body and author:

- `mention://` becomes `mention+`, so a pasted agent or squad link cannot
  enqueue a run.
- `@` becomes U+FF20, so a GitHub handle does not ping.
- `github-source:` and `github-comment:` lose their colon, so a source body
  cannot forge a dedupe marker.

Imported bodies are wrapped in a plaintext code fence long enough to outlast
any fence in the source, so a `mermaid` diagram or an `html` block stays
inert text. Imported comments start with `/note`, Multica's own marker for a
comment that never triggers an agent, which keeps a GitHub comment harmless
even after someone assigns the imported issue.

## Local checks

```
node --test scripts/github-import.test.mjs
```

The tests run against a fake Multica CLI and a fake GitHub API, so they create
no real issues. The same command runs inside the workflow before each import.
