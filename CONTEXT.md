# Learn

Learn turns the scattered material you collect while studying a topic into a local folder that a coding agent can read and explore.

## Language

### Workspaces

**Workspace**:
One folder holding everything collected for a single learning topic. Contains `resources.json` and five output directories: `web/`, `pdf/`, `video/`, `repos/`, `local/`. A workspace name is never a top-level command name (`new`, `add`, `list`, `ls`, `rm`, `tag`, `ingest`, `help`), because `learn <workspace> list` names a workspace as its first argument. A workspace name cannot start with `-`, because the CLI parses it as an option.
_Avoid_: project, topic folder, collection

### Resources and ingestion

**Resource**:
One item added to a workspace: a URL, local path, or repository. Recorded as one entry in `resources.json`, with a `source` field holding its original location.
_Avoid_: source (as a noun; "source" is the field name only)

**Ingest**:
Turning a resource into local, agent-readable content inside its workspace, with its provenance recorded in `resources.json`.
_Avoid_: import, process, sync

**Adapter**:
One named way of ingesting a given resource type, such as `jina` for webpages or `markitdown` for PDFs.
_Avoid_: handler, plugin, converter

**Adapter chain**:
The ordered list of adapters tried for a resource type; the first one that succeeds wins.
_Avoid_: fallback list, pipeline

**Agent handoff**:
Passing every resource whose adapter chain failed, together in one go, to an external coding agent chosen by the user. Ordinary ingestion processes only pending resources; when an agent is selected, previously failed resources join the handoff too. The CLI writes a temporary `.learn/failed-resources.md` listing each resource, its type, failure reason, absolute input path for local resources, and unique unoccupied output path. The agent writes content files only; after a successful agent exit, the CLI verifies outputs and updates `resources.json`. Failed or timed-out handoffs keep resources failed. Timeout or user interruption stops the external agent.
_Avoid_: AI mode, smart ingest

**Resource type**:
One category of ingestible resource, routing to its own adapter chain and output folder: `web`, `pdf`, `video`, `repos`, `local`.
_Avoid_: source type, content type

### State

**resources.json**:
The single file in a workspace root recording every added resource, its type, status, tags, adapter result, and output path. Replaces both the earlier `SOURCES.md` inbox and `.learn/state.json`. The CLI is the only writer; agents write content files only.
_Avoid_: manifest, index, state file

**Config**:
Two-tier configuration: global defaults in `~/.learn/config.json` (default agent, adapter chains, timeouts) and optional per-workspace overrides in the workspace's `resources.json` `config` field.
The current CLI config file is YAML (`~/.learn/config.yaml`); `agent` selects `claude`, `codex`, or `pi` for failed-resource handoff.
_Avoid_: settings, preferences
