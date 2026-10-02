# Ticket 4: learn ingest with concurrency and agent handoff

## What to build

`learn ingest` processes all pending resources, up to 3 concurrently. For each resource it tries the adapter chain for its type in config order. On success it writes the output and marks the resource `done` in `resources.json`, recording which adapter succeeded. On adapter-chain exhaustion (every deterministic adapter failed), it marks the resource `agent-required` and appends it to `.scratch/learn-ingest/agent-queue.json`.

At the end, if any resources need an agent, `learn ingest` prints the queue path and stops. The user can then run `learn ingest --agent <cli>` to hand off the queue to the chosen agent CLI (`claude`, `codex`, `pi`, etc.). The CLI invokes that agent once per resource with a 5-minute timeout, passing the source and expecting a path back. Success marks the resource `done`; timeout or failure leaves it `agent-required`.

Config defines the adapter chain per type (e.g. `pdf: [markitdown, firecrawl-anydoc]`) and agent timeout.

## Acceptance criteria

- [ ] `learn ingest` tries adapters in config order, records success/failure per resource
- [ ] Resources with exhausted chains go to `agent-queue.json` with status `agent-required`
- [ ] `learn ingest --agent <cli>` calls the agent once per queued resource, updates `resources.json` on success
- [ ] Concurrency limited to 3; agent timeout defaults to 5 minutes
- [ ] Unit tests for queue logic; integration test covering deterministic success, adapter failure → queue, and agent handoff success

## Blocked by

#2 — needs the three deterministic adapters.
