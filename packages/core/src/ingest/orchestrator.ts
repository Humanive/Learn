import * as fs from 'fs';
import * as path from 'path';
import { ResourcesManager } from '../resources.js';
import { ResourceType, GlobalConfig, ResourceEntry } from '../types.js';
import { gitAdapter } from '../adapters/git.js';
import { jinaAdapter } from '../adapters/jina.js';
import { localAdapter } from '../adapters/local.js';
import { markitdownAdapter } from '../adapters/markitdown.js';
import { Adapter, AdapterContext } from '../adapters/types.js';

export interface IngestConfig {
  adapterChains: Record<ResourceType, string[]>;
  concurrency: number;
  agentTimeout: number;
  globalConfig: GlobalConfig;
  /** External agent used for resources that every deterministic adapter rejects. */
  agentRunner?: AgentRunner;
  /** Name recorded in resources.json for a successful handoff. */
  agentName?: string;
}

export interface AgentHandoffResource {
  resource: ResourceEntry;
  failures: string[];
  expectedOutput: string;
}

export interface AgentHandoff {
  workspacePath: string;
  manifestPath: string;
  resources: AgentHandoffResource[];
}

export type AgentRunner = (handoff: AgentHandoff) => Promise<void>;

export interface IngestResult {
  success: number;
  failed: number;
  skipped: number;
  handedOff: number;
}

// Map adapter names to implementations
const ADAPTER_REGISTRY: Record<string, Adapter> = {
  git: gitAdapter,
  jina: jinaAdapter,
  local: localAdapter,
  markitdown: markitdownAdapter,
};

/**
 * Process all pending resources in the workspace.
 */
export async function ingestWorkspace(
  workspacePath: string,
  config: IngestConfig
): Promise<IngestResult> {
  const data = ResourcesManager.load(workspacePath);
  const pendingResources = data.resources.filter((r) => r.status === 'pending');
  const failedForHandoff: AgentHandoffResource[] = [];

  const result: IngestResult = {
    success: 0,
    failed: 0,
    skipped: data.resources.length - pendingResources.length,
    handedOff: 0,
  };

  await processConcurrently(
    pendingResources,
    config.concurrency,
    async (resource) => {
      const failed = await processResource(resource, workspacePath, config);
      if (failed) {
        failedForHandoff.push(failed);
      } else {
        result.success++;
      }
    }
  );

  if (failedForHandoff.length > 0) {
    const handoff: AgentHandoff = {
      workspacePath,
      manifestPath: writeHandoffManifest(workspacePath, failedForHandoff),
      resources: failedForHandoff,
    };

    if (config.agentRunner) {
      try {
        await withTimeout(
          Promise.resolve().then(() => config.agentRunner!(handoff)),
          config.agentTimeout
        );
      } catch (error) {
        console.warn(
          `Agent handoff failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      for (const item of failedForHandoff) {
        if (!hasOutput(workspacePath, item.expectedOutput)) {
          continue;
        }

        updateResourceStatus(workspacePath, item.resource.source, {
          status: 'ingested',
          adapter: `agent:${config.agentName || 'external'}`,
          output: item.expectedOutput,
          ingestedAt: new Date().toISOString(),
        });
        result.success++;
        result.handedOff++;
      }
    }
  }

  result.failed = data.resources.length - result.skipped - result.success;
  return result;
}

/**
 * Process a single resource through its adapter chain.
 * Returns handoff details when every adapter fails.
 */
async function processResource(
  resource: ResourceEntry,
  workspacePath: string,
  config: IngestConfig
): Promise<AgentHandoffResource | undefined> {
  const adapterNames = config.adapterChains[resource.type] || [];
  const failures: string[] = [];

  const context: AdapterContext = {
    source: resource.source,
    workspacePath,
    config: config.globalConfig,
  };

  for (const adapterName of adapterNames) {
    const adapter = ADAPTER_REGISTRY[adapterName];
    if (!adapter) {
      failures.push(`${adapterName}: unknown adapter`);
      console.warn(`Unknown adapter: ${adapterName}`);
      continue;
    }

    try {
      const adapterResult = await adapter(context);
      if (adapterResult.success) {
        updateResourceStatus(workspacePath, resource.source, {
          status: 'ingested',
          adapter: adapterName,
          output: adapterResult.output,
          ingestedAt: new Date().toISOString(),
        });
        return undefined;
      }
      failures.push(`${adapterName}: ${adapterResult.reason || 'adapter failed'}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${adapterName}: ${reason}`);
      console.warn(`Adapter ${adapterName} threw error for ${resource.source}:`, reason);
    }
  }

  const expectedOutput = expectedOutputPath(resource);
  updateResourceStatus(workspacePath, resource.source, { status: 'failed' });
  return { resource, failures, expectedOutput };
}

function writeHandoffManifest(
  workspacePath: string,
  resources: AgentHandoffResource[]
): string {
  const learnDir = path.join(workspacePath, '.learn');
  fs.mkdirSync(learnDir, { recursive: true });
  const manifestPath = path.join(learnDir, 'failed-resources.md');
  const lines = [
    '# Failed resources',
    '',
    'These resources were rejected by every deterministic adapter.',
    'Process each resource if possible and write the result to the exact expected output path.',
    'Do not edit resources.json; the Learn CLI records provenance after this handoff.',
    '',
  ];

  for (const [index, item] of resources.entries()) {
    lines.push(
      `## ${index + 1}. ${item.resource.source}`,
      '',
      `- Type: ${item.resource.type}`,
      `- Tags: ${item.resource.tags.length > 0 ? item.resource.tags.join(', ') : '(none)'}`,
      `- Expected output: ${item.expectedOutput}`,
      '- Adapter failures:',
      ...item.failures.map((failure) => `  - ${failure}`),
      ''
    );
  }

  fs.writeFileSync(manifestPath, `${lines.join('\n')}\n`, 'utf-8');
  return manifestPath;
}

function expectedOutputPath(resource: ResourceEntry): string {
  const name = resource.type === 'repos'
    ? repositoryName(resource.source)
    : resource.type === 'local'
      ? path.basename(path.resolve(resource.source))
      : `${documentName(resource.source)}.md`;

  switch (resource.type) {
    case 'web': return path.join('web', `${sanitize(name)}.md`);
    case 'pdf': return path.join('pdf', `${sanitize(name.replace(/\.pdf$/i, ''))}.md`);
    case 'video': return path.join('video', `${sanitize(name)}.md`);
    case 'repos': return path.join('repos', sanitize(name));
    case 'local': return path.join('local', name);
  }
}

function documentName(source: string): string {
  try {
    const url = new URL(source);
    return url.pathname.split('/').filter(Boolean).pop() || url.hostname;
  } catch {
    return path.basename(source) || 'document';
  }
}

function repositoryName(source: string): string {
  try {
    const parts = new URL(source).pathname.split('/').filter(Boolean);
    return (parts[parts.length - 1] || 'repository').replace(/\.git$/, '');
  } catch {
    return 'repository';
  }
}

function sanitize(value: string): string {
  return value.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'document';
}

function hasOutput(workspacePath: string, relativePath: string): boolean {
  try {
    return fs.existsSync(path.join(workspacePath, relativePath));
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function updateResourceStatus(
  workspacePath: string,
  source: string,
  updates: Partial<ResourceEntry>
): void {
  const data = ResourcesManager.load(workspacePath);
  const resource = data.resources.find((r) => r.source === source);

  if (!resource) {
    throw new Error(`Resource not found: ${source}`);
  }

  Object.assign(resource, updates);
  ResourcesManager.save(workspacePath, data);
}

async function processConcurrently<T>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const active: Promise<void>[] = [];
  const limit = Math.max(1, concurrency);

  while (queue.length > 0 || active.length > 0) {
    while (active.length < limit && queue.length > 0) {
      const item = queue.shift()!;
      const task = processor(item).then(() => {
        const index = active.indexOf(task);
        if (index > -1) active.splice(index, 1);
      });
      active.push(task);
    }

    if (active.length > 0) await Promise.race(active);
  }
}
