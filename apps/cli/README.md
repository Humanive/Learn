# Learn CLI

Create local learning workspaces, collect resources, and ingest them into Markdown and repositories a coding agent can explore.

## Install

Requires Node.js 22.14 or later (Node.js 24 recommended).

```bash
npm install -g @humanive/learn-cli
learn --version
```

The executable is named `learn`. The unscoped npm packages `learn` and `learn-cli` are unrelated projects.

## Use

```bash
learn new browser-agents
learn add https://github.com/browser-use/browser-use --workspace browser-agents
learn add https://example.com/article --workspace browser-agents --title "Example article"
learn list
learn ingest --workspace browser-agents
```

Workspaces live under `~/Learn` by default. Adding a resource records it as pending; `ingest` downloads or converts it separately. Git repository ingestion requires Git. PDF conversion requires [MarkItDown](https://github.com/microsoft/markitdown) installed separately.

Failed resources can be handed to an installed coding agent:

```bash
learn ingest --workspace browser-agents --agent codex
```

`learn list --json` prints workspace names for integrations. [Learn Browser Capture](https://github.com/Humanive/Learn/tree/main/apps/raycast) uses this CLI to save browser URLs through Raycast.

See the [Learn repository](https://github.com/Humanive/Learn) for configuration, development, and release instructions.
