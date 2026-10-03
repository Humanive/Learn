import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { gitAdapter } from './git.js';
import { AdapterContext } from './types.js';
import { GlobalConfig } from '../types.js';

describe('gitAdapter', () => {
  let tempDir: string;
  let workspacePath: string;
  let reposDir: string;
  let sourcesDir: string;
  let config: GlobalConfig;

  /**
   * Create a local repository with `commits` commits so clone depth is
   * observable. Clones go through file:// so git uses the real transport and
   * honours --depth instead of the local hardlink shortcut.
   */
  function createRepository(repoPath: string, commits: number): string {
    fs.mkdirSync(repoPath, { recursive: true });
    execFileSync('git', ['init', '--quiet', repoPath]);

    for (let i = 1; i <= commits; i++) {
      fs.writeFileSync(path.join(repoPath, 'notes.txt'), `revision ${i}\n`);
      execFileSync('git', ['-C', repoPath, 'add', 'notes.txt']);
      execFileSync('git', [
        '-C', repoPath,
        '-c', 'user.name=Learn Test',
        '-c', 'user.email=test@example.com',
        '-c', 'commit.gpgsign=false',
        'commit', '--quiet', '-m', `revision ${i}`,
      ]);
    }

    return repoPath;
  }

  /** Wrap a local repository as a bare repo, named `<name>.git`. */
  function createBareRepository(barePath: string, commits: number): string {
    const workTree = fs.mkdtempSync(path.join(sourcesDir, 'work-'));
    createRepository(path.join(workTree, 'source'), commits);
    fs.mkdirSync(path.dirname(barePath), { recursive: true });
    execFileSync('git', ['clone', '--bare', '--quiet', path.join(workTree, 'source'), barePath]);
    return barePath;
  }

  function fileUrl(repoPath: string): string {
    return `file://${repoPath}`;
  }

  function commitCount(clonePath: string): number {
    return Number(
      execFileSync('git', ['-C', clonePath, 'rev-list', '--count', 'HEAD'], { encoding: 'utf-8' }).trim()
    );
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-git-test-'));
    workspacePath = path.join(tempDir, 'workspace');
    reposDir = path.join(workspacePath, 'repos');
    sourcesDir = path.join(tempDir, 'sources');
    fs.mkdirSync(reposDir, { recursive: true });
    fs.mkdirSync(sourcesDir, { recursive: true });

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

  it('should clone a repository successfully', async () => {
    const source = createRepository(path.join(sourcesDir, 'hello-world'), 3);

    const result = await gitAdapter({ source: fileUrl(source), workspacePath, config });

    expect(result.success).toBe(true);
    expect(result.output).toBe('repos/hello-world');

    const clonePath = path.join(workspacePath, result.output!);
    expect(fs.existsSync(path.join(clonePath, 'notes.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(clonePath, 'notes.txt'), 'utf-8')).toBe('revision 3\n');
  });

  it('should use configured clone depth', async () => {
    const source = createRepository(path.join(sourcesDir, 'depthed'), 5);

    const shallow = await gitAdapter({ source: fileUrl(source), workspacePath, config });
    expect(shallow.success).toBe(true);
    expect(commitCount(path.join(workspacePath, shallow.output!))).toBe(1);

    const deeper = await gitAdapter({
      source: fileUrl(source),
      workspacePath,
      config: { ...config, defaultGitDepth: 2 },
    });
    expect(deeper.success).toBe(true);
    expect(deeper.output).toBe('repos/depthed-2');
    expect(commitCount(path.join(workspacePath, deeper.output!))).toBe(2);
  });

  it('should handle missing git command', async () => {
    const source = createRepository(path.join(sourcesDir, 'no-git'), 1);
    const context: AdapterContext = {
      source: fileUrl(source),
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

  it('should handle clone failures without leaving a partial repository', async () => {
    const missing = path.join(sourcesDir, 'nonexistent-repo');

    const result = await gitAdapter({ source: fileUrl(missing), workspacePath, config });

    expect(result.success).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.reason).toContain('Failed to clone repository');
    expect(fs.readdirSync(reposDir)).toEqual([]);
  });

  it('should reject sources without a repository name', async () => {
    const result = await gitAdapter({ source: 'file:///tmp/', workspacePath, config });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('Could not extract repository name from URL');
    expect(fs.readdirSync(reposDir)).toEqual([]);
  });

  it('should handle duplicate repo names by appending suffix', async () => {
    const source = createRepository(path.join(sourcesDir, 'hello-world'), 1);
    fs.mkdirSync(path.join(reposDir, 'hello-world'));

    const result = await gitAdapter({ source: fileUrl(source), workspacePath, config });

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/^repos\/hello-world-\d+$/);
    expect(fs.readdirSync(path.join(workspacePath, result.output!))).toContain('notes.txt');
  });

  it('should extract repo name from URL, stripping a .git suffix', async () => {
    const source = createBareRepository(path.join(sourcesDir, 'upstream', 'Spoon-Knife.git'), 1);

    const result = await gitAdapter({ source: fileUrl(source), workspacePath, config });

    expect(result.success).toBe(true);
    expect(result.output).toBe('repos/Spoon-Knife');
  });

  it('should handle concurrent clones of repos with same name', async () => {
    // Create three bare repos all named "skills"
    const repos = [
      createBareRepository(path.join(sourcesDir, 'a', 'skills.git'), 1),
      createBareRepository(path.join(sourcesDir, 'b', 'skills.git'), 1),
      createBareRepository(path.join(sourcesDir, 'c', 'skills.git'), 1),
    ];

    // Clone all three concurrently (they all resolve to "skills" as repo name)
    const results = await Promise.all(
      repos.map(source => gitAdapter({ source: fileUrl(source), workspacePath, config }))
    );

    // All three should succeed with unique paths
    const successCount = results.filter(r => r.success).length;
    expect(successCount).toBe(3);

    const outputs = results.filter(r => r.success).map(r => r.output);
    expect(new Set(outputs).size).toBe(3); // Three different output paths

    // Every claimed path holds a real clone, not just a claimed directory
    const clonedRepos = fs.readdirSync(reposDir);
    expect(clonedRepos.length).toBe(3);
    for (const output of outputs) {
      expect(fs.existsSync(path.join(workspacePath, output!, 'notes.txt'))).toBe(true);
    }
  });
});
