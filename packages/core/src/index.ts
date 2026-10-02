export { ConfigManager, configManager } from './config.js';
export { WorkspaceManager, workspaceManager } from './workspace.js';
export { SourcesManager, sourcesManager } from './sources.js';
export { ResourcesManager } from './resources.js';
export { IngestRouter, ingestRouter } from './ingest/router.js';
export { gitAdapter, jinaAdapter, markitdownAdapter } from './adapters/index.js';
export type {
  GlobalConfig,
  LegacyResourceMetadata,
  LegacyResourceStatus,
  LegacyResourceType,
  ResourceEntry,
  ResourcesFile,
  ResourceStatus,
  ResourceType,
  SourceEntry,
  WorkspaceState,
} from './types.js';
export type { Adapter, AdapterContext, AdapterResult } from './adapters/types.js';
