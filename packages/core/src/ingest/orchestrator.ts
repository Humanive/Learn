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
}

export interface IngestResult {
  success: number;
  failed: number;
  skipped: number;
}

// Map adapter names to implementations
const ADAPTER_REGISTRY: Record<string, Adapter> = {
  git: gitAdapter,
  jina: jinaAdapter,
  local: localAdapter,
  markitdown: markitdownAdapter,
};

/**
 * Process all pending resources in the workspace
 */
export async function ingestWorkspace(
  workspacePath: string,
  config: IngestConfig
): Promise<IngestResult> {
  const data = ResourcesManager.load(workspacePath);

  // Filter pending resources
  const pendingResources = data.resources.filter((r) => r.status === 'pending');

  const result: IngestResult = {
    success: 0,
    failed: 0,
    skipped: data.resources.length - pendingResources.length,
  };

  // Process resources with concurrency limit
  await processConcurrently(
    pendingResources,
    config.concurrency,
    async (resource) => {
      const success = await processResource(resource, workspacePath, config);
      if (success) {
        result.success++;
      } else {
        result.failed++;
      }
    }
  );

  return result;
}

/**
 * Process a single resource through its adapter chain
 */
async function processResource(
  resource: ResourceEntry,
  workspacePath: string,
  config: IngestConfig
): Promise<boolean> {
  const adapterNames = config.adapterChains[resource.type] || [];

  const context: AdapterContext = {
    source: resource.source,
    workspacePath,
    config: config.globalConfig,
  };

  // Try each adapter in the chain
  for (const adapterName of adapterNames) {
    const adapter = ADAPTER_REGISTRY[adapterName];
    if (!adapter) {
      console.warn(`Unknown adapter: ${adapterName}`);
      continue;
    }

    try {
      const result = await adapter(context);

      if (result.success) {
        // Update resource status to ingested
        updateResourceStatus(workspacePath, resource.source, {
          status: 'ingested',
          adapter: adapterName,
          output: result.output,
          ingestedAt: new Date().toISOString(),
        });
        return true;
      }
    } catch (error) {
      // Adapter threw an exception, try next adapter
      console.warn(
        `Adapter ${adapterName} threw error for ${resource.source}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // All adapters failed
  updateResourceStatus(workspacePath, resource.source, {
    status: 'failed',
  });
  return false;
}

/**
 * Update a resource's status in resources.json
 */
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

/**
 * Process items concurrently with a limit
 */
async function processConcurrently<T>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    // Start new tasks up to concurrency limit
    while (active.length < concurrency && queue.length > 0) {
      const item = queue.shift()!;
      const task = processor(item).then(() => {
        // Remove from active when done
        const index = active.indexOf(task);
        if (index > -1) {
          active.splice(index, 1);
        }
      });
      active.push(task);
    }

    // Wait for at least one task to complete
    if (active.length > 0) {
      await Promise.race(active);
    }
  }
}

