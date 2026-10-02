# Ticket 2: Deterministic adapters: git, jina, markitdown

## What to build

Three deterministic adapters for v1: `git` (clone GitHub/GitLab repos), `jina` (webpage → Markdown via Jina Reader API), and `markitdown` (PDF → Markdown via local MarkItDown CLI).

Each adapter is one async function `(source, workspace, config) => AdapterResult`, returning `{ success: true, output }` or `{ success: false, reason }`. The ingest router tries the adapter chain for a resource type in order; the first success wins and is recorded in `resources.json`.

Config carries API keys (`JINA_API_KEY`), timeouts, and the `git` clone depth. Adapters write output files with sanitized titles; duplicate titles append `-2`, `-3` to avoid collisions.

## Acceptance criteria

- [ ] `packages/core/src/adapters/git.ts` — clone to `repos/<title>/`, use config depth, handle missing git/network errors
- [ ] `packages/core/src/adapters/jina.ts` — call Jina Reader, write `web/<title>.md`, handle missing key/network errors
- [ ] `packages/core/src/adapters/markitdown.ts` — call `markitdown` CLI, write `pdf/<title>.md`, handle missing CLI/file errors
- [ ] Unit tests for each adapter covering success, missing tool/key, and network failure paths
- [ ] Integration test: given a workspace, ingest one resource of each type and verify output file exists

## Blocked by

#1 — needs `resources.json` structure to record adapter results.
