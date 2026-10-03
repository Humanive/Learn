import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceManager, RESERVED_WORKSPACE_NAMES } from './workspace.js';
import { ResourcesManager } from './resources.js';

describe('WorkspaceManager', () => {
  let testDir: string;
  let workspaceManager: WorkspaceManager;

  beforeEach(() => {
    // Isolated temp learnDir; never touch the real ~/Learn
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-workspace-test-'));
    workspaceManager = new WorkspaceManager(path.join(testDir, 'Learn'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should create a new workspace with resources.json and five output folders', async () => {
    const workspacePath = await workspaceManager.create('test-workspace');

    expect(fs.existsSync(workspacePath)).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, 'resources.json'))).toBe(true);

    // Check the five output folders
    for (const dir of ['web', 'pdf', 'video', 'repos', 'local']) {
      expect(fs.existsSync(path.join(workspacePath, dir))).toBe(true);
    }

    // Ensure old structure is NOT created
    expect(fs.existsSync(path.join(workspacePath, '.learn'))).toBe(false);
    expect(fs.existsSync(path.join(workspacePath, 'SOURCES.md'))).toBe(false);
    expect(fs.existsSync(path.join(workspacePath, 'INDEX.md'))).toBe(false);
    expect(fs.existsSync(path.join(workspacePath, 'notes'))).toBe(false);
    expect(fs.existsSync(path.join(workspacePath, 'papers'))).toBe(false);

    // Verify resources.json content
    const resourcesData = ResourcesManager.load(workspacePath);
    expect(resourcesData.version).toBe(1);
    expect(resourcesData.resources).toEqual([]);
  });

  it('should throw if workspace already exists', async () => {
    await workspaceManager.create('test-workspace');
    await expect(workspaceManager.create('test-workspace')).rejects.toThrow(
      'already exists'
    );
  });

  it('should reject names reserved for top-level commands', async () => {
    for (const name of RESERVED_WORKSPACE_NAMES) {
      await expect(workspaceManager.create(name)).rejects.toThrow('is reserved');
      expect(fs.existsSync(path.join(testDir, 'Learn', name))).toBe(false);
    }
  });

  it('should list all workspaces', async () => {
    await workspaceManager.create('workspace-1');
    await workspaceManager.create('workspace-2');

    const workspaces = await workspaceManager.list();
    expect(workspaces).toHaveLength(2);
    expect(workspaces).toContain('workspace-1');
    expect(workspaces).toContain('workspace-2');
  });

  it('should return empty list when learnDir does not exist', async () => {
    expect(await workspaceManager.list()).toEqual([]);
  });

  it('should check if directory is a workspace', async () => {
    const workspacePath = await workspaceManager.create('test-workspace');
    expect(workspaceManager.isWorkspace(workspacePath)).toBe(true);
    expect(workspaceManager.isWorkspace(testDir)).toBe(false);
  });
});
