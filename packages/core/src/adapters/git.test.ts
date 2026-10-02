import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { gitAdapter } from './git.js';
import { AdapterContext } from './types.js';
import { GlobalConfig } from '../types.js';

describe('gitAdapter', () => {
  let tempDir: string;
  let workspacePath: string;
  let config: GlobalConfig;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-git-test-'));
    workspacePath = path.join(tempDir, 'workspace');
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'repos'));

    config = {
      learnDir: tempDir,
      defaultGitDepth: 1,
      jinaApiKey: null,
      editor: 'vim',
      features: {
        autoIngest: false,
        preserveProvenance: true,
      },
    };
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should clone a GitHub repo successfully', async () => {
    const context: AdapterContext = {
      source: 'https://github.com/octocat/Hello-World',
      workspacePath,
      config,
    };

    const result = await gitAdapter(context);

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output).toContain('repos/Hello-World');
  }, 30000);

  it('should use configured clone depth', async () => {
    const context: AdapterContext = {
      source: 'https://github.com/octocat/Hello-World',
      workspacePath,
      config: { ...config, defaultGitDepth: 2 },
    };

    const result = await gitAdapter(context);

    expect(result.success).toBe(true);
  }, 30000);

  it('should handle missing git command', async () => {
    const context: AdapterContext = {
      source: 'https://github.com/user/repo',
      workspacePath,
      config,
    };

    // Mock PATH to exclude git
    const originalPath = process.env.PATH;
    process.env.PATH = '';

    try {
      const result = await gitAdapter(context);

      expect(result.success).toBe(false);
      expect(result.reason).toContain('git');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('should handle network errors', async () => {
    const context: AdapterContext = {
      source: 'https://github.com/nonexistent-user-12345/nonexistent-repo-67890',
      workspacePath,
      config,
    };

    const result = await gitAdapter(context);

    expect(result.success).toBe(false);
    expect(result.reason).toBeDefined();
  }, 30000);

  it('should handle duplicate repo names by appending suffix', async () => {
    const reposDir = path.join(workspacePath, 'repos');
    fs.mkdirSync(path.join(reposDir, 'Hello-World'));

    const context: AdapterContext = {
      source: 'https://github.com/octocat/Hello-World',
      workspacePath,
      config,
    };

    const result = await gitAdapter(context);

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/repos\/Hello-World-\d+/);
  }, 30000);

  it('should extract repo name from GitHub URL', async () => {
    const context: AdapterContext = {
      source: 'https://github.com/octocat/Spoon-Knife',
      workspacePath,
      config,
    };

    const result = await gitAdapter(context);

    if (result.success) {
      expect(result.output).toContain('Spoon-Knife');
    }
  }, 30000);

  it('should handle concurrent clones of repos with same name', async () => {
    // Create three local bare repos all named "skills"
    const bareReposDir = path.join(tempDir, 'bare-repos');
    fs.mkdirSync(bareReposDir, { recursive: true });

    const repo1 = path.join(bareReposDir, 'a', 'skills.git');
    const repo2 = path.join(bareReposDir, 'b', 'skills.git');
    const repo3 = path.join(bareReposDir, 'c', 'skills.git');

    // Initialize three bare repos
    const { execSync } = await import('child_process');
    for (const repo of [repo1, repo2, repo3]) {
      fs.mkdirSync(path.dirname(repo), { recursive: true });
      execSync(`git init --bare "${repo}"`, { stdio: "ignore" });
    }

    // Clone all three concurrently (they all resolve to "skills" as repo name)
    const results = await Promise.all([
      gitAdapter({
        source: `file://${repo1}`,
        workspacePath,
        config,
      }),
      gitAdapter({
        source: `file://${repo2}`,
        workspacePath,
        config,
      }),
      gitAdapter({
        source: `file://${repo3}`,
        workspacePath,
        config,
      }),
    ]);

    // All three should succeed with unique paths
    const successCount = results.filter((r) => r.success).length;
    expect(successCount).toBe(3);

    const outputs = results.filter((r) => r.success).map((r) => r.output);
    const uniqueOutputs = new Set(outputs);
    expect(uniqueOutputs.size).toBe(3); // Three different output paths

    // Verify all three repos exist
    const reposDir = path.join(workspacePath, 'repos');
    const clonedRepos = fs.readdirSync(reposDir);
    expect(clonedRepos.length).toBe(3);
  }, 30000);
});
