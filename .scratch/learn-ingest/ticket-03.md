# Ticket 3: Local folder symlink adapter

## What to build

A `local` adapter that creates a symlink from `local/<title>` to the source path. When the user runs `learn add ~/my-notes/ -t reference`, the workspace gains a `local/my-notes` symlink pointing to the original folder. Changes to the original folder are visible in the workspace without copying.

The adapter validates that the source path exists and is readable before creating the symlink. If a symlink with that title already exists, append `-2`, `-3` as with other adapters.

## Acceptance criteria

- [ ] `packages/core/src/adapters/local.ts` — create symlink in `local/`, handle missing path / permission errors
- [ ] `packages/core/src/adapters/local.test.ts` — test success, missing path, duplicate title
- [ ] Integration test: `learn add <local-path>` creates a working symlink, original file changes are visible through the link

## Blocked by

#1 — needs `resources.json` to record the symlink result.
