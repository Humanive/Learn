/**
 * Core types for the learn-cli system
 */

export type ResourceStatus = 'pending' | 'ingested' | 'failed';

export type ResourceType = 'web' | 'pdf' | 'video' | 'repos' | 'local';

export interface ResourceEntry {
  source: string;
  type: ResourceType;
  tags: string[];
  status: ResourceStatus;
  adapter?: string;
  output?: string;
  title?: string;
  addedAt?: string;
  ingestedAt?: string;
}

export interface ResourcesFile {
  version: number;
  resources: ResourceEntry[];
}

// Legacy types - kept for backward compatibility during migration
export type LegacyResourceStatus = 'inbox' | 'processing' | 'done' | 'failed';

export type LegacyResourceType =
  | 'github_repo'
  | 'webpage'
  | 'pdf'
  | 'youtube'
  | 'arxiv'
  | 'local_folder'
  | 'unknown';

export interface LegacyResourceMetadata {
  source: string;
  status: LegacyResourceStatus;
  type: LegacyResourceType;
  location?: string;
  tags: string[];
  added: string;
  processed?: string;
  error?: string;
  metadata?: {
    title?: string;
    author?: string;
    commit?: string;
    size?: number;
  };
}

export interface WorkspaceState {
  workspace: string;
  created: string;
  lastUpdated: string;
  resources: Record<string, LegacyResourceMetadata>;
}

export interface GlobalConfig {
  learnDir: string;
  defaultGitDepth: number | null;
  jinaApiKey: string | null;
  editor: string;
  /** External coding agent used for failed-resource handoff. */
  agent?: string;
  features: {
    autoIngest: boolean;
    preserveProvenance: boolean;
  };
}

export interface SourceEntry {
  url: string;
  tags: string[];
  status: 'inbox' | 'processing' | 'done';
  location?: string;
  processed?: string;
}
