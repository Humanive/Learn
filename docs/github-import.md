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
| `MULTICA_IMPORT_ENABLED` | Variable | Set to `true` to activate imports after review. Unset by default. |
| `MULTICA_SERVER_URL` | Variable | The Multica API URL, for example `https://api.multica.ai`. |
| `MULTICA_WORKSPACE_ID` | Variable | UUID of the workspace that receives the issues. |
| `MULTICA_IMPORT_SINCE` | Variable | RFC3339 timestamp. Only GitHub comments created at or after it are imported. Required, and never defaulted to the current time, so a rerun reconciles against the same boundary. |
| `MULTICA_PROJECT_ID` | Variable | Optional. Places imported issues in a project. |

The import step explicitly receives GitHub's built-in token with read-only
`contents` and `issues` permissions. No separate GitHub credential is needed.
For this task, the target workspace UUID is `eb954f1c-d10b-455b-a9eb-55762337e68e`.
The repository comes from the event. Copy the workflow, script, and test to
cogfree to reuse the importer there. Keep activation disabled until credentials
and the destination have been reviewed.

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
Multica issue. Source-ID lookup and writes are not atomic, so this is not a
strict exactly-once guarantee. A completed write with an unknown result is
recognized by its marker on a rerun. Concurrent imports outside this workflow
can still create duplicates. Existing duplicates require manual resolution.

Because a GitHub Actions concurrency group is not a FIFO queue, reconciliation
is what makes a replaced or cancelled run safe. The workflow queues runs per
source issue with `cancel-in-progress: false`, and each run imports every
comment it has not seen, so a dropped middle event still lands.

An issue with 2000 or more Multica root comments fails the run. GitHub reads
fail after 100 full pages rather than silently dropping later comments.
Recovery search fails when it reaches 100 results. These limits stop the import
before an incomplete read can cause duplicates. Resolve the limit before rerunning.
The triggering event comment is retained even if it predates `MULTICA_IMPORT_SINCE`
or was deleted from GitHub. Reconciliation only covers comments after that
activation boundary, not a historical bulk import.

## How imported text stays inert

External text is data, never code. Every Multica call is an argument vector
with no shell, and bodies are passed through `--description-file` and
`--content-file` inside the working directory rather than through an
interpolated command line.

On the way in the importer rewrites three things in the title, body and author:

- `mention://` becomes `mention+`, so a pasted agent or squad link cannot
  enqueue a run.
- `@` becomes U+FF20, so a GitHub handle does not ping.
- `github-source:` and `github-comment:` become `[github-source]:` and
  `[github-comment]:`, so a source body cannot forge a dedupe marker.

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
