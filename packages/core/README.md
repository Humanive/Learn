# Learn Core

Shared workspace, resource, adapter, and ingestion logic for [Learn](https://github.com/Humanive/Learn).

```bash
npm install @humanive/learn-core
```

Requires Node.js 22.14 or later (Node.js 24 recommended).

```js
import { workspaceManager, ResourcesManager } from '@humanive/learn-core';

const workspacePath = await workspaceManager.create('browser-agents');
ResourcesManager.addResource(workspacePath, 'https://example.com/article', 'web', []);
```

For the command-line application, install `@humanive/learn-cli`; its executable is `learn`.
