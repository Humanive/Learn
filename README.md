# Learn

**Learn** is a project-centric learning workspace system. It creates local directories for each learning topic under `~/Learn` and ingests resources (GitHub repos, URLs, PDFs, YouTube videos) into searchable local Markdown, powered by a shared core library that multiple capture interfaces can use.

## Architecture

This is a TypeScript monorepo with three packages:

- **`packages/core`** — shared logic: config, workspaces, resources, adapters, and ingestion
- **`apps/cli`** — the `learn` CLI tool
- **`apps/raycast`** — browser capture, workspace and resource browsing, manual addition, tags, removal, and Terminal ingestion through the installed Learn CLI

Future capture interfaces (browser extension, MCP server) will live under `apps/`.

## Installation

Requires Node.js 22.14 or later (Node.js 24 recommended).

The CLI is published as `@humanive/learn-cli`, with `@humanive/learn-core` as its dependency. Install it with:

```bash
npm install -g @humanive/learn-cli
learn --version
```

For development, install from source:

```bash
pnpm install --frozen-lockfile
pnpm build:cli
pnpm learn
```

For Raycast setup, see [the extension README](apps/raycast/README.md). Store submission requirements and remaining blockers are recorded in [the publishing guide](docs/raycast-store.md).

The [npm publishing guide](docs/npm-publishing.md) covers first publication and configuring Trusted Publishing. Once configured, `.github/workflows/npm-publish.yml` automatically publishes a new patch version when CLI/core changes reach `main`.

## Usage

```bash
# Create a workspace
learn new browser-agents

# Add resources
learn add https://github.com/browser-use/browser-use -t python,automation
learn add https://arxiv.org/abs/2501.01234

# List workspaces
learn list

# List the resources in one workspace
learn browser-agents list
learn browser-agents ls --status pending
learn browser-agents ls --type repos --tag python
learn browser-agents ls --verbose

# Save the current browser URL from Raycast
# Run the extension from this repository with: pnpm --filter learn-raycast develop
# The first capture asks for a workspace; later captures reuse it.

# Ingest resources with deterministic adapters
learn ingest

# Hand off resources that adapters cannot process to an external coding agent
learn ingest --agent claude
learn ingest --agent codex
learn ingest --agent pi

# Open workspace in editor (not yet implemented)
learn open
```

## Workspace Structure

Each workspace under `~/Learn/<name>/` contains:

```
browser-agents/
├── resources.json      # Resource status, provenance, and output paths
├── web/                # Webpage content
├── pdf/                # Converted PDFs
├── video/              # Video content
├── repos/              # Cloned repositories
├── local/              # Local resource content
└── .learn/
    └── failed-resources.md  # Temporary agent handoff manifest
```

Global config at `~/.learn/config.yaml`:

```yaml
learnDir: ~/Learn
defaultGitDepth: 1
jinaApiKey: null
```

## Development

```bash
# Watch mode
pnpm -r dev

# Run tests
pnpm test

# Run a single package's tests
pnpm --filter @humanive/learn-core test
```

## Roadmap

- ✅ Project-centric workspace structure
- ✅ CLI commands: `new`, `add`, `list`, `rm`, `tag`
- ✅ Workspace resources recorded in `resources.json`
- ✅ Ingest router with type detection
- ✅ Deterministic adapters: Jina Reader, git clone, MarkItDown, local symlinks
- ✅ `learn ingest` with external agent handoff and failed-resource retries
- ✅ Raycast browser URL capture, workspace creation, resource browsing and filtering, manual addition, tags, removal, and Terminal ingestion
- ⏳ Raycast Store submission
- ⏳ `learn open` command
- ⏳ `learn search` command
- ⏳ Browser extension
- ⏳ MCP server
