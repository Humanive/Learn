---
name: learn-cli
description: Organize learning resources with the Learn CLI. Use when asked to create or inspect learning workspaces, save URLs or local paths, ingest resources, update tags, or remove saved resources.
compatibility: Requires the Learn CLI (learn) on PATH.
metadata:
  icon: "📚"
  title: Learn CLI
---

# Learn CLI

Learn keeps collected resources in local learning workspaces. Use the CLI to manage resource entries; read ingested content through its recorded output paths.

## Choose a workspace

Run `learn list --json` to discover workspace names. Use the workspace named by the user or established in the conversation; when the target is ambiguous, ask which one. Create a workspace with `learn new <name>` only when requested or needed for the user's chosen new topic.

Use explicit `-w <workspace>` for mutations. Only resource listing uses the `learn <workspace> ls` syntax.

If `learn` is unavailable, report that it needs installation or a supplied executable path. Use `learn <command> --help` to resolve option differences in the installed version.

## Common commands

Replace `vibe-coding` and the example resource with the user's values. Quote URLs and paths; use absolute paths for local resources.

```bash
# Discover workspaces; inspect one workspace's resources
learn list
learn vibe-coding ls
learn vibe-coding ls --verbose
learn vibe-coding ls --json

# Create a workspace; save a resource (starts as pending)
learn new vibe-coding
learn add "https://example.com/article" -w vibe-coding --title "Article title" -t "ai,reading"
learn add "/absolute/path/to/notes" -w vibe-coding

# Ingest pending resources into local content
learn ingest -w vibe-coding

# Update tags; remove a resource entry
learn tag -w vibe-coding "https://example.com/article" +reference -reading
learn rm "https://example.com/article" -w vibe-coding
```

Saving and ingestion are separate steps. When asked only to save or collect, stop after adding. When asked to ingest, run ingestion and check the resulting statuses.

`rm` keeps generated content by default; use `--purge` only when the user also wants that content deleted. Workspace names cannot be top-level commands such as `list`, `add`, `ingest`, or `help`.

## Filter and read resources

```bash
learn vibe-coding ls --status pending
learn vibe-coding ls --status failed
learn vibe-coding ls --type repos --tag ai
```

Filters read local data. Statuses: `pending`, `ingested`, `failed`. Types: `web`, `pdf`, `video`, `repos`, `local`. Tags match exactly, including case. Different filters use AND; repeated values for the same filter use OR. Lists preserve addition order.

`learn list --json` returns an array of workspace names. `learn <workspace> ls --json` returns `{ workspace, path, resources }`. Each resource carries `source`, `type`, `status`, `tags`, and optional `title`, `output`, `adapter`, and timestamps.

Resolve a relative `output` against the returned workspace `path`, not the current directory. `--verbose` shows absolute output paths. Follow those paths to read the ingested documents or repository directories.

## Ingestion failures and completion

Read the ingest summary and then `learn <workspace> ls --status failed`; an exit code of zero alone does not mean every resource succeeded. Ordinary ingestion handles pending entries and skips previously failed ones.

When external-agent recovery is wanted, use `learn ingest -w <workspace> --agent <name>` with `claude`, `codex`, or `pi`. It invokes that installed agent after adapter failures and includes previously failed resources; a configured default agent may also enable this behavior. The agent writes content, and Learn verifies it and updates resource entries.

Treat an already-existing resource as already saved. Resolve an unknown workspace with `learn list`. Report malformed resource data rather than overwriting it. Manage entries through the CLI instead of editing `resources.json` directly.

Finish with the workspace name, what was saved or ingested, any failed resources, and relevant local output paths. Use a scoped JSON list to verify the resulting entries when a mutation's outcome is uncertain.
