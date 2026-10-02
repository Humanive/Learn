# Learn

**Learn** is a project-centric learning workspace system. It creates local directories for each learning topic under `~/Learn` and ingests resources (GitHub repos, URLs, PDFs, YouTube videos) into searchable local Markdown, powered by a shared core library that multiple capture interfaces can use.

## Architecture

This is a TypeScript monorepo with two packages:

- **`packages/core`** — shared logic: config, workspace, SOURCES.md parser, ingest router, types
- **`apps/cli`** — the `learn` CLI tool

Future capture interfaces (Raycast extension, browser extension, MCP server) will depend on `@learn/core` and live under `apps/`.

## Installation

```bash
pnpm install
pnpm build
pnpm learn
```

Link the CLI globally:

```bash
cd apps/cli
npm link
```

## Usage

```bash
# Create a workspace
learn new browser-agents

# Add resources
learn add https://github.com/browser-use/browser-use -t python,automation
learn add https://arxiv.org/abs/2501.01234

# List workspaces
learn list

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
├── SOURCES.md          # Inbox, Processing, Done
├── GOAL.md             # What you're learning
├── QUESTIONS.md        # Open questions
├── docs/               # Converted markdown
├── repos/              # Cloned repositories
└── .learn/
    └── state.json      # Resource metadata
```

Global config at `~/.learn/config.yaml`:

```yaml
workspaceRoot: ~/Learn
defaultCloneDepth: 1
jinaReaderApiKey: optional
```

## Development

```bash
# Watch mode
pnpm -r dev

# Run tests
pnpm test

# Run a single package's tests
pnpm --filter @learn/core test
```

## Roadmap

- ✅ Project-centric workspace structure
- ✅ CLI commands: `new`, `add`, `list`
- ✅ SOURCES.md inbox parser
- ✅ Ingest router with type detection
- ⏳ Ingestion handlers (Jina Reader, git clone, MarkItDown, YouTube transcript)
- ⏳ `learn ingest` command
- ⏳ `learn open` command
- ⏳ `learn search` command
- ⏳ Raycast extension
- ⏳ Browser extension
- ⏳ MCP server
- ⏳ DeepSeek/Claude Code integration
