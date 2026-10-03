# Deterministic adapters first, external agent only on failure

`learn ingest` runs each resource through its adapter chain in plain code and only hands the resources that every adapter failed on to an external coding agent (claude, codex, pi, chosen by the user). The CLI never calls an LLM itself. Most resources (ordinary webpages, standard PDFs, GitHub repos) convert reliably with code, which is faster, free, repeatable and testable; an agent is slower, costs money and gives different results each run, so it is reserved for the leftovers code can't handle (login walls, scanned PDFs, odd layouts). Keeping the LLM outside the CLI also avoids locking `@learn/core` to one model or vendor.

## Considered Options

- **Agent ingests everything**: simplest to describe, but slow, costly, non-deterministic, and untestable for the common case.
- **LLM client built into the CLI**: tighter control, but ties core to a provider and duplicates what coding agents already do well.

## Consequences

- The CLI writes `.learn/failed-resources.md` with unique expected output paths and invokes the chosen agent once for the failed resources. Previously failed resources can be retried with `learn ingest --agent <name>`.
- Agents write content files only. After a successful agent exit, the CLI verifies nonempty document files or populated repository directories at the expected paths and records provenance in `resources.json`.
- Timeout, interruption, or agent failure leaves resources failed. Existing output paths are excluded from allocation so they cannot be overwritten or mistaken for newly ingested content.
