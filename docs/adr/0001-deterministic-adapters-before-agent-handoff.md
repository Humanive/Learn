# Deterministic adapters first, external agent only on failure

`learn ingest` runs each resource through its adapter chain in plain code and only hands the resources that every adapter failed on to an external coding agent (claude, codex, pi, chosen by the user). The CLI never calls an LLM itself. Most resources (ordinary webpages, standard PDFs, GitHub repos) convert reliably with code, which is faster, free, repeatable and testable; an agent is slower, costs money and gives different results each run, so it is reserved for the leftovers code can't handle (login walls, scanned PDFs, odd layouts). Keeping the LLM outside the CLI also avoids locking `@learn/core` to one model or vendor.

## Considered Options

- **Agent ingests everything**: simplest to describe, but slow, costly, non-deterministic, and untestable for the common case.
- **LLM client built into the CLI**: tighter control, but ties core to a provider and duplicates what coding agents already do well.

## Consequences

- The agent must record its results through the same entry point as adapters (`learn ingest <source> --from <file>`), so provenance in `state.json` stays complete; files dropped into the workspace without that call don't count as ingested.
