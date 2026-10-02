import * as fs from 'fs';
import * as path from 'path';
import { configManager } from './config.js';
import { WorkspaceState } from './types.js';
import { ResourcesManager } from './resources.js';

export class WorkspaceManager {
  private baseDir?: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir;
  }

  private async getBaseDir(): Promise<string> {
    if (this.baseDir) {
      return this.baseDir;
    }
    return await configManager.getLearnDir();
  }

  /**
   * Create a new learning workspace
   */
  async create(name: string): Promise<string> {
    const learnDir = await this.getBaseDir();
    const workspacePath = path.join(learnDir, name);

    if (fs.existsSync(workspacePath)) {
      throw new Error(`Workspace "${name}" already exists`);
    }

    fs.mkdirSync(workspacePath, { recursive: true });

    // Create the five output folders only
    fs.mkdirSync(path.join(workspacePath, 'web'));
    fs.mkdirSync(path.join(workspacePath, 'pdf'));
    fs.mkdirSync(path.join(workspacePath, 'video'));
    fs.mkdirSync(path.join(workspacePath, 'repos'));
    fs.mkdirSync(path.join(workspacePath, 'local'));

    // Initialize resources.json
    ResourcesManager.initialize(workspacePath);

    return workspacePath;
  }

  isWorkspace(dir: string): boolean {
    const resourcesPath = path.join(dir, 'resources.json');
    return fs.existsSync(resourcesPath);
  }

  async getWorkspacePath(name: string): Promise<string> {
    const learnDir = await this.getBaseDir();
    return path.join(learnDir, name);
  }

  async list(): Promise<string[]> {
    const learnDir = await this.getBaseDir();

    if (!fs.existsSync(learnDir)) {
      return [];
    }

    const entries = fs.readdirSync(learnDir, { withFileTypes: true });
    const workspaces: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const workspacePath = path.join(learnDir, entry.name);
        if (this.isWorkspace(workspacePath)) {
          workspaces.push(entry.name);
        }
      }
    }

    return workspaces;
  }

  getCurrentWorkspace(): string | null {
    let currentDir = process.cwd();

    while (currentDir !== path.dirname(currentDir)) {
      if (this.isWorkspace(currentDir)) {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  // Legacy methods for backward compatibility
  loadState(workspacePath: string): WorkspaceState {
    const statePath = path.join(workspacePath, '.learn', 'state.json');
    const content = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(content);
  }

  saveState(workspacePath: string, state: WorkspaceState): void {
    state.lastUpdated = new Date().toISOString();
    const statePath = path.join(workspacePath, '.learn', 'state.json');
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }
}

export const workspaceManager = new WorkspaceManager();
