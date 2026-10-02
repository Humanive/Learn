# Ticket 5: learn rm and learn tag

## What to build

Two commands for managing resources in `resources.json`:

- `learn rm <source>` removes the resource entry. By default it leaves the output file/folder untouched (a `done` repo under `repos/` stays on disk). With `--purge`, it also deletes the output.
- `learn tag <source> +a -b` adds and removes tags. The resource must exist; non-existent tags are created, and removing a tag that isn't present is silent.

Both commands validate that `resources.json` is well-formed before editing, and reject changes that would leave it invalid.

## Acceptance criteria

- [ ] `learn rm <source>` removes the resource; `--purge` also deletes the output file/folder
- [ ] `learn tag <source> +new` adds a tag; `-old` removes one
- [ ] Commands fail cleanly if `resources.json` is invalid or the source isn't found
- [ ] Unit tests for tag add/remove logic and purge vs. keep; integration test: add resource, tag it, remove it with and without `--purge`

## Blocked by

#1 — needs `resources.json` structure.
