import * as fs from 'fs';
import * as path from 'path';
import { ResourcesFile, ResourceEntry, ResourceType } from './types.js';

/**
 * Manages resources.json file operations
 */
export class ResourcesManager {
  /**
   * Initialize a new resources.json file
   */
  static initialize(workspacePath: string): void {
    const resourcesPath = path.join(workspacePath, 'resources.json');
    const initialData: ResourcesFile = {
      version: 1,
      resources: [],
    };
    fs.writeFileSync(resourcesPath, JSON.stringify(initialData, null, 2));
  }

  /**
   * Load and validate resources.json
   */
  static load(workspacePath: string): ResourcesFile {
    const resourcesPath = path.join(workspacePath, 'resources.json');

    if (!fs.existsSync(resourcesPath)) {
      throw new Error('resources.json not found');
    }

    let content: string;
    try {
      content = fs.readFileSync(resourcesPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read resources.json: ${error instanceof Error ? error.message : 'unknown error'}`);
    }

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (error) {
      throw new Error('resources.json contains invalid JSON');
    }

    // Validate shape
    if (!ResourcesManager.isValidResourcesFile(data)) {
      throw new Error('resources.json has invalid structure');
    }

    return data;
  }

  /**
   * Save resources.json
   */
  static save(workspacePath: string, data: ResourcesFile): void {
    const resourcesPath = path.join(workspacePath, 'resources.json');
    fs.writeFileSync(resourcesPath, JSON.stringify(data, null, 2));
  }

  /**
   * Add a resource to resources.json
   */
  static addResource(
    workspacePath: string,
    source: string,
    type: ResourceType,
    tags: string[]
  ): void {
    const data = ResourcesManager.load(workspacePath);

    // Check for duplicate
    if (data.resources.some((r) => r.source === source)) {
      throw new Error(`Resource "${source}" already exists`);
    }

    const newResource: ResourceEntry = {
      source,
      type,
      tags,
      status: 'pending',
      addedAt: new Date().toISOString(),
    };

    data.resources.push(newResource);
    ResourcesManager.save(workspacePath, data);
  }

  /**
   * Count total and pending resources
   */
  static getCounts(workspacePath: string): { total: number; pending: number } {
    const data = ResourcesManager.load(workspacePath);
    return {
      total: data.resources.length,
      pending: data.resources.filter((r) => r.status === 'pending').length,
    };
  }

  /**
   * Type guard to validate ResourcesFile structure
   */
  private static isValidResourcesFile(data: unknown): data is ResourcesFile {
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const obj = data as Record<string, unknown>;

    // Check version
    if (typeof obj.version !== 'number') {
      return false;
    }

    // Check resources array
    if (!Array.isArray(obj.resources)) {
      return false;
    }

    // Validate each resource entry
    for (const resource of obj.resources) {
      if (!ResourcesManager.isValidResourceEntry(resource)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Type guard to validate ResourceEntry structure
   */
  private static isValidResourceEntry(entry: unknown): entry is ResourceEntry {
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }

    const obj = entry as Record<string, unknown>;

    // Required fields
    if (typeof obj.source !== 'string') return false;
    if (!['web', 'pdf', 'video', 'repos', 'local'].includes(obj.type as string)) return false;
    if (!Array.isArray(obj.tags)) return false;
    if (!obj.tags.every((t: unknown) => typeof t === 'string')) return false;
    if (!['pending', 'ingested', 'failed'].includes(obj.status as string)) return false;

    // Optional fields
    if (obj.adapter !== undefined && typeof obj.adapter !== 'string') return false;
    if (obj.output !== undefined && typeof obj.output !== 'string') return false;
    if (obj.addedAt !== undefined && typeof obj.addedAt !== 'string') return false;
    if (obj.ingestedAt !== undefined && typeof obj.ingestedAt !== 'string') return false;

    return true;
  }
}
